/* Isolated SQLite and native request tests. No network or production records. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const shared = require('../lib/traffic-metrics.ts');
const server = require('../lib/traffic-metrics-server.ts');
const migration = fs.readFileSync(path.join(__dirname, '../drizzle/0014_aggregate_traffic.sql'), 'utf8');
const { TRAFFIC_DAY_MS: DAY, TRAFFIC_DAILY_CAP: CAP, TRAFFIC_ORIGIN: ORIGIN } = shared;
const now = Date.parse('2026-10-10T12:30:00.000Z');
const started = '2026-10-06T13:20:00.000Z';
const event = { event: 'page_view', pageGroup: 'product', sourceGroup: 'search' };
const sensitive = 'PRIVATE_FIXTURE_INFORMATION_NEVER_REPORT';
let queries = [], fail = false, batchFail = false, dbCalls = 0;
const sqlite = new DatabaseSync(':memory:'); sqlite.exec(migration);
function wrapper(sql, values = []) {
  return {
    bind: (...next) => wrapper(sql, next),
    first: async () => { queries.push({ sql, values }); if (fail) throw Error(sensitive); return sqlite.prepare(sql).get(...values) || null; },
    all: async () => { queries.push({ sql, values }); if (fail) throw Error(sensitive); return { results: sqlite.prepare(sql).all(...values) }; },
    run: async () => { queries.push({ sql, values }); if (fail) throw Error(sensitive); return { meta: sqlite.prepare(sql).run(...values) }; },
    _execute: () => { queries.push({ sql, values }); return sqlite.prepare(sql).run(...values); },
  };
}
const db = {
  prepare: sql => wrapper(sql),
  batch: async statements => {
    if (fail || batchFail) throw Error(sensitive);
    sqlite.exec('BEGIN');
    try { const result = statements.map(s => s._execute()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
let env = { TRAFFIC_MEASUREMENT_ENABLED: 'true', TRAFFIC_MEASUREMENT_STARTED_AT: started };
const deps = { env: () => env, database: () => { dbCalls++; return db; }, now: () => now };
const reportDeps = { ...deps, requireAdmin: async () => {} };
const count = () => sqlite.prepare('SELECT COALESCE(SUM(event_count),0) AS total FROM traffic_daily').get().total;
const headerDefaults = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
function request(body = event, options = {}) {
  const headers = { ...headerDefaults, ...options.headers };
  for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
  return new Request(options.url || ORIGIN + '/api/metrics', {
    method: options.method || 'POST', headers,
    ...((options.method || 'POST') !== 'GET' ? { body: options.raw ?? JSON.stringify(body), duplex: 'half' } : {}),
  });
}
const reportRequest = query => new Request(ORIGIN + '/api/metrics/report' + (query || ''));
const insert = (day, page = 'home', source = 'internal', n = 1) => sqlite.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').run(day, page, source, n);
const noCookies = response => { assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('access-control-allow-origin'), null); assert.equal(response.headers.get('cache-control'), 'no-store'); };
(async () => {
  assert.equal(shared.TRAFFIC_PAGE_GROUPS.length, 9); assert.equal(shared.TRAFFIC_SOURCE_GROUPS.length, 6);
  assert(shared.validTrafficEvent(event));
  for (const bad of [null, [], 'x', {}, { ...event, path: '/product/private' }, { ...event, event: 'checkout' }, { ...event, pageGroup: '__proto__' }, { ...event, sourceGroup: 'google' }, { ...event, pageGroup: 1 }]) assert(!shared.validTrafficEvent(bad));
  assert.equal(shared.trafficConfiguration({}, now).enabled, false);
  assert.equal(shared.trafficConfiguration(env, now).enabled, true);
  for (const stamp of [undefined, '', '2026-02-30T00:00:00Z', '2026-10-06', '2026-10-06T00:00:00+00:00', '2026-10-06T25:00:00Z', 'garbage']) {
    assert.equal(shared.trafficConfiguration({ ...env, TRAFFIC_MEASUREMENT_STARTED_AT: stamp }, now).reason, 'start_missing_or_invalid');
  }
  assert.equal(shared.trafficConfiguration({ ...env, TRAFFIC_MEASUREMENT_STARTED_AT: '2026-10-11T00:00:00Z' }, now).reason, 'start_in_future');
  for (const flag of [undefined, 'TRUE', '1', '', 'false']) assert.equal(shared.trafficConfiguration({ ...env, TRAFFIC_MEASUREMENT_ENABLED: flag }, now).enabled, false);
  for (const invalidTime of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => shared.trafficUtcDay(invalidTime));
  assert.equal(shared.trafficUtcDay(Date.parse('2026-10-10T00:00:00Z') - 1), '2026-10-09');
  assert.equal(shared.trafficUtcDay(Date.parse('2026-10-10T00:00:00Z')), '2026-10-10');

  // Strict request validation occurs before any storage access. No client-supplied identifiers.
  const invalidCases = [
    [{ ...event, url: sensitive }, {}, 400], [{ ...event, sourceGroup: sensitive }, {}, 400],
    [event, { url: 'http://trybiomod.com/api/metrics' }, 403], [event, { url: 'https://www.trybiomod.com/api/metrics' }, 403],
    [event, { url: 'https://preview.workers.dev/api/metrics' }, 403],
    [event, { url: ORIGIN + '/api/metrics?utm_source=secret' }, 400],
    [event, { url: ORIGIN + '/api/metrics#secret' }, 400], [event, { url: ORIGIN + '/api/store/metrics' }, 400],
    [event, { headers: { origin: null } }, 403], [event, { headers: { origin: 'https://evil.trybiomod.com' } }, 403],
    [event, { headers: { origin: 'https://trybiomod.com.evil.invalid' } }, 403],
    [event, { headers: { 'sec-fetch-site': null } }, 403], [event, { headers: { 'sec-fetch-site': 'same-site' } }, 403],
    [event, { headers: { 'content-type': 'text/plain' } }, 400], [event, { headers: { 'content-type': 'application/json;charset=latin1' } }, 400],
    [event, { headers: { 'content-encoding': 'gzip' } }, 400], [event, { raw: '{invalid' }, 400],
    [event, { raw: 'x'.repeat(257) }, 400], [event, { headers: { 'content-length': '257' } }, 400],
    [event, { method: 'GET' }, 403], [event, { raw: 'null' }, 400], [event, { raw: '[]' }, 400],
  ];
  for (const [body, options, expected] of invalidCases) {
    const before = dbCalls; const result = await server.handleTrafficPost(request(body, options), deps);
    assert.equal(result.status, expected); assert.equal(dbCalls, before); noCookies(result); assert(!(await result.text()).includes(sensitive));
  }
  for (const headers of [{ 'sec-gpc': '1' }, { dnt: '1' }]) {
    const before = dbCalls; const result = await server.handleTrafficPost(request(event, { headers }), deps);
    assert.equal(result.status, 204); assert.equal(dbCalls, before); noCookies(result);
  }
  env = {}; assert.equal((await server.handleTrafficPost(request(), deps)).status, 204); assert.equal(count(), 0); env = { TRAFFIC_MEASUREMENT_ENABLED: 'true', TRAFFIC_MEASUREMENT_STARTED_AT: started };
  // Streaming rather than content-length trust; force multiple chunks above the byte bound.
  let cancelled = false;
  const streaming = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(128).fill(32)); controller.enqueue(new Uint8Array(129).fill(32)); }, cancel() { cancelled = true; } });
  const streamResponse = await server.handleTrafficPost(request(event, { raw: streaming, headers: { 'content-length': '1' } }), deps);
  assert.equal(streamResponse.status, 400); assert(cancelled); assert.equal(count(), 0);
  const invalidUtf8 = new Uint8Array([0xff, 0xfe]);
  assert.equal((await server.handleTrafficPost(request(event, { raw: invalidUtf8 }), deps)).status, 400);
  const padded = JSON.stringify(event).padEnd(256, ' ');
  const good = await server.handleTrafficPost(request(event, { raw: padded }), deps);
  assert.equal(good.status, 204); noCookies(good); assert.equal(count(), 1);
  // Harmless transport headers are never read, persisted, echoed, or used for limiting.
  const privateHeaders = new Headers(headerDefaults);
  privateHeaders.set('cookie', sensitive); privateHeaders.set('cf-connecting-ip', sensitive); privateHeaders.set('user-agent', sensitive); privateHeaders.set('referer', sensitive);
  const nativeGet = privateHeaders.get.bind(privateHeaders);
  privateHeaders.get = name => { assert(!['cookie','cf-connecting-ip','user-agent','referer','x-forwarded-for'].includes(name.toLowerCase())); return nativeGet(name); };
  const req = request(); Object.defineProperty(req, 'headers', { value: privateHeaders });
  assert.equal((await server.handleTrafficPost(req, deps)).status, 204);
  assert.equal(count(), 2); assert(!JSON.stringify(queries).includes(sensitive));

  // Schema allows no hidden event attributes, limits category/date/count inputs, and has one metadata row.
  assert.deepEqual(sqlite.prepare('PRAGMA table_info(traffic_daily)').all().map(r => r.name), ['day','page_group','source_group','event_count']);
  assert.deepEqual(sqlite.prepare('PRAGMA table_info(traffic_metrics_health)').all().map(r => r.name), ['id','last_attempt','last_success','last_failure','last_status']);
  for (const row of [['2026-02-30','home','internal',1], ['2026-01-01','secret','internal',1], ['2026-01-01','home','private',1], ['2026-01-01','home','internal',0], ['2026-01-01','home','internal',50001], ['2026-01-01','home','internal',1.2]]) assert.throws(() => insert(...row));
  assert.throws(() => sqlite.prepare('INSERT INTO traffic_metrics_health VALUES(2,1,1,NULL,\'ok\')').run());
  const todayMs = Math.floor(now / DAY) * DAY;
  const cutoff = shared.trafficUtcDay(todayMs - 89 * DAY), expired = shared.trafficUtcDay(todayMs - 90 * DAY);
  insert(cutoff); insert(expired);
  const health = await server.cleanupTraffic(db, now);
  assert.equal(health.status, 'ok'); assert.equal(health.lastSuccessAt, new Date(now).toISOString());
  assert(sqlite.prepare('SELECT day FROM traffic_daily WHERE day=?').get(cutoff));
  assert.equal(sqlite.prepare('SELECT day FROM traffic_daily WHERE day=?').get(expired), undefined);
  // Cleanup failure is visible, retains prior success, and never exposes the storage error.
  batchFail = true; await assert.rejects(server.cleanupTraffic(db, now + 1), /^Error: Traffic storage is unavailable\.$/); batchFail = false;
  let savedHealth = sqlite.prepare('SELECT * FROM traffic_metrics_health').get();
  assert.equal(savedHealth.last_status, 'failed'); assert.equal(savedHealth.last_success, now); assert.equal(savedHealth.last_failure, now + 1);
  const recovered = await server.cleanupTraffic(db, now + 2);
  assert.equal(recovered.status, 'ok'); assert.equal(recovered.lastFailureAt, new Date(now + 1).toISOString());

  // Authorization precedes malformed-query handling, configuration inspection, and every DB access.
  let touched = false;
  const forbiddenDeps = { requireAdmin: async () => { throw Error(sensitive); }, env: () => { touched = true; return env; }, database: () => { touched = true; return db; } };
  const denied = await server.trafficReport(reportRequest('?days=not-a-number'), forbiddenDeps);
  assert.equal(denied.status, 403); assert(!touched); assert(!(await denied.text()).includes(sensitive)); noCookies(denied);
  for (const query of ['?days=1','?days=07','?days=all','?days=7&days=30','?days=7&email=private']) {
    const before = dbCalls; assert.equal((await server.trafficReport(reportRequest(query), reportDeps)).status, 400); assert.equal(dbCalls, before);
  }
  sqlite.exec('DELETE FROM traffic_daily');
  insert('2026-10-05','home','search',5); insert('2026-10-06','home','search',6);
  insert('2026-10-07','product','ai',7); insert('2026-10-08','catalog','internal',8); insert('2026-10-10','guide','external_other',10);
  let report = await (await server.trafficReport(reportRequest('?days=7'), reportDeps)).json();
  assert.equal(report.status,'available'); assert.equal(report.window.timeZone,'UTC');
  assert.deepEqual(report.completedDays.map(d=>d.date),['2026-10-07','2026-10-08','2026-10-09']);
  assert.equal(report.totals.events,15); assert.equal(report.activationDayPartial.events,6); assert.equal(report.partialToday.events,10);
  assert.equal(report.completedDays[2].events,0); assert.equal(report.cleanup.status,'ok');
  assert(!JSON.stringify(report).includes(sensitive)); assert(!report.completedDays.some(d=>d.date==='2026-10-05'));
  env.TRAFFIC_MEASUREMENT_STARTED_AT='2026-10-06T00:00:00Z';
  report=await(await server.trafficReport(reportRequest('?days=7'),reportDeps)).json();
  assert.equal(report.activationDayPartial,null); assert.equal(report.totals.events,21);
  env.TRAFFIC_MEASUREMENT_STARTED_AT='2026-10-10T11:00:00Z';
  report=await(await server.trafficReport(reportRequest(),reportDeps)).json();
  assert.equal(report.completedDays.length,0); assert.equal(report.totals.events,null); assert.equal(report.activationDayPartial,null); assert.equal(report.partialToday.events,10);
  env={};report=await(await server.trafficReport(reportRequest(),reportDeps)).json();
  assert.equal(report.status,'unavailable'); assert.equal(report.totals.events,null); assert.deepEqual(report.completedDays,[]); assert.equal(report.partialToday,null);
  env={TRAFFIC_MEASUREMENT_ENABLED:'true',TRAFFIC_MEASUREMENT_STARTED_AT:'2026-01-01T00:00:00Z'};
  report=await(await server.trafficReport(reportRequest('?days=90'),reportDeps)).json();
  assert.equal(report.completedDays.length,89); assert.equal(report.completedDays[0].date,cutoff);
  fail=true;
  let failedResponse=await server.handleTrafficPost(request(),deps);assert.equal(failedResponse.status,503); assert(!(await failedResponse.text()).includes(sensitive));
  failedResponse=await server.trafficReport(reportRequest(),reportDeps);assert.equal(failedResponse.status,503); assert(!(await failedResponse.text()).includes(sensitive));fail=false;

  // Real concurrently running SQLite connections prove the atomic global cap across category rows.
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'trybiomod-traffic-test-'));
  const filename=path.join(temp,'traffic.sqlite');
  const parallelDb=new DatabaseSync(filename); parallelDb.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');parallelDb.exec(migration);
  parallelDb.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').run('2026-10-10','home','direct_or_unavailable',CAP-20);
  const gate=new SharedArrayBuffer(4);
  const workerCode=`const {parentPort,workerData}=require('node:worker_threads');const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.filename);db.exec('PRAGMA busy_timeout=10000;');const gate=new Int32Array(workerData.gate);while(Atomics.load(gate,0)===0)Atomics.wait(gate,0,0);let accepted=0;for(let i=0;i<100;i++){const row=db.prepare(workerData.query).get('2026-10-10',workerData.page,workerData.source,'2026-10-10',50000);if(row)accepted++;}db.close();parentPort.postMessage(accepted);`;
  try {
    const workers=Array.from({length:8},(_,i)=>new Worker(workerCode,{eval:true,workerData:{filename,gate,query:server.trafficSql.record,page:shared.TRAFFIC_PAGE_GROUPS[i],source:shared.TRAFFIC_SOURCE_GROUPS[i%6]}}));
    const outcomes=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('Worker failed '+code));});}));
    Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);
    const increments=await Promise.all(outcomes);
    assert.equal(increments.reduce((a,b)=>a+b,0),20);
    assert.equal(parallelDb.prepare('SELECT SUM(event_count) n FROM traffic_daily').get().n,CAP);
    assert.equal(parallelDb.prepare(server.trafficSql.record).get('2026-10-10','policy','social','2026-10-10',CAP),undefined);
  } finally {parallelDb.close();fs.rmSync(temp,{recursive:true,force:true});}
  sqlite.exec('DELETE FROM traffic_daily');insert('2026-10-10','home','internal',CAP);
  const atCap=await server.handleTrafficPost(request(),deps);assert.equal(atCap.status,204);assert.equal(count(),CAP);
  report=await(await server.trafficReport(reportRequest('?days=7'),reportDeps)).json();
  assert(report.partialToday.capReached);assert(report.cap.daysReached.includes('2026-10-10'));
  // Cross-row corrupted sums become unavailable, never falsely report success or fabricate lower counts.
  insert('2026-10-10','catalog','internal',1);
  assert.equal((await server.trafficReport(reportRequest(),reportDeps)).status,503);
  const sharedSource=fs.readFileSync(path.join(__dirname,'../lib/traffic-metrics.ts'),'utf8');
  assert.doesNotMatch(sharedSource,/^import\s/m,'The client contract cannot import catalog/server bundles');
  const ingestSource=fs.readFileSync(path.join(__dirname,'../app/api/metrics/route.ts'),'utf8');
  assert.doesNotMatch(ingestSource,/auth|session|rateLimit/);
  const serverSource=fs.readFileSync(path.join(__dirname,'../lib/traffic-metrics-server.ts'),'utf8');
  assert.doesNotMatch(serverSource,/console\.|cf-connecting-ip|x-forwarded-for|\.cookies\b/);
  sqlite.close();
  console.log('Traffic backend passed: strict streamed ingestion, opt-outs, no identifiers/cookies, UTC reports, admin-first authorization, global concurrent cap, retention and failure health.');
})().catch(error=>{console.error(error);process.exitCode=1;});
