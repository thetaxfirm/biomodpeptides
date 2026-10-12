/* Protected history GET: actual route + parser with isolated SQLite fixtures.
 * No provider, production database, credentials, customer records or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const routeFile = path.join(root, 'app/api/store/[action]/route.ts');
const sql = new DatabaseSync(':memory:');
const migration = fs.readFileSync(path.join(root, 'drizzle/0020_change_history.sql'), 'utf8');
sql.exec(migration.slice(0, migration.indexOf('CREATE TRIGGER IF NOT EXISTS audit_product_overrides_insert')));
const occurredAt = Date.parse('2026-10-12T12:34:56Z');
sql.prepare('INSERT INTO change_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('fixture-new', occurredAt, occurredAt, 'admin', 'staff@example.invalid', 'staff', 'product.update', 'product', 'fixture-product', 'Fixture price change', 'succeeded', JSON.stringify([{field:'Price (cents)',before:10000,after:8500}]), null, null);
sql.prepare('INSERT INTO change_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('fixture-old', occurredAt - 1000, occurredAt, 'github', 'Fixture author', 'git', 'commit', 'code', 'fixture-commit', 'Fixture code change', 'observed', '[]', 'https://github.com/thetaxfirm/biomodpeptides/commit/fixture', 'fixture-commit');
let role, authorized, calls, authGate, forbiddenCalls = 0;
const forbidden = name => () => { forbiddenCalls++; throw Error('Forbidden dependency: ' + name); };
const dependencies = {};
function load(file) {
  const filename = path.join(root, file), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const localRequire = Module.createRequire(filename);
  mod.require = name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === 'next/headers' || name.startsWith('@/')) return new Proxy({}, {get:(_,key)=>key === '__esModule' ? true : forbidden(name + ':' + String(key))});
    return localRequire(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText, filename);
  return mod.exports;
}
const staff = load('lib/staff.ts');
const history = load('lib/change-history.ts');
const db = {prepare(query) {
  assert(authorized, 'Authorization precedes even preparing a history query');
  assert(/^SELECT /i.test(query), 'GET history never writes');
  calls.push({name:'query',query});
  const statement = (values=[]) => ({bind:(...next)=>statement(next),all:async()=>({results:sql.prepare(query).all(...values)})});
  return statement();
}};
class FixtureResponse extends Response {
  static json(value, options={}) {return new FixtureResponse(JSON.stringify(value), {...options,headers:{'Content-Type':'application/json',...options.headers}});}
}
dependencies['next/server'] = {NextResponse:FixtureResponse,after:forbidden('background activity')};
dependencies['@/lib/change-history'] = history;
dependencies['@/lib/auth'] = {
  requireStaff:async permission=>{
    calls.push({name:'authorization',permission});
    assert.equal(permission,'reports:read','Protected route must request reporting permission');
    if(authGate) await authGate;
    if(!staff.can(role,permission)) throw Error('PRIVATE_FIXTURE_AUTH_ERROR');
    authorized=true;calls.push({name:'authorized',role});return {id:'fixture-staff',email:'staff@example.invalid',role};
  },
  customer:forbidden('unprotected customer lookup'),session:forbidden('session mutation'),
};
dependencies['@/lib/runtime'] = {database:()=>{assert(authorized,'requireStaff reports:read must finish before database access');calls.push({name:'database'});return db;},runtime:forbidden('runtime access')};
const {GET} = load('app/api/store/[action]/route.ts');
const originalFetch = global.fetch;
global.fetch=forbidden('network');
function reset(nextRole) {role=nextRole;authorized=false;calls=[];authGate=null;}
const request=query=>GET({nextUrl:new URL('https://example.invalid/api/store/admin-changes'+(query?'?'+query:''))},{params:Promise.resolve({action:'admin-changes'})});
function noStore(response) {assert.equal(response.headers.get('cache-control'),'no-store');}
(async()=>{
  for(const denied of [null,'customer','support','fulfillment','unknown']) {
    reset(denied);const response=await request();noStore(response);assert.equal(response.status,403);
    assert.deepEqual(calls,[{name:'authorization',permission:'reports:read'}],'Denied roles never reach the DB');
    const body=await response.json();assert.equal(body.error,'Administrator reporting access required.');assert(!JSON.stringify(body).includes('PRIVATE_FIXTURE_AUTH_ERROR'));
  }
  for(const allowed of ['owner','manager']) {
    reset(allowed);const response=await request('limit=1');noStore(response);assert.equal(response.status,200);
    assert.deepEqual(calls.slice(0,3),[{name:'authorization',permission:'reports:read'},{name:'authorized',role:allowed},{name:'database'}]);
    const report=await response.json();assert.equal(report.events.length,1);assert.equal(report.events[0].id,'fixture-new');assert.equal(report.events[0].changes[0].after,8500);assert.equal(report.timeZone,'UTC');assert.equal(report.nextCursor,occurredAt+':fixture-new');
    assert(report.coverage.some(item=>item.source==='cloudflare_audit'&&item.state==='unavailable'));
    reset(allowed);const older=await request('limit=1&before='+encodeURIComponent(report.nextCursor));noStore(older);const page=await older.json();assert.equal(page.events[0].id,'fixture-old');assert.equal(page.nextCursor,null);
  }
  // An unfinished permission check cannot race ahead to a data read.
  reset('owner');let release;authGate=new Promise(resolve=>release=resolve);const pending=request();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[{name:'authorization',permission:'reports:read'}]);release();assert.equal((await pending).status,200);
  const badQueries=['limit=0','limit=101','limit=1.5','limit=abc','source=untrusted','q='+encodeURIComponent('x'.repeat(121)),'from=2026-02-30','to=12-10-2026','from=2026-10-13&to=2026-10-12','before=not-a-cursor','before='+encodeURIComponent('9999999999999999:fixture')];
  for(const query of badQueries) {
    reset('manager');const response=await request(query);noStore(response);assert.equal(response.status,400,query);const body=await response.json();assert.equal(typeof body.error,'string');assert(body.error.length>0);assert(!calls.some(call=>call.name==='query'),'Malformed query rejected before any SQL query');
  }
  reset('manager');const sameDay=await request('from=2026-10-12&to=2026-10-12&source=admin&q=price');assert.equal(sameDay.status,200);noStore(sameDay);assert.equal((await sameDay.json()).events.length,1);
  reset('owner');const boundary=await request('q='+encodeURIComponent('x'.repeat(120)));assert.equal(boundary.status,200);noStore(boundary);
  assert.equal(forbiddenCalls,0);global.fetch=originalFetch;sql.close();
  console.log('PASS: protected change-history GET requires reports:read before DB access; signed-out/customer/support/fulfillment denied, owner/manager allowed, awaited authorization, actual cursor/date/source/search validation, no writes or provider calls, and no-store on 200/400/403.');
})().catch(error=>{global.fetch=originalFetch;console.error(error);process.exitCode=1;});
