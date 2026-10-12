/* Actual scheduler helper and Worker dispatch, isolated SQLite and mocked processing. No network or real email. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const root = path.resolve(__dirname, '..');
const outbox = require('../lib/coa-outbox.ts');
const BASE = Date.parse('2026-10-11T08:00:00Z');
const KEY = 'coa_scheduler_health_v1';
const expectedFields = ['version', 'runId', 'scheduledAt', 'startedAt', 'completedAt', 'status', 'phase', 'enabled', 'mailConfigured', 'processed', 'accepted', 'review'].sort();
const oldFetch = global.fetch;
global.fetch = () => { throw Error('Live network is forbidden in scheduler tests.'); };
function load(file, overrides) {
  const filename = path.join(root, file), m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = Module.createRequire(filename);
  m.require = name => Object.hasOwn(overrides, name) ? overrides[name] : normal(name);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return m.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const databases = [];
function fixture(processor = async () => ({ processed: 0, accepted: 0, review: 0 })) {
  const sql = new DatabaseSync(':memory:'); databases.push(sql);
  sql.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);');
  let current = BASE, counter = 0, fail = null;
  const queries = [], snapshots = [], calls = [];
  function statement(query, args = []) {
    assert(!/coa_original_reports|coa_delivery_outbox|requests|orders|profiles|addresses/i.test(query), 'Health must not query reports, requests or commerce records');
    return {
      bind: (...values) => statement(query, values),
      first: async () => { queries.push(query); if (fail?.(query, args)) throw Error('PRIVATE_EXCEPTION recipient@example.invalid private-query'); return sql.prepare(query).get(...args) || null; },
      run: async () => {
        queries.push(query);
        if (fail?.(query, args)) throw Error('PRIVATE_EXCEPTION recipient@example.invalid private-query');
        const result = sql.prepare(query).run(...args);
        const record = sql.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
        if (record) { const health = JSON.parse(record.value); assert.deepEqual(Object.keys(health).sort(), expectedFields); snapshots.push(health); }
        return { meta: result };
      },
    };
  }
  const env = { DB: { prepare: query => statement(query) }, RESEND_API_KEY: 'synthetic-fixture-not-a-secret' };
  const helper = load('lib/coa-scheduler.ts', { './coa-outbox': { ...outbox, processCoaOutbox: async (...args) => { calls.push(args); return processor(...args); } } });
  return {
    env, sql, helper, queries, snapshots, calls,
    deps: { now: () => current, uuid: () => 'synthetic-run-' + ++counter },
    time: value => current = value,
    fail: value => fail = value,
    config: value => sql.prepare("INSERT INTO settings VALUES('coa_delivery_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ enabled: true, replyTo: 'reply@example.invalid', notifyTo: 'alert@example.invalid', ...value })),
    health: () => { const row = sql.prepare('SELECT value FROM settings WHERE key=?').get(KEY); return row ? JSON.parse(row.value) : null; },
    run(scheduledAt = BASE) { return helper.runScheduledCoaOutbox(env, scheduledAt, this.deps); },
  };
}
(async () => {
 try {
  // Start is persisted before configuration reads; readiness precedes actual processing.
  let f;
  f = fixture(async (env, options) => {
    assert.equal(env, f.env); assert.deepEqual(options, { limit: 5 });
    assert.equal(f.health().status, 'running'); assert.equal(f.health().phase, 'processing');
    assert.equal(f.health().enabled, true); assert.equal(f.health().mailConfigured, true);
    f.time(BASE + 3000);
    return { processed: 3, accepted: 2, review: 1, recipient: 'PRIVATE_EXTRA_FIELD', body: 'PRIVATE_MESSAGE' };
  });
  f.config({}); await f.run(BASE - 1000);
  assert.equal(f.snapshots[0].phase, 'starting'); assert.equal(f.snapshots[0].enabled, null);
  assert.equal(f.snapshots[0].mailConfigured, null); assert.equal(f.snapshots[0].processed, null);
  assert.match(f.queries[0], /^INSERT INTO settings/);
  assert.deepEqual(f.health(), { version: 1, runId: 'synthetic-run-1', scheduledAt: BASE - 1000, startedAt: BASE, completedAt: BASE + 3000, status: 'completed', phase: 'completion', enabled: true, mailConfigured: true, processed: 3, accepted: 2, review: 1 });
  assert(!/PRIVATE|example.invalid|synthetic-fixture/.test(JSON.stringify(f.health())));
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n, 1);

  // Configuration/sender checks accurately mirror the processor without registry reads.
  for (const scenario of [
    { config: null, env: {}, enabled: false, mailConfigured: true },
    { config: { enabled: false }, env: {}, enabled: false, mailConfigured: true },
    { config: {}, env: { RESEND_API_KEY: '   ' }, enabled: true, mailConfigured: false },
    { config: {}, env: { COA_EMAIL_FROM: 'invalid\nheader' }, enabled: true, mailConfigured: false },
    { config: {}, env: { COA_EMAIL_FROM: 'COA Fixture <coa@example.invalid>', ORDER_EMAIL_FROM: 'invalid\nheader' }, enabled: true, mailConfigured: true },
    { config: {}, env: { ORDER_EMAIL_FROM: 'Order Fixture <order@example.invalid>' }, enabled: true, mailConfigured: true },
  ]) {
    f = fixture(); if (scenario.config) f.config(scenario.config); Object.assign(f.env, scenario.env);
    await f.run(); assert.equal(f.health().enabled, scenario.enabled); assert.equal(f.health().mailConfigured, scenario.mailConfigured);
    assert.equal(f.health().status, 'completed'); assert.equal(f.health().processed, 0);
  }

  // Failures stay nonidentifying, retain known readiness, and reject for the platform.
  const privateError = new Error('PRIVATE_EXCEPTION customer@example.invalid SQL or provider detail');
  f = fixture(async () => { throw privateError; }); f.config({});
  await assert.rejects(() => f.run(), error => error.message === 'COA scheduled processing failed.' && !error.cause);
  assert.equal(f.health().status, 'failed'); assert.equal(f.health().phase, 'processing'); assert.equal(f.health().processed, null);
  assert.equal(f.health().enabled, true); assert.equal(f.health().completedAt, BASE);
  assert(!JSON.stringify(f.health()).includes('PRIVATE_EXCEPTION'));
  f = fixture(); f.fail(query => query.startsWith('SELECT value'));
  await assert.rejects(() => f.run(), { message: 'COA scheduled processing failed.' });
  assert.equal(f.calls.length, 0); assert.equal(f.health().status, 'failed'); assert.equal(f.health().phase, 'readiness');
  assert.equal(f.health().enabled, null); assert.equal(f.health().mailConfigured, null);
  f = fixture(); f.fail(() => true);
  await assert.rejects(() => f.run(), { message: 'COA scheduled processing failed.' });
  assert.equal(f.calls.length, 0); assert.equal(f.health(), null, 'A database outage cannot falsely claim recorded health');
  f = fixture(); f.config({});
  f.fail((query, args) => query.startsWith('UPDATE') && JSON.parse(args[0]).status === 'completed');
  await assert.rejects(() => f.run(), { message: 'COA scheduled processing failed.' });
  assert.equal(f.health().status, 'failed'); assert.equal(f.health().phase, 'completion'); assert.equal(f.health().processed, 0);

  // A late success or failure from an older run cannot replace a later run's result.
  for (const lateFailure of [false, true]) {
    const first = deferred(); let processCalls = 0;
    f = fixture(async () => ++processCalls === 1 ? first.promise : { processed: 1, accepted: 1, review: 0 }); f.config({});
    const older = f.run(); const caughtOlder = older.catch(error => error); await flush();
    assert.equal(processCalls, 1); f.time(BASE + 1000); await f.run(BASE + 1000);
    const newer = f.health(); assert.equal(newer.runId, 'synthetic-run-2');
    f.time(BASE + 5000); if (lateFailure) first.reject(privateError); else first.resolve({ processed: 5, accepted: 4, review: 1 });
    await caughtOlder; assert.deepEqual(f.health(), newer);
  }
  // Even a delayed start with an older wall clock cannot replace later health.
  f = fixture(); f.time(BASE + 2000); await f.run(); const newer = f.health();
  f.time(BASE); await f.run(); assert.deepEqual(f.health(), newer);
  f = fixture(); f.sql.prepare('INSERT INTO settings VALUES(?,?)').run(KEY, 'invalid-json');
  await f.run(NaN); assert.equal(f.health().scheduledAt, null); assert.equal(f.health().status, 'completed');

  // Actual Worker dispatch preserves HTTP, daily retention, and unknown-cron behavior.
  f = fixture(); f.config({}); let cleanup = 0;
  const http = { fetch: () => new Response('isolated fixture') };
  const worker = load('worker.ts', {
    './lib/checkout-recovery': { runCheckoutRecovery: async()=>({}) },
    'vinext/server/fetch-handler': http,
    './lib/traffic-metrics-server': { cleanupTraffic: async db => { assert.equal(db, f.env.DB); cleanup++; } },
    './lib/coa-scheduler': { runScheduledCoaOutbox: (env, time) => f.helper.runScheduledCoaOutbox(env, time, f.deps) },
  }).default;
  assert.equal(worker.fetch, http.fetch);
  await worker.scheduled({ cron: '0 9 * * *', scheduledTime: BASE }, f.env);
  assert.equal(cleanup, 1); assert.equal(f.health(), null); assert.equal(f.calls.length, 0);
  await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: BASE - 1234 }, f.env);
  assert.equal(f.health().scheduledAt, BASE - 1234); assert.equal(f.calls.length, 1); assert.equal(cleanup, 1);
  const recorded = f.health(); await worker.scheduled({ cron: 'unknown', scheduledTime: BASE }, f.env);
  assert.deepEqual(f.health(), recorded); assert.equal(f.calls.length, 1);
  console.log('PASS: actual scheduler + SQLite start/readiness/completion, generic failures, bounded nonidentifying fields, overlapping-run isolation, and actual Worker dispatch preserving HTTP/daily cleanup. No network, private reports, customer data or real sends.');
 } finally { global.fetch = oldFetch; for (const db of databases) db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
