import { migrationStatements } from './sql-migration-fixture.mjs';
// Actual built Worker + isolated Miniflare D1. Every outbound request is intercepted.
// Only synthetic inquiry records, unmistakable synthetic PDF bytes and fixture mail addresses are used; no real mail.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
const require = createRequire(import.meta.url), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fsSync.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const { saveCoaConfig, enqueueCoaRequest, enqueueRequestAlert } = require('../lib/coa-outbox.ts');
const registry = require('./fixtures/coa-originals-v1.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(root, 'dist/server');
const config = JSON.parse(await fs.readFile(path.join(built, 'wrangler.json'), 'utf8'));
assert.equal(config.main, 'index.js');
assert(config.triggers?.crons?.includes('0 9 * * *'), 'Keep existing daily cleanup');
assert(config.triggers?.crons?.includes('*/5 * * * *'), 'Build must include five-minute outbox processing');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trybiomod-coa-worker-'));
const modules = (await fs.readdir(built, { recursive: true })).filter(name => /\.(?:m?js)$/.test(name));
const orderedModules = [config.main, ...modules.filter(name => name !== config.main)].map(name => ({ type: 'ESModule', path: path.join(built, name) }));
const now = Date.now(), dayMs = 86400000, midnight = Math.floor(now / dayMs) * dayMs;
const day = value => new Date(value).toISOString().slice(0, 10);
const expired = day(midnight - 90 * dayMs), retained = day(midnight - 89 * dayMs);
const fixtureKey = 'isolated-provider-fixture-not-a-real-secret';
const sender = 'BIOMOD Fixture <no-reply@example.invalid>';
const settings = { enabled: true, replyTo: 'reply@example.invalid', notifyTo: 'alerts@example.invalid' };
const calls = [], expectedMessages = new Map();
let forbiddenOutbound = 0, requestCounter = 0;
const requestId = () => `30000000-0000-4000-8000-${String(++requestCounter).padStart(12, '0')}`;
const mf = new Miniflare({
  name: 'isolated-coa-worker', cf: false, unsafeTriggerHandlers: true,
  modules: orderedModules, modulesRoot: built,
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { RESEND_API_KEY: fixtureKey, ORDER_EMAIL_FROM: sender },
  d1Databases: { DB: 'isolated-coa-database' }, d1Persist: path.join(temporary, 'd1'),
  outboundService: async request => {
    if (request.url !== 'https://api.resend.com/emails' || request.method !== 'POST') {
      forbiddenOutbound++; throw Error('Non-fixture outbound request is forbidden.');
    }
    assert(request.headers.get('authorization') === 'Bearer ' + fixtureKey, 'Only the isolated provider credential is allowed');
    const key = request.headers.get('idempotency-key');
    const expected = expectedMessages.get(key);
    assert(expected, 'Only a durably queued fixture snapshot may be sent');
    const payload = await request.json();
    assert.equal(payload.from, expected.sender); assert.equal(payload.reply_to, expected.reply_to);
    assert.deepEqual(payload.to, [expected.recipient]); assert.equal(payload.subject, expected.subject);
    assert(payload.text === expected.body, 'The queued message snapshot is unchanged');
    assert(!JSON.stringify(payload).includes('PRIVATE_FIXTURE_REQUEST_TEXT'), 'Untrusted request text must not enter email');
    assert.equal(expected.purpose, 'request-alert', 'The scheduler cannot send customer COAs');
    assert.equal(payload.attachments, undefined);
    assert(payload.text.includes('https://trybiomod.com/admin?tab=requests'));
    assert(!payload.text.includes('customer-fixture'));
    const providerId = `40000000-0000-4000-8000-${String(calls.length + 1).padStart(12, '0')}`;
    calls.push({ key, purpose: expected.purpose, providerId });
    return new Response(JSON.stringify({ id: providerId }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
  log: new Log(LogLevel.ERROR),
});
try {
  await mf.ready;
  const DB = await mf.getD1Database('DB');
  const env = { DB, RESEND_API_KEY: fixtureKey, ORDER_EMAIL_FROM: sender };
  for (const name of (await fs.readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await fs.readFile(path.join(root, 'drizzle', name), 'utf8');
    await DB.batch(migrationStatements(sql).map(statement => DB.prepare(statement)));
  }
  await DB.batch(registry.reports.map(report => DB.prepare('INSERT INTO coa_original_reports(sha256,data,enabled) VALUES(?,?,1)').bind(report.sha256, JSON.stringify(report))));
  await DB.batch([
    DB.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').bind(expired, 'home', 'internal', 2),
    DB.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').bind(retained, 'home', 'internal', 3),
    DB.prepare('INSERT INTO shopping_daily VALUES(?,?,?)').bind(expired, 'cart_view', 4),
    DB.prepare('INSERT INTO shopping_daily VALUES(?,?,?)').bind(retained, 'cart_view', 5),
  ]);
  const seed = async (report = registry.reports[0], options = {}) => {
    const id = requestId();
    await DB.prepare('INSERT INTO requests(id,kind,data,created) VALUES(?,?,?,?)').bind(id, 'contact', JSON.stringify({ name: 'Synthetic inquiry', email: `customer-fixture-${requestCounter}@example.invalid`, subject: options.subject || `COA request: ${report.productName} / ${report.lot}`, message: 'PRIVATE_FIXTURE_REQUEST_TEXT' }), now).run();
    return id;
  };
  const snapshot = async () => {
    const rows = (await DB.prepare('SELECT * FROM coa_delivery_outbox').all()).results;
    for (const row of rows) expectedMessages.set(row.idempotency_key, row);
    return rows;
  };
  const cron = async (value = '*/5 * * * *') => {
    const result = await mf.dispatchFetch('http://localhost/cdn-cgi/handler/scheduled?cron=' + encodeURIComponent(value));
    const body = await result.text(); assert.equal(result.status, 200, 'Built scheduled handler must finish: ' + body.slice(0, 500));
  };
  // Cron cannot create messages by scanning old/unprocessed inquiries.
  const unqueued = await seed();
  await cron(); assert.equal(calls.length, 0); assert.equal((await snapshot()).length, 0);
  await saveCoaConfig(env, settings);
  const requests = [];
  for (const report of registry.reports) { const id = await seed(report); requests.push(id); await enqueueCoaRequest(env, id); }
  await enqueueRequestAlert(env, requests[0]);
  const unmatched = await seed(undefined, { subject: 'COA request: HEAT-R 20mg / 102-30-0001' });
  await enqueueCoaRequest(env, unmatched);
  let rows = await snapshot(); assert.equal(rows.length, 5); assert.equal(rows.filter(row => row.status === 'queued').length, 4);
  const oldCoas = rows.filter(row => row.purpose === 'coa');
  await saveCoaConfig(env, { ...settings, enabled: false });
  await cron(); assert.equal(calls.length, 0); assert((await snapshot()).every(row => row.attempts === 0));
  // Reconfiguration cannot reroute or alter previously queued messages.
  await saveCoaConfig(env, { ...settings, replyTo: 'changed-reply@example.invalid', notifyTo: 'changed-alerts@example.invalid' });
  await cron(); assert.equal(calls.length, 1); assert.equal(calls.filter(call => call.purpose === 'coa').length, 0);
  rows = await snapshot();
  for (const row of rows.filter(row => row.status === 'accepted')) {
    assert.equal(row.attempts, 1); assert(row.accepted_at >= now); assert.equal(row.reply_to, settings.replyTo);
    assert.equal(calls.find(call => call.key === row.idempotency_key)?.providerId, row.provider_id);
  }
  assert.equal(rows.find(row => row.request_id === unmatched).status, 'manual_review');
  assert(!rows.some(row => row.request_id === unqueued), 'Cron never scans/queues historical inquiries');
  await cron(); assert.equal(calls.length, 1, 'Accepted emails cannot be resent by later cron runs');
  assert(await DB.prepare('SELECT day FROM traffic_daily WHERE day=?').bind(expired).first(), 'COA cron must not run daily cleanup');
  // Daily retention remains separate and preserves the outbox/accepted states.
  await cron('0 9 * * *'); assert.equal(calls.length, 1);
  assert.equal(await DB.prepare('SELECT day FROM traffic_daily WHERE day=?').bind(expired).first(), null);
  assert.equal(await DB.prepare('SELECT day FROM shopping_daily WHERE day=?').bind(expired).first(), null);
  assert.equal((await DB.prepare('SELECT event_count n FROM traffic_daily WHERE day=?').bind(retained).first()).n, 3);
  assert.equal((await DB.prepare('SELECT event_count n FROM shopping_daily WHERE day=?').bind(retained).first()).n, 5);
  assert.equal((await DB.prepare('SELECT last_status FROM traffic_metrics_health WHERE id=1').first()).last_status, 'ok');
  assert.equal((await snapshot()).filter(row => row.status === 'accepted').length, 1);
  // The production cron's actual handler processes at most five jobs per invocation.
  for (let i = 0; i < 6; i++) await enqueueRequestAlert(env, await seed());
  await snapshot(); await cron(); assert.equal(calls.length, 6); assert.equal((await snapshot()).filter(row => row.purpose === 'request-alert' && row.status === 'queued').length, 1);
  await cron(); assert.equal(calls.length, 7); assert.equal((await snapshot()).filter(row => row.purpose === 'request-alert' && row.status === 'queued').length, 0);
  const disabledJob = await seed(); await enqueueRequestAlert(env, disabledJob); await snapshot();
  await saveCoaConfig(env, { ...settings, enabled: false }); await cron(); assert.equal(calls.length, 7);
  assert.equal((await DB.prepare('SELECT attempts FROM coa_delivery_outbox WHERE request_id=?').bind(disabledJob).first()).attempts, 0);
  assert.deepEqual((await snapshot()).filter(row => row.purpose === 'coa'), oldCoas, 'All legacy COA queue and review rows remain untouched');
  assert.equal(forbiddenOutbound, 0);
  assert.equal(new Set(calls.map(call => call.key)).size, calls.length, 'Every accepted fixture send had one unique provider request');
  for (const table of ['orders','profiles','addresses','sessions']) assert.equal((await DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n, 0, 'Full schema contains no customer or commerce records');
  const history = (await DB.prepare('SELECT * FROM change_events').all()).results;
  const emailChanges = history.filter(event => event.entity_type === 'email_job' && event.action === 'email_job.update');
  assert.equal(emailChanges.filter(event => JSON.parse(event.changes).some(change => change.field === 'Status' && change.after === 'sending')).length, 7, 'Actual UPDATE RETURNING claims must be audited');
  assert.equal(emailChanges.filter(event => JSON.parse(event.changes).some(change => change.field === 'Status' && change.after === 'accepted')).length, 7);
  for (const event of emailChanges) { assert.equal(event.actor, 'COA email scheduler'); assert.equal(event.actor_type, 'system'); assert.equal(event.source, 'system'); }
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM change_context').first()).n, 0);
  for (const privateValue of ['PRIVATE_FIXTURE_REQUEST_TEXT', 'customer-fixture', settings.replyTo, settings.notifyTo, calls[0].providerId, registry.reports[0].base64]) assert(!JSON.stringify(history).includes(privateValue), 'Audit history excludes private mail content and delivery references');
  console.log('PASS: actual built Worker five-minute staff-alert cron, isolated D1 queue only, retired COA queue unchanged and no attachments, immutable sender/reply-to, mocked acceptance persisted once, disabled no-send, five-job bound, and unaffected daily traffic/shopping retention. No real mail, customer records or production calls.');
} finally {
  await mf.dispose();
  await fs.rm(temporary, { recursive: true, force: true });
}
