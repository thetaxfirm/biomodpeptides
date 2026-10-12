import { migrationStatements } from './sql-migration-fixture.mjs';
// Actual built Worker + isolated local D1. No environment files, network services,
// production bindings, customer data, or production event submissions are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(root, 'dist/server');
const config = JSON.parse(await fs.readFile(path.join(built, 'wrangler.json'), 'utf8'));
assert.equal(config.main, 'index.js');
assert(config.triggers?.crons?.includes('0 9 * * *'), 'Built configuration must retain the daily cleanup cron');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trybiomod-worker-metrics-'));
const now = Date.now();
const dayMs = 86400000;
const midnight = Math.floor(now / dayMs) * dayMs;
const day = value => new Date(value).toISOString().slice(0, 10);
const cutoff = day(midnight - 89 * dayMs);
const expired = day(midnight - 90 * dayMs);
const origin = 'https://trybiomod.com';
// The framework contains computed imports; enumerate its built ES modules explicitly.
const modulePaths = (await fs.readdir(built, { recursive: true })).filter(name => /\.(?:m?js)$/.test(name));
const modules = [config.main, ...modulePaths.filter(name => name !== config.main)].map(name => ({ type: 'ESModule', path: path.join(built, name) }));
assert(config.rules.some(rule => rule.type === 'ESModule'), 'Use the deployed ES-module rule');
let outboundAttempts = 0;
const mf = new Miniflare({
  name: 'isolated-traffic-worker',
  cf: false,
  unsafeTriggerHandlers: true,
  modules,
  modulesRoot: built,
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags,
  bindings: { TRAFFIC_MEASUREMENT_ENABLED: 'true', TRAFFIC_MEASUREMENT_STARTED_AT: new Date(now - dayMs).toISOString(), SHOPPING_MEASUREMENT_ENABLED: 'true', SHOPPING_MEASUREMENT_STARTED_AT: new Date(now - dayMs).toISOString() },
  d1Databases: { DB: 'isolated-traffic-database' },
  d1Persist: path.join(temporary, 'd1'),
  outboundService: () => { outboundAttempts++; throw new Error('External services are disabled in this isolated test.'); },
  log: new Log(LogLevel.ERROR),
});
try {
  await mf.ready;
  const db = await mf.getD1Database('DB');
  for (const name of (await fs.readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await fs.readFile(path.join(root, 'drizzle', name), 'utf8');
    await db.batch(migrationStatements(sql).map(statement => db.prepare(statement)));
  }
  await db.batch([
    db.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').bind(expired, 'home', 'internal', 2),
    db.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').bind(cutoff, 'home', 'internal', 3),
    db.prepare('INSERT INTO shopping_daily VALUES(?,?,?)').bind(expired, 'cart_view', 4),
    db.prepare('INSERT INTO shopping_daily VALUES(?,?,?)').bind(cutoff, 'cart_view', 5),
  ]);
  const scheduled = await mf.dispatchFetch('http://localhost/cdn-cgi/handler/scheduled?cron=0%209%20*%20*%20*');
  assert.equal(scheduled.status, 200, 'Built scheduled handler must complete: ' + (await scheduled.text()).slice(0, 500));
  assert.equal(await db.prepare('SELECT day FROM traffic_daily WHERE day=?').bind(expired).first(), null);
  assert.equal((await db.prepare('SELECT event_count n FROM traffic_daily WHERE day=?').bind(cutoff).first()).n, 3, 'Exact retention boundary survives');
  assert.equal(await db.prepare('SELECT day FROM shopping_daily WHERE day=?').bind(expired).first(), null);
  assert.equal((await db.prepare('SELECT event_count n FROM shopping_daily WHERE day=?').bind(cutoff).first()).n, 5, 'Shopping retention boundary survives the same scheduled transaction');
  const health = await db.prepare('SELECT last_attempt,last_success,last_failure,last_status FROM traffic_metrics_health WHERE id=1').first();
  assert.equal(health.last_status, 'ok'); assert(health.last_success >= now); assert.equal(health.last_failure, null);
  const total = async () => (await db.prepare('SELECT COALESCE(SUM(event_count),0) n FROM traffic_daily').first()).n;
  const headers = { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const payload = JSON.stringify({ event: 'page_view', pageGroup: 'product', sourceGroup: 'search' });
  const accepted = await mf.dispatchFetch(origin + '/api/metrics', { method: 'POST', headers, body: payload });
  assert.equal(accepted.status, 204); assert.equal(accepted.headers.get('set-cookie'), null); assert.equal(accepted.headers.get('cache-control'), 'no-store');
  assert.equal(await total(), 4, 'Exactly one isolated test event recorded through actual built Worker');
  assert.equal((await db.prepare('SELECT event_count n FROM traffic_daily WHERE day=? AND page_group=? AND source_group=?').bind(day(now), 'product', 'search').first()).n, 1);
  for (const optOut of [{ 'sec-gpc': '1' }, { dnt: '1' }]) {
    const ignored = await mf.dispatchFetch(origin + '/api/metrics', { method: 'POST', headers: { ...headers, ...optOut }, body: payload });
    assert.equal(ignored.status, 204); assert.equal(ignored.headers.get('set-cookie'), null); assert.equal(await total(), 4);
  }
  const shoppingTotal = async () => (await db.prepare('SELECT COALESCE(SUM(event_count),0) n FROM shopping_daily').first()).n;
  const shoppingPayload = JSON.stringify({ event: 'checkout_handoff_ready' });
  const shoppingAccepted = await mf.dispatchFetch(origin + '/api/metrics', { method: 'POST', headers, body: shoppingPayload });
  assert.equal(shoppingAccepted.status, 204); assert.equal(shoppingAccepted.headers.get('set-cookie'), null);
  assert.equal(await shoppingTotal(), 6); assert.equal(await total(), 4, 'Shopping stage does not increment public page views');
  for (const optOut of [{ 'sec-gpc': '1' }, { dnt: '1' }]) {
    const ignored = await mf.dispatchFetch(origin + '/api/metrics', { method: 'POST', headers: { ...headers, ...optOut }, body: shoppingPayload });
    assert.equal(ignored.status, 204); assert.equal(await shoppingTotal(), 6);
  }
  const badShopping = await mf.dispatchFetch(origin + '/api/metrics', { method: 'POST', headers, body: JSON.stringify({ event: 'cart_view', productId: 'forbidden-fixture' }) });
  assert.equal(badShopping.status, 400); assert.equal(await shoppingTotal(), 6);
  const shoppingReport = await mf.dispatchFetch(origin + '/api/metrics/shopping-report?days=invalid');
  assert.equal(shoppingReport.status, 403); assert.equal(shoppingReport.headers.get('set-cookie'), null); assert.equal(await shoppingTotal(), 6);
  const rejected = await mf.dispatchFetch(origin + '/api/metrics', { method: 'POST', headers: { ...headers, origin: 'https://unrelated.invalid' }, body: payload });
  assert.equal(rejected.status, 403); assert.equal(await total(), 4);
  const report = await mf.dispatchFetch(origin + '/api/metrics/report?days=invalid');
  assert.equal(report.status, 403, 'Anonymous authorization failure precedes invalid query validation in actual route');
  assert.equal(report.headers.get('set-cookie'), null); assert.equal(await total(), 4);
  for (const table of ['sessions','rate_limits','orders']) assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n, 0, 'Metrics create no customer sessions, rate-limit identities or commerce records');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM change_events').first()).n, 0, 'Routine page/stage events and retention housekeeping must not create admin history noise');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM change_context').first()).n, 0);
  assert.equal(outboundAttempts, 0, 'No external services were contacted');
  console.log('PASS: actual built Worker scheduled cleanup, local D1 transaction/retention boundary and health, separate isolated page/stage ingestion, GPC/DNT no-write, foreign-origin rejection, no cookies, and report authorization before validation. Production untouched.');
} finally {
  await mf.dispose();
  await fs.rm(temporary, { recursive: true, force: true });
}
