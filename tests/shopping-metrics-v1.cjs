/* Actual metrics handlers/routes with isolated SQLite. No live services, credentials or orders. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const traffic = require('../lib/traffic-metrics.ts');
const shared = require('../lib/shopping-metrics.ts');
const server = require('../lib/traffic-metrics-server.ts');
const migration = ['0014_aggregate_traffic.sql', '0015_aggregate_shopping.sql'].map(name => fs.readFileSync(path.join(__dirname, '../drizzle', name), 'utf8')).join('\n');
const { TRAFFIC_ORIGIN: ORIGIN, TRAFFIC_DAY_MS: DAY } = traffic;
const { SHOPPING_STAGES: STAGES, SHOPPING_DAILY_CAP: CAP } = shared;
const now = Date.parse('2026-10-10T12:30:00.000Z');
const started = '2026-10-06T13:20:00.000Z';
const privateValue = 'PRIVATE_FIXTURE_NEVER_STORE_OR_REPORT';
const event = { event: 'cart_add_confirmed' };
const pageView = { event: 'page_view', pageGroup: 'product', sourceGroup: 'search' };
let queries = [], dbCalls = 0, fail = false;
const sqlite = new DatabaseSync(':memory:'); sqlite.exec(migration);
function statement(sql, values = []) {
  return {
    bind: (...next) => statement(sql, next),
    first: async () => { queries.push({sql,values}); if (fail) throw Error(privateValue); return sqlite.prepare(sql).get(...values) || null; },
    all: async () => { queries.push({sql,values}); if (fail) throw Error(privateValue); return { results: sqlite.prepare(sql).all(...values) }; },
    run: async () => { queries.push({sql,values}); if (fail) throw Error(privateValue); return { meta: sqlite.prepare(sql).run(...values) }; },
    execute: () => { queries.push({sql,values}); if (fail) throw Error(privateValue); return sqlite.prepare(sql).run(...values); },
  };
}
const db = { prepare: sql => statement(sql), batch: async statements => {
  sqlite.exec('BEGIN');
  try { const result = statements.map(item => item.execute()); sqlite.exec('COMMIT'); return result; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
}};
let env = { SHOPPING_MEASUREMENT_ENABLED: 'true', SHOPPING_MEASUREMENT_STARTED_AT: started };
const deps = { env: () => env, database: () => { dbCalls++; return db; }, now: () => now };
const reportDeps = { ...deps, requireAdmin: async () => {} };
const headers = { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
function request(body = event, options = {}) {
  const supplied = {...headers, ...options.headers};
  for (const key of Object.keys(supplied)) if (supplied[key] === null) delete supplied[key];
  return new Request(options.url || ORIGIN + '/api/metrics', { method: options.method || 'POST', headers: supplied,
    ...((options.method || 'POST') !== 'GET' ? {body: options.raw ?? JSON.stringify(body), duplex:'half'} : {}) });
}
const reportRequest = query => new Request(ORIGIN + '/api/metrics/shopping-report' + (query || ''));
const count = () => sqlite.prepare('SELECT COALESCE(SUM(event_count),0) n FROM shopping_daily').get().n;
const pageCount = () => sqlite.prepare('SELECT COALESCE(SUM(event_count),0) n FROM traffic_daily').get().n;
const insert = (day, stage = 'cart_view', n = 1) => sqlite.prepare('INSERT INTO shopping_daily VALUES(?,?,?)').run(day,stage,n);
const responseSafe = response => {assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(response.headers.get('cache-control'),'no-store');};
const originalFetch = global.fetch;
global.fetch = () => { throw Error('Network access is forbidden in this isolated test'); };
function route(relative, dependencies) {
  const filename = path.resolve(__dirname, '..', relative), mod = new Module(filename, module);
  mod.require = id => { if (Object.hasOwn(dependencies,id)) return dependencies[id]; throw Error('Unexpected route dependency '+id); };
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);
  return mod.exports;
}
(async () => {
  try {
    assert.equal(STAGES.length,6); assert.equal(shared.SHOPPING_RETENTION_DAYS,traffic.TRAFFIC_RETENTION_DAYS);
    for (const stage of STAGES) assert(shared.validShoppingEvent({event:stage}));
    for (const bad of [null, [], {}, 'cart_view', {event:'purchase'}, {event:'paid'}, {event:'checkout'}, {event:'__proto__'}, {event:1}, {...event,stage:'cart_view'}, {...event,pageGroup:'product'}, {...event,sourceGroup:'search'}, {...event,productId:1}, {...event,orderId:privateValue}, {...event,amount:1}, {...event,path:'/cart'}, {...event,query:'secret'}]) assert(!shared.validShoppingEvent(bad));
    assert(!shared.validShoppingEvent(pageView)); assert(!traffic.validTrafficEvent(event));
    assert.equal(shared.shoppingConfiguration(env,now).enabled,true);
    assert.equal(shared.shoppingConfiguration({TRAFFIC_MEASUREMENT_ENABLED:'true',TRAFFIC_MEASUREMENT_STARTED_AT:started},now).enabled,false);
    for (const value of [undefined,'','2026-02-30T00:00:00Z','2026-10-06','2026-10-06T00:00:00+00:00','garbage']) assert.equal(shared.shoppingConfiguration({...env,SHOPPING_MEASUREMENT_STARTED_AT:value},now).reason,'start_missing_or_invalid');
    for (const flag of [undefined,'TRUE','1','','false']) assert.equal(shared.shoppingConfiguration({...env,SHOPPING_MEASUREMENT_ENABLED:flag},now).enabled,false);
    assert.equal(shared.shoppingConfiguration({...env,SHOPPING_MEASUREMENT_STARTED_AT:'2026-10-11T00:00:00Z'},now).reason,'start_in_future');

    const rejected = [
      [{...event,email:privateValue},{},400], [{...event,sourceGroup:'search'},{},400], [pageView.event,{},400], [{event:'paid'},{},400],
      [event,{url:'http://trybiomod.com/api/metrics'},403], [event,{url:'https://www.trybiomod.com/api/metrics'},403],
      [event,{url:'https://preview.workers.dev/api/metrics'},403], [event,{url:ORIGIN+'/api/metrics?code=secret'},400],
      [event,{url:ORIGIN+'/api/store/metrics'},400], [event,{headers:{origin:null}},403],
      [event,{headers:{origin:'https://trybiomod.com.evil.invalid'}},403], [event,{headers:{'sec-fetch-site':'same-site'}},403],
      [event,{headers:{'sec-fetch-site':null}},403], [event,{headers:{'content-type':'text/plain'}},400],
      [event,{headers:{'content-encoding':'gzip'}},400], [event,{raw:'['},400], [event,{raw:' '.repeat(257)},400],
      [event,{headers:{'content-length':'257'}},400], [event,{method:'GET'},403],
    ];
    for (const [body, options, status] of rejected) {
      const before=dbCalls,result=await server.handleTrafficPost(request(body,options),deps);
      assert.equal(result.status,status);assert.equal(dbCalls,before);responseSafe(result);assert(!(await result.text()).includes(privateValue));
    }
    for (const privacy of [{'sec-gpc':'1'},{dnt:'1'}]) {
      const before=dbCalls,result=await server.handleTrafficPost(request(event,{headers:privacy}),deps);
      assert.equal(result.status,204);assert.equal(dbCalls,before);responseSafe(result);
    }
    env={TRAFFIC_MEASUREMENT_ENABLED:'true',TRAFFIC_MEASUREMENT_STARTED_AT:started};
    let before=dbCalls;assert.equal((await server.handleTrafficPost(request(),deps)).status,204);assert.equal(dbCalls,before);assert.equal(count(),0);
    assert.equal((await server.handleTrafficPost(request(pageView),deps)).status,204);assert.equal(pageCount(),1);
    env={SHOPPING_MEASUREMENT_ENABLED:'true',SHOPPING_MEASUREMENT_STARTED_AT:started};
    before=dbCalls;assert.equal((await server.handleTrafficPost(request(pageView),deps)).status,204);assert.equal(dbCalls,before);assert.equal(pageCount(),1);
    for (const stage of STAGES) { const result=await server.handleTrafficPost(request({event:stage}),deps);assert.equal(result.status,204);responseSafe(result); }
    assert.equal(count(),6);assert.equal(pageCount(),1);
    // Private headers are not read, stored, echoed or used for event validation.
    const guarded=new Headers({...headers,cookie:privateValue,'cf-connecting-ip':privateValue,referer:privateValue,'user-agent':privateValue});
    const nativeGet=guarded.get.bind(guarded);guarded.get=name=>{assert(!['cookie','cf-connecting-ip','referer','user-agent','x-forwarded-for'].includes(name.toLowerCase()));return nativeGet(name);};
    const req=request();Object.defineProperty(req,'headers',{value:guarded});assert.equal((await server.handleTrafficPost(req,deps)).status,204);
    assert(!JSON.stringify(queries).includes(privateValue));
    assert.deepEqual(sqlite.prepare('PRAGMA table_info(shopping_daily)').all().map(row=>row.name),['day','stage','event_count']);
    for (const row of [['2026-02-30','cart_view',1],['2026-01-01','paid',1],['2026-01-01','cart_view',0],['2026-01-01','cart_view',CAP+1],['2026-01-01','cart_view',1.1]]) assert.throws(()=>insert(...row));
    await assert.rejects(server.recordShopping(db,{event:'paid'},now),/Invalid shopping event/);

    // Both tables are cleaned in the same transaction; a later table failure rolls back earlier deletion.
    const todayMs=Math.floor(now/DAY)*DAY,cutoff=traffic.trafficUtcDay(todayMs-89*DAY),expired=traffic.trafficUtcDay(todayMs-90*DAY);
    insert(cutoff);insert(expired);
    sqlite.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').run(expired,'home','internal',1);
    sqlite.exec("CREATE TRIGGER block_shopping_cleanup BEFORE DELETE ON shopping_daily BEGIN SELECT RAISE(ABORT,'fixture cleanup failure'); END;");
    await assert.rejects(server.cleanupTraffic(db,now),/^Error: Traffic storage is unavailable\.$/);
    assert(sqlite.prepare('SELECT day FROM shopping_daily WHERE day=?').get(expired));assert(sqlite.prepare('SELECT day FROM traffic_daily WHERE day=?').get(expired));
    assert.equal(sqlite.prepare('SELECT last_status FROM traffic_metrics_health').get().last_status,'failed');
    sqlite.exec('DROP TRIGGER block_shopping_cleanup');
    const health=await server.cleanupTraffic(db,now+1);assert.equal(health.status,'ok');assert.equal(health.lastFailureAt,new Date(now).toISOString());
    assert(sqlite.prepare('SELECT day FROM shopping_daily WHERE day=?').get(cutoff));
    assert.equal(sqlite.prepare('SELECT day FROM shopping_daily WHERE day=?').get(expired),undefined);assert.equal(sqlite.prepare('SELECT day FROM traffic_daily WHERE day=?').get(expired),undefined);

    // Authorization is first in the actual route, including malformed queries.
    let touched=false;
    const actualReport=route('app/api/metrics/shopping-report/route.ts',{'@/lib/auth':{requireAdmin:async()=>{throw Error(privateValue);}},'@/lib/runtime':{runtime:()=>{touched=true;return env;},database:()=>{touched=true;return db;}},'@/lib/traffic-metrics-server':server});
    let result=await actualReport.GET(reportRequest('?days=invalid'));assert.equal(result.status,403);assert(!touched);responseSafe(result);assert(!(await result.text()).includes(privateValue));
    for (const query of ['?days=1','?days=07','?days=7&days=30','?days=30&customer=private']) {before=dbCalls;assert.equal((await server.shoppingReport(reportRequest(query),reportDeps)).status,400);assert.equal(dbCalls,before);}
    assert.equal((await server.shoppingReport(new Request(ORIGIN+'/api/metrics/shopping-report',{method:'POST'}),reportDeps)).status,400);
    sqlite.exec('DELETE FROM shopping_daily');
    insert('2026-10-05','cart_view',50);insert('2026-10-06','cart_view',6);insert('2026-10-07','cart_view',7);insert('2026-10-08','checkout_form_view',8);insert('2026-10-10','checkout_handoff_ready',10);
    let report=await(await server.shoppingReport(reportRequest('?days=7'),reportDeps)).json();
    assert.equal(report.status,'available');assert.deepEqual(report.completedDays.map(day=>day.date),['2026-10-07','2026-10-08','2026-10-09']);
    assert.equal(report.totals.events,15);assert.equal(report.activationDayPartial.events,6);assert.equal(report.partialToday.events,10);
    assert.equal(report.totals.byStage.find(row=>row.stage==='cart_view').events,7);assert.equal(report.completedDays[2].events,0);
    assert.equal(report.window.timeZone,'UTC');assert(!JSON.stringify(report).includes(privateValue));assert(!('bySourceGroup' in report.totals));
    env.SHOPPING_MEASUREMENT_STARTED_AT='2026-10-06T00:00:00Z';
    report=await(await server.shoppingReport(reportRequest(),reportDeps)).json();assert.equal(report.activationDayPartial,null);assert.equal(report.totals.events,21);
    env.SHOPPING_MEASUREMENT_ENABLED='false';
    report=await(await server.shoppingReport(reportRequest(),reportDeps)).json();assert.equal(report.configuration.enabled,false);assert.equal(report.totals.events,21,'Paused collection retains available historical counts');
    env.SHOPPING_MEASUREMENT_STARTED_AT='2026-10-10T11:00:00Z';
    report=await(await server.shoppingReport(reportRequest(),reportDeps)).json();assert.equal(report.totals.events,null);assert.equal(report.completedDays.length,0);assert.equal(report.activationDayPartial,null);assert.equal(report.partialToday.events,10);
    env={};report=await(await server.shoppingReport(reportRequest(),reportDeps)).json();assert.equal(report.status,'unavailable');assert.equal(report.totals.events,null);assert.deepEqual(report.completedDays,[]);assert.equal(report.partialToday,null);
    env={SHOPPING_MEASUREMENT_ENABLED:'true',SHOPPING_MEASUREMENT_STARTED_AT:'2026-01-01T00:00:00Z'};
    report=await(await server.shoppingReport(reportRequest('?days=90'),reportDeps)).json();assert.equal(report.completedDays.length,89);assert.equal(report.completedDays[0].date,cutoff);
    fail=true;
    for(const result of [await server.handleTrafficPost(request(),deps),await server.shoppingReport(reportRequest(),reportDeps)]){assert.equal(result.status,503);assert(!(await result.text()).includes(privateValue));responseSafe(result);}fail=false;
    // Actual POST route reaches the isolated handler, without session/auth or commerce tables.
    const actualPost=route('app/api/metrics/route.ts',{'@/lib/runtime':{runtime:()=>env,database:()=>db},'@/lib/traffic-metrics-server':{...server,handleTrafficPost:(req,dependencies)=>server.handleTrafficPost(req,{...dependencies,now:()=>now})}});
    before=count();assert.equal((await actualPost.POST(request())).status,204);assert.equal(count(),before+1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('orders','sessions','rate_limits')").get().n,0);

    // Eight concurrent SQLite connections cannot exceed the shared stage cap across six buckets.
    const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'trybiomod-shopping-test-')),filename=path.join(temporary,'shopping.sqlite');
    const parallel=new DatabaseSync(filename);parallel.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');parallel.exec(migration);
    parallel.prepare('INSERT INTO shopping_daily VALUES(?,?,?)').run('2026-10-10','cart_view',CAP-20);
    parallel.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').run('2026-10-10','home','internal',traffic.TRAFFIC_DAILY_CAP);
    const gate=new SharedArrayBuffer(4);
    const workerCode=`const{parentPort,workerData}=require('node:worker_threads');const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.filename);db.exec('PRAGMA busy_timeout=10000;');const gate=new Int32Array(workerData.gate);while(Atomics.load(gate,0)===0)Atomics.wait(gate,0,0);let accepted=0;for(let i=0;i<100;i++){const row=db.prepare(workerData.query).get('2026-10-10',workerData.stage,'2026-10-10',50000);if(row)accepted++;}db.close();parentPort.postMessage(accepted);`;
    try {
      const workers=Array.from({length:8},(_,i)=>new Worker(workerCode,{eval:true,workerData:{filename,gate,query:server.shoppingSql.record,stage:STAGES[i%STAGES.length]}}));
      const outcomes=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('Worker failed '+code));});}));
      Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0);
      const increments=await Promise.all(outcomes);assert.equal(increments.reduce((a,b)=>a+b,0),20);
      assert.equal(parallel.prepare('SELECT SUM(event_count) n FROM shopping_daily').get().n,CAP);
      assert.equal(parallel.prepare('SELECT SUM(event_count) n FROM traffic_daily').get().n,traffic.TRAFFIC_DAILY_CAP,'Stage and page-view caps are independent');
    } finally {parallel.close();fs.rmSync(temporary,{recursive:true,force:true});}
    sqlite.exec('DELETE FROM shopping_daily');insert('2026-10-10','cart_view',CAP);
    assert.equal((await server.handleTrafficPost(request(),deps)).status,204);assert.equal(count(),CAP);
    report=await(await server.shoppingReport(reportRequest(),reportDeps)).json();assert(report.partialToday.capReached);assert(report.cap.daysReached.includes('2026-10-10'));
    insert('2026-10-10','checkout_form_view',1);assert.equal((await server.shoppingReport(reportRequest(),reportDeps)).status,503,'Impossible aggregate sums are unavailable');
    console.log('PASS: strict six-stage contract, independent flags/caps/activation, actual POST and protected GET, no identity/header access, SQLite concurrent cap, joint transactional retention, completed UTC windows, missing-data handling and generic failures. No production activity.');
  } finally {sqlite.close();global.fetch=originalFetch;}
})().catch(error=>{console.error(error);process.exitCode=1;});
