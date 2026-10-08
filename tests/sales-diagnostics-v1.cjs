// In-memory fixtures only. No production database, accounts, or network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const { salesDiagnostics, diagnosticWindow } = require('../lib/sales-diagnostics.ts');
const { paymentEnvironment } = require('../lib/payments.ts');
// Use the real value persisted by checkout, without constructing adapters or calling providers.
const savedEnvironments = {
  anetLive: paymentEnvironment({PAYMENT_PROVIDER:'authorizenet',AUTHORIZENET_ENVIRONMENT:'live'}),
  anetSandbox: paymentEnvironment({AUTHORIZENET_ENVIRONMENT:'sandbox'}),
  chaseLive: paymentEnvironment({PAYMENT_PROVIDER:'chase',CHASE_ENVIRONMENT:'live'}),
  chaseSandbox: paymentEnvironment({PAYMENT_PROVIDER:'chase',CHASE_ENVIRONMENT:'sandbox'}),
};
assert.deepEqual(savedEnvironments,{anetLive:'authorizenet:live',anetSandbox:'authorizenet:sandbox',chaseLive:'live',chaseSandbox:'sandbox'});
const sql = new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE orders(id TEXT PRIMARY KEY,owner TEXT,status TEXT,total INTEGER,data TEXT,payment_ref TEXT,notification_id TEXT,created INTEGER,updated INTEGER);
CREATE TABLE requests(id TEXT PRIMARY KEY,owner TEXT,kind TEXT,data TEXT,status TEXT,created INTEGER);`);
const now = Date.parse('2026-10-08T17:28:00.000Z');
const { start, end } = diagnosticWindow('7', now);
assert.equal(start, Date.parse('2026-10-01T00:00:00.000Z'));
assert.equal(end, Date.parse('2026-10-08T00:00:00.000Z'));
assert.equal(diagnosticWindow('30', now).start, Date.parse('2026-09-08T00:00:00.000Z'));
assert.equal(diagnosticWindow(null, now).days, 7);
assert.deepEqual(diagnosticWindow('7', end), diagnosticWindow('7', now), 'UTC windows exclude current partial day');
for (const days of ['', '0', '07', '365', '7 OR 1=1', '30.0']) assert.throws(() => diagnosticWindow(days, now), /7-day or 30-day/);
for (const clock of [NaN, Infinity, -1, 0.5]) assert.throws(() => diagnosticWindow('7', clock), /time/);
const sensitive = 'TEST_ONLY_PRIVATE_VALUE';
let sequence = 0;
function order(status, environment, created = start, proof = true, total = 12345, raw) {
  const id = 'fixture-order-' + (++sequence);
  const data = raw === undefined ? JSON.stringify({ environment, email: sensitive, address: {name:sensitive}, fingerprint:sensitive }) : raw;
  sql.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?)').run(id, sensitive, status, total, data, proof ? 'test-pay-' + id : null, proof ? 'test-notice-' + id : null, created, now);
  return id;
}
function request(kind, status = 'new', created = start) {
  sql.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run('fixture-request-' + (++sequence), sensitive, kind, JSON.stringify({email:sensitive,address:sensitive,sessionId:sensitive}), status, created);
}
order('paid',savedEnvironments.anetLive, start); // Inclusive lower bound.
order('shipped',savedEnvironments.chaseLive, end - 1, true, 100); // Exclusive upper bound minus one millisecond.
order('delivered',savedEnvironments.anetSandbox, start, true, 999);
order('labeling','live', start, true, 200);
order('paid','live', start, false, 50000);
const whitespace = order('paid','live',start,true,88888);
sql.prepare('UPDATE orders SET notification_id=? WHERE id=?').run('  ', whitespace);
const half = order('paid','live',start,true,77777);
sql.prepare('UPDATE orders SET payment_ref=NULL WHERE id=?').run(half);
order('failed',savedEnvironments.chaseSandbox,start,true,44444);
order('cancelled','live',start,true,55555);
order('review',savedEnvironments.anetLive,start,true,66666); // References without a paid state do not count as recorded payment.
order('paid',undefined,start,true,101);
order('paid','LIVE',start,true,102);
order('paid',null,start,true,103,'not valid JSON');
order('paid',null,start,true,104,'null');
order(sensitive,'live',start,true,105); // Unexpected state cannot leak arbitrary text.
order('paid','live',start - 1,true,900000);
order('paid','live',end,true,900001);
order('paid','live',end + 1,true,900002);
order('awaiting_payment',savedEnvironments.anetSandbox,start - 40 * 86400000,false);
order('creating','unknown',end,false);
request('quote'); request('quote'); // Repeated quotes stay events, not people.
request('quote','new',start - 1); request('quote','new',end);
request('contact'); request('stock'); request('affiliate');
request('cart_import','cart_conflict',start - 40 * 86400000);
request('cart_import','cart_conflict',end);
request('cart_import','cart_resolved'); request('cart_import','cart_pending');
request('unrecognized',sensitive);
let queries = [];
const all = async (query, ...values) => {
  assert.match(query.trim(), /^(WITH|SELECT)\b/);
  queries.push({query,values});
  return sql.prepare(query).all(...values).map(row => ({...row}));
};
const allow = async () => {};
(async () => {
  const report = await salesDiagnostics({all,requireAdmin:allow}, '7', now);
  assert.equal(report.classification, 'unclassified');
  assert.equal(report.asOf, now);
  assert.equal(report.orders.reduce((n,r)=>n+r.orders,0),15);
  const live = report.orders.filter(r=>r.environment==='live');
  assert.equal(live.reduce((n,r)=>n+r.paymentRecorded,0),3);
  assert.equal(live.reduce((n,r)=>n+r.grossCents,0),12645);
  assert.equal(live.reduce((n,r)=>n+r.missingPaymentRecords,0),3);
  assert.equal(report.orders.filter(r=>r.environment==='unknown').reduce((n,r)=>n+r.orders,0),4);
  assert.equal(report.orders.find(r=>r.environment==='sandbox'&&r.status==='delivered').grossCents,999);
  assert.equal(report.orders.find(r=>r.status==='unknown').orders,1);
  const cancelled=report.orders.find(r=>r.status==='cancelled');
  assert.equal(cancelled.orders,1); assert.equal(cancelled.paymentRecorded,0); assert.equal(cancelled.grossCents,0);
  assert(!report.unresolvedOrders.some(r=>r.status==='cancelled'));
  const failed=report.orders.find(r=>r.status==='failed');
  assert.equal(failed.orders,1); assert.equal(failed.paymentRecorded,0); assert.equal(failed.grossCents,0);
  assert(!report.unresolvedOrders.some(r=>r.status==='failed'));
  assert.equal(report.requests.find(r=>r.kind==='quote').records,2);
  assert.equal(report.requests.reduce((n,r)=>n+r.records,0),5);
  assert.equal(report.unresolvedOrders.reduce((n,r)=>n+r.records,0),3);
  assert.equal(report.unresolvedOrders.find(r=>r.status==='review').environment,'live','actual saved Authorize.net live mode maps consistently in unresolved orders');
  assert.equal(report.unresolvedOrders.find(r=>r.status==='awaiting_payment').environment,'sandbox','actual saved Authorize.net sandbox mode maps consistently in unresolved orders');
  assert.equal(report.unresolvedOrders.find(r=>r.environment==='sandbox').oldestCreated,start-40*86400000);
  assert.deepEqual(report.cartConflicts,{records:2,oldestCreated:start-40*86400000});
  assert.equal(queries.length,4);
  assert.deepEqual(queries.slice(0,2).map(q=>q.values),[[start,end],[start,end]]);
  for (const q of queries) {
    assert.doesNotMatch(q.query,/SELECT\s+\*/i);
    assert.doesNotMatch(q.query,/\b(owner|email|address|fingerprint|sessionId|rate_limits|sessions|customer_carts)\b/i);
  }
  assert(!JSON.stringify(report).includes(sensitive));
  assert(!JSON.stringify(report).includes('fixture-order'));
  assert(!JSON.stringify(report).includes('test-pay'));
  const expectedOrderKeys=['dayUtc','environment','grossCents','missingPaymentRecords','orders','paymentRecorded','status'].sort();
  for(const row of report.orders) assert.deepEqual(Object.keys(row).sort(),expectedOrderKeys);
  queries=[];
  await assert.rejects(salesDiagnostics({all,requireAdmin:async()=>{throw Error('Denied');}},'365',now),/Denied/);
  assert.equal(queries.length,0,'no aggregate read before authorization');
  await assert.rejects(salesDiagnostics({all,requireAdmin:allow},'365',now),/reporting period/);
  assert.equal(queries.length,0,'invalid windows never query');
  await assert.rejects(salesDiagnostics({all:async()=>{throw Error(sensitive);},requireAdmin:allow},'7',now),/^Error: Sales diagnostics could not load\. Please retry\.$/);
  const wider=await salesDiagnostics({all,requireAdmin:allow},'30',now);
  assert.equal(wider.orders.reduce((n,r)=>n+r.orders,0),16,'30-day window includes older cohort but excludes today');

  // Exercise the real route and real requireAdmin with test-only auth replies.
  let identity = null; let token = false;
  const runtime = {SUPABASE_URL:'https://auth.fixture.invalid',SUPABASE_ANON_KEY:'test-only',STORE_ADMIN_EMAILS:'administrator@example.invalid'};
  const runtimeMock = {all, runtime:()=>runtime};
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.equal(url,'https://auth.fixture.invalid/auth/v1/user','all network must remain a test fixture');
    return {ok:true,json:async()=>identity||{}};
  };
  Module._load = function(name,parent,isMain) {
    if(name==='next/headers') return {cookies:async()=>({get:()=>token?{value:'test-only-token'}:undefined})};
    if(name==='next/server') return {NextResponse:{json:(body,options)=>({body,status:options.status,headers:options.headers})}};
    if(name==='@/lib/sales-diagnostics') return require('../lib/sales-diagnostics.ts');
    if(name==='@/lib/runtime'||(name==='./runtime'&&parent?.filename.endsWith('/lib/auth.ts'))) return runtimeMock;
    if(name==='@/lib/auth') return require('../lib/auth.ts');
    if(name.startsWith('@/lib/')) return {};
    return originalLoad.call(this,name,parent,isMain);
  };
  try {
    const {GET}=require('../app/api/store/[action]/route.ts');
    async function route(days='7') { return GET({nextUrl:new URL('https://store.fixture.invalid/api/store/admin-diagnostics?days='+days)}, {params:Promise.resolve({action:'admin-diagnostics'})}); }
    for (const who of [null,{id:'fixture-member',email:'member@example.invalid',email_confirmed_at:'yes'},{id:'fixture-admin',email:'administrator@example.invalid',email_confirmed_at:null}]) {
      token=Boolean(who); identity=who; queries=[];
      const result=await route(); assert.equal(result.status,400); assert(result.body.error); assert.equal(queries.length,0); assert.equal(result.headers['Cache-Control'],'no-store');
    }
    token=true; identity={id:'fixture-admin',email:'administrator@example.invalid',email_confirmed_at:'yes'};
    queries=[];
    const result=await route(); assert.equal(result.status,200); assert.equal(result.headers['Cache-Control'],'no-store'); assert.equal(queries.length,4);
    assert(!JSON.stringify(result.body).includes(sensitive));
    queries=[]; assert.equal((await route('366')).status,400); assert.equal(queries.length,0);
  } finally { Module._load=originalLoad; global.fetch=originalFetch; }
  sql.exec('DELETE FROM orders; DELETE FROM requests;');
  const empty=await salesDiagnostics({all,requireAdmin:allow},'7',now);
  assert.deepEqual(empty.orders,[]); assert.deepEqual(empty.requests,[]); assert.deepEqual(empty.unresolvedOrders,[]); assert.deepEqual(empty.cartConflicts,{records:0,oldestCreated:null});
  for (const value of ['authorizenet:preview','anet:live','chase:live','stripe:live','live ']) order('paid',value,start,true,100);
  const unknown=await salesDiagnostics({all,requireAdmin:allow},'7',now);
  assert.equal(unknown.orders.reduce((n,r)=>n+r.orders,0),5);
  assert(unknown.orders.every(r=>r.environment==='unknown'),'unsupported provider/mode spellings must not be inferred as live');
  sql.close();
  console.log('PASS: diagnostics SQL, UTC bounds, legacy JSON, payment evidence, actual saved provider environments, environment/status separation, aggregate privacy, real GET/admin authorization, no-store responses, failures and empty records');
})().catch(error=>{console.error(error);process.exitCode=1;});
