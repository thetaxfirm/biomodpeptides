// Real transport + domain modules. Every outside service is isolated and unexpected calls fail.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),calls=[];let authorized=false, budgetCheck=null;
const database={fixture:'database'},audited={fixture:'audited-database'};
class Reply extends Response{static json(value,init={}){return new Reply(JSON.stringify(value),{...init,headers:{'content-type':'application/json',...init.headers}});}}
const deps={
 'next/server':{NextResponse:Reply},'next/headers':{cookies:async()=>({get:()=>undefined})},zod:require('zod'),
 '@/lib/auth':{customer:async()=>{calls.push(['customer']);return null;},session:async()=>{calls.push(['session']);return{id:'fixture-session'};},rateLimit:async(...args)=>{calls.push(['rateLimit',...args]);if(budgetCheck)await budgetCheck(...args);},requireStaff:async permission=>{calls.push(['staff',permission]);if(!authorized)throw Error('Fixture access denied');return{email:'fixture@example.invalid',role:'owner'};}},
 '@/lib/runtime':{runtime:()=>({DB:database}),database:()=>database},
 '@/lib/change-history':{withAuditDb:(db,actor)=>{assert.equal(db,database);calls.push(['audit',actor]);return audited;}},
 '@/lib/preorder-plan-save':{savePreorderPlan:async(db,input,actor)=>{assert.equal(db,audited);calls.push(['plan',input,actor]);return{message:'Fixture plan saved'};}},
 '@/lib/request-reply-route':{replyBridgeRoute:async()=>{calls.push(['bridge']);return Reply.json({error:'Fixture bridge requires its own signature'},{status:403});}},
};
const filename=path.join(root,'app/api/store/[action]/route.ts'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(root);
m.require=id=>deps[id]||new Proxy({},{get:(_,key)=>key==='__esModule'?true:()=>{throw Error('Unexpected fixture dependency '+id+':'+String(key));}});
require('./store-api-fixture.cjs').link(m);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:9,module:1,esModuleInterop:true}}).outputText,filename);
const request=(body='{}',headers={})=>{const r=new Request('https://fixture.invalid/api/store/action',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json',...headers},body});r.nextUrl=new URL(r.url);return r;};
async function post(action,body='{}',headers={}){calls.length=0;const response=await m.exports.POST(request(body,headers),{params:Promise.resolve({action})});assert.equal(response.headers.get('cache-control'),action==='reply-bridge'?null:'no-store');return response;}
(async()=>{
 for(const [body,headers,status] of [['{}',{origin:'https://other.invalid'},403],['{}',{'content-length':'30001'},413],['x'.repeat(30001),{},413],['"'+'é'.repeat(15000)+'"',{},413],['[]',{},400],['{}',{'content-type':'text/plain'},400],['bad-json',{},400]]){
  assert.equal((await post('admin-preorder-plan',body,headers)).status,status);assert.deepEqual(calls,[],'transport refuses invalid writes before creating sessions, authorizing staff or touching providers');
 }
 assert.equal((await post('reply-bridge','not-json',{origin:'https://other.invalid'})).status,403);assert.deepEqual(calls,[['bridge']],'signed bridge retains its separate boundary');
 const groups={
  'orders:read':['admin-orders'],
  'orders:fulfill':['admin-order','admin-order-archive','admin-order-handoff','admin-preorder-release','admin-preorder-plan'],
  'orders:reconcile':['admin-reconcile'],
  'requests:write':['admin-request','admin-request-reply','admin-reply-attachments','admin-reply-desk','admin-request-replies','admin-reply-rule','admin-retire-reply-drafts','admin-request-forward','admin-order-conversation','admin-order-hold','admin-win-back','admin-mark-replied','admin-win-back-preview','admin-request-issue','admin-case-log','admin-coa-process'],
  'store:write':['admin-config','admin-campaign','admin-reward','admin-coa-config'],
  'catalog:write':['admin-product'],
  'team:manage':['admin-staff','admin-staff-site-updates','admin-payment-hold','admin-unknown-action'],
 };
 for(const [permission,actions]of Object.entries(groups))for(const action of actions){const response=await post(action);assert.equal(response.status,400);assert.deepEqual(calls,[['session'],['rateLimit',action+':fixture-session',120],['staff',permission]],action+' must authorize before its domain handler');}
 authorized=true;
 const payload={orderId:'00000001-0000-4000-8000-000000000001',dispatchDate:null,expectedVersion:'a'.repeat(64),note:'Fixture current estimate unknown.'};
 let response=await post('admin-preorder-plan',JSON.stringify(payload));assert.equal(response.status,200);assert.deepEqual(calls.slice(2),[['staff','orders:fulfill'],['audit',{source:'admin',actor:'fixture@example.invalid',actorType:'staff',action:'admin-preorder-plan'}],['plan',payload,'fixture@example.invalid']]);
 response=await post('admin-reward');assert.equal(response.status,409,'legacy reward endpoint continues to redirect staff to the reviewed ledger');
 response=await post('unknown');assert.equal(response.status,404);assert.equal(calls.length,2);
 const getReq={nextUrl:new URL('https://fixture.invalid/api/store/unknown')};calls.length=0;response=await m.exports.GET(getReq,{params:Promise.resolve({action:'unknown'})});assert.equal(response.status,404);assert.deepEqual(calls,[['customer']]);
 calls.length=0;response=await m.exports.GET(getReq,{params:Promise.resolve({action:'admin-orders'})});assert.equal(response.status,405);assert.deepEqual(calls,[['customer']],'legacy GET queue never reads order data');
 // Use the real SQL limiter: routine no-token refreshes cannot consume credential-attempt budgets.
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(':memory:');db.exec('CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,expires INTEGER)');
 const authExports={},authCode=ts.transpileModule(fs.readFileSync(path.join(root,'lib/auth.ts'),'utf8'),{compilerOptions:{target:9,module:1}}).outputText;
 new Function('exports','require',authCode)(authExports,id=>id==='./runtime'?{timestamp:Date.now,one:async(sql,...values)=>db.prepare(sql).get(...values)}:{});
 budgetCheck=authExports.rateLimit;
 for(let i=0;i<40;i++)assert.equal((await post('auth-refresh')).status,200,'normal navigation refresh '+i+' remains available beyond twelve');
 assert.equal(db.prepare("SELECT count FROM rate_limits WHERE key='auth-refresh:fixture-session'").get().count,40);
 for(const action of ['auth-login','auth-register','auth-recover','auth-reset']){
  for(let i=0;i<12;i++){const attempt=await post(action);assert.equal(attempt.status,400);assert(!JSON.stringify(await attempt.json()).includes('Too many requests'));}
  const limited=await post(action);assert.equal(limited.status,400);assert.match((await limited.json()).error,/Too many requests/);
 }
 db.prepare("UPDATE rate_limits SET count=120 WHERE key='auth-refresh:fixture-session'").run();const limited=await post('auth-refresh');assert.equal(limited.status,400);assert.match((await limited.json()).error,/Too many requests/);db.close();
 console.log('PASS: real SQL rate limits allow forty routine refreshes, retain twelve credential attempts per action, and still bound refresh at120 per ten minutes.');
 console.log('PASS: extracted store dispatcher preserves byte/JSON/origin guards, bridge boundary, every admin permission, authenticated audit context, legacy denials and unknown URLs. No network or real records.');
})().catch(error=>{console.error(error);process.exitCode=1;});
