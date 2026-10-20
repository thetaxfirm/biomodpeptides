// Who gets a new-order alert: the owner-edited list under Settings, falling back to the deployed
// Cloudflare variables. Isolated SQLite; no mail provider is ever called.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),ts=require('typescript');
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);
  m.require=id=>id.startsWith('./')||id.startsWith('@/')?load(id.replace(/^@\//,'').replace(/^\.\//,'lib/')+(id.endsWith('.ts')?'':'.ts')):require(id);
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,esModuleInterop:true}}).outputText,name);return m.exports;}
const summary=load('lib/order-summary.ts');

// --- The cleaner: shape, de-duplication, the cap, and junk. ---
assert.deepEqual(summary.cleanRecipients('a@b.com, c@d.com'),['a@b.com','c@d.com']);
assert.deepEqual(summary.cleanRecipients('a@b.com\nc@d.com'),['a@b.com','c@d.com'],'one per line is how the box is used');
assert.deepEqual(summary.cleanRecipients('A@B.com; a@b.COM'),['a@b.com'],'the same address twice is one address');
assert.deepEqual(summary.cleanRecipients('not-an-address, b@c.com, @nope, also bad'),['b@c.com'],'junk is dropped, the rest is kept');
assert.deepEqual(summary.cleanRecipients(''),[]); assert.deepEqual(summary.cleanRecipients(null),[]); assert.deepEqual(summary.cleanRecipients(undefined),[]);
assert.equal(summary.cleanRecipients(Array.from({length:30},(_,i)=>'a'+i+'@b.com').join(',')).length,10,'ten is the cap');
assert.deepEqual(summary.cleanRecipients('x'.repeat(300)+'@b.com'),[],'an absurdly long address is not one');
// A carrier text gateway is a valid address, so the owner may still use one where it works.
assert.deepEqual(summary.cleanRecipients('5555550123@msg.fi.google.com'),['5555550123@msg.fi.google.com']);

// --- Where the list comes from. ---
function database(rows={}){const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  for(const [k,v] of Object.entries(rows)) db.prepare('INSERT INTO settings VALUES(?,?)').run(k,v);
  return {raw:db,prepare(sql){return{bind(...v){return{async first(){return db.prepare(sql).get(...v)||null;}};},async first(){return db.prepare(sql).get()||null;}};}};}
const KEY=summary.ORDER_ALERT_KEY;
assert.equal(KEY,'order_alert_recipients_v1');

