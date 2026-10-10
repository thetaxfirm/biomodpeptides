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
  bindings: { TRAFFIC_MEASUREMENT_ENABLED: 'true', TRAFFIC_MEASUREMENT_STARTED_AT: new Date(now - dayMs).toISOString() },
  d1Databases: { DB: 'isolated-traffic-database' },
  d1Persist: path.join(temporary, 'd1'),
  outboundService: () => { outboundAttempts++; throw new Error('External services are disabled in this isolated test.'); },
  log: new Log(LogLevel.ERROR),
});
try {
  await mf.ready;
  const db = await mf.getD1Database('DB');
  const migration = await fs.readFile(path.join(root, 'drizzle/0014_aggregate_traffic.sql'), 'utf8');
  // D1 exec parses each statement; strip comment-only lines without altering SQL.
  const statements = migration.replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean);
  await db.batch(statements.map(sql => db.prepare(sql)));
  await db.batch([
    db.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').bind(expired, 'home', 'internal', 2),
    db.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').bind(cutoff, 'home', 'internal', 3),
  ]);
  const scheduled = await mf.dispatchFetch('http://localhost/cdn-cgi/handler/scheduled?cron=0%209%20*%20*%20*');
  assert.equal(scheduled.status, 200, 'Built scheduled handler must complete: ' + (await scheduled.text()).slice(0, 500));
  assert.equal(await db.prepare('SELECT day FROM traffic_daily WHERE day=?').bind(expired).first(), null);
  assert.equal((await db.prepare('SELECT event_count n FROM traffic_daily WHERE day=?').bind(cutoff).first()).n, 3, 'Exact retention boundary survives');
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
  const rejected = await mf.dispatchFetch(origin + '/api/metrics', { method: 'POST', headers: { ...headers, origin: 'https://unrelated.invalid' }, body: payload });
  assert.equal(rejected.status, 403); assert.equal(await total(), 4);
  const report = await mf.dispatchFetch(origin + '/api/metrics/report?days=invalid');
  assert.equal(report.status, 403, 'Anonymous authorization failure precedes invalid query validation in actual route');
  assert.equal(report.headers.get('set-cookie'), null); assert.equal(await total(), 4);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('sessions','rate_limits','orders')").first()).n, 0, 'Metrics work without commerce tables or sessions');
  assert.equal(outboundAttempts, 0, 'No external services were contacted');
  console.log('PASS: actual built Worker scheduled cleanup, local D1 transaction/retention boundary and health, one isolated ingestion, GPC/DNT no-write, foreign-origin rejection, no cookies, and report authorization before validation. Production untouched.');
} finally {
  await mf.dispose();
  await fs.rm(temporary, { recursive: true, force: true });
}