(async()=>{
  // The saved list wins.
  let env={DB:database({[KEY]:'owner@example.invalid, second@example.invalid'}),ORDER_NOTIFY_EMAILS:'deployed@example.invalid'};
  assert.deepEqual(await summary.orderAlertRecipients(env),['owner@example.invalid','second@example.invalid']);

  // An empty or unsaved list falls back to what is deployed, so a store that never opens the field
  // keeps working exactly as it did.
  env={DB:database(),ORDER_NOTIFY_EMAILS:'deployed@example.invalid'};
  assert.deepEqual(await summary.orderAlertRecipients(env),['deployed@example.invalid']);
  env={DB:database({[KEY]:''}),ORDER_NOTIFY_EMAILS:'deployed@example.invalid'};
  assert.deepEqual(await summary.orderAlertRecipients(env),['deployed@example.invalid'],'cleared means fall back, not silence');
  env={DB:database({[KEY]:'nonsense'}),ORDER_NOTIFY_EMAILS:'deployed@example.invalid'};
  assert.deepEqual(await summary.orderAlertRecipients(env),['deployed@example.invalid'],'an unusable saved list is not a reason to tell nobody');
  env={DB:database({[KEY]:'owner@example.invalid'}),STORE_ADMIN_EMAILS:'legacy@example.invalid'};
  assert.deepEqual(await summary.orderAlertRecipients(env),['owner@example.invalid']);
  env={DB:database(),STORE_ADMIN_EMAILS:'legacy@example.invalid'};
  assert.deepEqual(await summary.orderAlertRecipients(env),['legacy@example.invalid'],'the older variable still works');

  // A broken settings table must never stop an order alert.
  env={DB:{prepare(){throw Error('down');}},ORDER_NOTIFY_EMAILS:'deployed@example.invalid'};
  assert.deepEqual(await summary.orderAlertRecipients(env),['deployed@example.invalid']);
  assert.deepEqual(await summary.orderAlertRecipients({ORDER_NOTIFY_EMAILS:'deployed@example.invalid'}),['deployed@example.invalid'],'and neither must a missing database');
  assert.deepEqual(await summary.orderAlertRecipients({}),[],'with nothing configured anywhere, nothing is sent');

  // --- The notification itself reads that list and sends once, with no provider call when unset. ---
  const data={total:29254,subtotal:29254,address:{name:'Fixture',line1:'1 Test St',city:'Reno',state:'NV',zip:'89501'},items:[]};
  let posts=[];const realFetch=global.fetch;
  global.fetch=async(url,init)=>{posts.push({url,body:JSON.parse(init.body)});return new Response('{}',{status:200});};
  try{
    const mail={DB:database({[KEY]:'owner@example.invalid, second@example.invalid'}),RESEND_API_KEY:'synthetic',ORDER_NOTIFY_EMAILS:'deployed@example.invalid'};
    assert.equal(await summary.sendOrderNotification(mail,'00000001-0000-4000-8000-000000000001',data),true);
    assert.equal(posts.length,1);
    assert.deepEqual(posts[0].body.to,['owner@example.invalid','second@example.invalid'],'the edited list is who is written to');
    assert.match(posts[0].body.subject,/New order 00000001 - \$292\.54 - 0 items/);
    // No key, or nobody to tell: no provider call at all.
    posts=[];
    assert.equal(await summary.sendOrderNotification({DB:database(),RESEND_API_KEY:'synthetic'},'00000001-0000-4000-8000-000000000001',data),false);
    assert.deepEqual(posts,[],'nobody configured means no request is made');
    assert.equal(await summary.sendOrderNotification({DB:database({[KEY]:'owner@example.invalid'})},'00000001-0000-4000-8000-000000000001',data),false);
    assert.deepEqual(posts,[],'no mail key means no request is made');
  } finally { global.fetch=realFetch; }

  // The endpoint is permissioned and audited, and never writes the addresses into change history.
  const route=fs.readFileSync(path.join(root,'app/api/admin/order-alerts/route.ts'),'utf8');
  assert.match(route,/requireStaff\('store:write'\)/,'saving needs settings access');
  assert.match(route,/req\.headers\.get\('origin'\) !== req\.nextUrl\.origin/,'same-origin only');
  assert.match(route,/auditRun\(env\.DB, context,/,'the write is audited');
  assert.match(route,/summary: 'Order alert recipients saved: ' \+ recipients\.length/,'history records the count, never the addresses');
  // The Settings tab renders it, and nothing created a new tab for it.
  const admin=fs.readFileSync(path.join(root,'components/store/admin.tsx'),'utf8');
  assert.match(admin,/<AdminOrderAlerts key=\{'alerts:' \+ formGeneration\}/,'it lives under Settings');
  assert.equal((admin.match(/<TabsTrigger/g)||[]).length,2,'the tab strip is unchanged');
  const panel=fs.readFileSync(path.join(root,'components/store/admin-order-alerts.tsx'),'utf8');
  assert.match(panel,/Customers never see this list/,'the panel says who it reaches');
  assert.match(panel,/mostly no longer work/,'and warns about carrier text gateways');

  console.log('PASS: recipient cleaning (shape, duplicates, cap, junk), the owner-edited list winning over the deployed variables, every fallback including a broken or missing database, the order email addressing that list and never calling the provider when unset, and a permissioned, audited endpoint that keeps addresses out of change history. No live mail.');
})().catch(e=>{console.error(e);process.exitCode=1});
