// Actual job dispatch, audit wrapper and shipping webhook with isolated SQLite; no provider sends.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHmac}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),sql=new DatabaseSync(':memory:');
for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(x=>/^\d+.*\.sql$/.test(x)).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
function statement(query,values=[]){const execute=()=>({results:[],meta:sql.prepare(query).run(...values)});return{bind:(...args)=>statement(query,args),run:async()=>execute(),execute,first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)})};}
const DB={prepare:q=>statement(q),batch:async statements=>{sql.exec('BEGIN');try{const results=statements.map(s=>s.execute());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
function load(file,overrides={}){const filename=path.join(root,file),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(root);const regular=Module.createRequire(filename);m.require=name=>{if(Object.hasOwn(overrides,name))return overrides[name];if(name==='./fulfillment')return load('lib/fulfillment.ts');if(name==='./shipping-options')return load('lib/shipping-options.ts');return regular(name);};m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);return m.exports;}
const history=load('lib/change-history.ts');
const oldFetch=global.fetch;global.fetch=()=>{throw Error('Live provider access forbidden');};
const env={DB,EASYPOST_WEBHOOK_SECRET:'synthetic-fixture-only'},jobs=[];
const write=async(database,id)=>database.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?)').bind(id,JSON.stringify({price:10000})).run();
const worker=load('worker.ts',{
 './lib/change-history':history,
 'vinext/server/fetch-handler':{fetch:()=>new Response('fixture')},
 './lib/traffic-metrics-server':{cleanupTraffic:async db=>{assert.notEqual(db,DB);jobs.push('traffic');await write(db,900003);}},
 './lib/coa-scheduler':{runScheduledCoaOutbox:async copy=>{assert.notEqual(copy,env);assert.notEqual(copy.DB,DB);jobs.push('coa');await write(copy.DB,900001);}},
 './lib/checkout-recovery':{runCheckoutRecovery:async copy=>{assert.notEqual(copy,env);assert.notEqual(copy.DB,DB);jobs.push('recovery');await write(copy.DB,900002);}},
 './lib/reply-overdue':{runOverdueDigest:async copy=>{assert.notEqual(copy,env);assert.notEqual(copy.DB,DB);}},
 './lib/tracking-sweep':{runTrackingSweep:async copy=>{assert.notEqual(copy,env);assert.notEqual(copy.DB,DB);jobs.push('tracking');return{checkedAt:0,due:0,read:0,changed:0,failed:0,skipped:0};}},
 './lib/auto-label':{runAutoLabels:async copy=>{assert.notEqual(copy,env);assert.notEqual(copy.DB,DB);jobs.push('labels');return{checkedAt:0,enabled:false,recovered:0,released:0,due:0,bought:0,failed:0,skipped:0,spentCents:0,capReached:false};}},
 './lib/parcel-alerts':{runParcelAlerts:async copy=>{assert.notEqual(copy,env);assert.notEqual(copy.DB,DB);jobs.push('parcels');return{sent:false,reason:'all_moving'};}},
 './lib/checkout-expiry':{runCheckoutExpiry:async copy=>{assert.notEqual(copy,env);assert.notEqual(copy.DB,DB);jobs.push('expiry');return{status:'completed',checkedAt:0,due:0,released:0,kept:0,failed:0};}},
}).default;
class NextResponse extends Response{}
const runtime={runtime:()=>env,timestamp:()=>Date.now()};
const webhook=load('app/api/shipping/easypost/route.ts',{'next/server':{NextResponse},'@/lib/change-history':history,'@/lib/runtime':runtime,'@/lib/easypost':load('lib/easypost.ts')});
const rows=()=>sql.prepare('SELECT actor,actor_type,source,entity_id,changes FROM change_events').all();
const orderId='bbbbbbbb-1111-4222-8333-444444444444';
async function shippingEvent(signature=true,mode='production'){
 const body=JSON.stringify({description:'tracker.updated',created_at:new Date().toISOString(),result:{object:'Tracker',mode,tracking_code:'PRIVATE_TRACKING',shipment_id:'shp_private',status:'in_transit'}});
 const signed='hmac-sha256-hex='+createHmac('sha256',env.EASYPOST_WEBHOOK_SECRET).update(body).digest('hex');
 return webhook.POST(new Request('https://trybiomod.com/api/shipping/easypost',{method:'POST',headers:{'x-hmac-signature':signature?signed:'invalid'},body}));
}
(async()=>{try{
 const baseline=rows().length;
 await worker.scheduled({cron:'*/5 * * * *',scheduledTime:Date.now()},env);
 await worker.scheduled({cron:'0 9 * * *',scheduledTime:Date.now()},env);
 assert.equal(env.DB,DB,'The shared environment was not mutated');
 for(const [id,name]of[['900001','COA email scheduler'],['900002','Unpaid checkout recovery scheduler'],['900003','Traffic retention scheduler']]){
  const row=rows().find(r=>r.entity_id===id);assert(row);assert.equal(row.actor,name);assert.equal(row.actor_type,'system');assert.equal(row.source,'system');
 }
 assert.equal(rows().length,baseline+3);assert.equal(sql.prepare('SELECT COUNT(*) n FROM change_context').get().n,0);
 await worker.scheduled({cron:'unrecognized'},env);assert.equal(jobs.length,7,'the seven scheduled jobs ran once; an unrecognized cron runs none');
 assert(jobs.includes('parcels'),'the daily parcel alert runs on the five-minute cron under its own audit identity');
 assert(jobs.includes('tracking'),'the carrier tracking sweep runs on the five-minute cron');
 assert(jobs.includes('labels'),'automatic label purchase runs on the five-minute cron under its own audit identity');
 assert(jobs.includes('expiry'),'unpaid checkout release runs on the five-minute cron under its own audit identity');
 // A later uninstrumented write cannot inherit the most recent scheduler identity.
 await write(DB,900004);assert.equal(rows().find(r=>r.entity_id==='900004').actor_type,'unknown');
 sql.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(orderId,'synthetic-owner','synthetic-key','paid',JSON.stringify({email:'PRIVATE_CUSTOMER',shipment:{tracking:'PRIVATE_TRACKING',shipmentId:'shp_private',status:'pre_transit'}}),10000,1,1);
 let before=rows().length;
 assert.equal((await shippingEvent(false)).status,401);assert.equal(rows().length,before);
 assert.equal((await shippingEvent(true,'test')).status,200);assert.equal(rows().length,before);
 assert.equal((await shippingEvent()).status,200);
 const event=rows().at(-1);assert.equal(event.entity_id,orderId);assert.equal(event.actor,'Verified EasyPost tracking webhook');assert.equal(event.actor_type,'system');assert.equal(event.source,'system');assert(!JSON.stringify(event).includes('PRIVATE_'));
 assert.equal(sql.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status,'shipped');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM change_context').get().n,0);
 // Authorize.net calls reconcile with a truthful system actor only after signed/provider checks.
 let reconciled=0;
 const payments=load('app/api/payments/authorizenet/route.ts',{
  'next/server':{NextResponse},'@/lib/payments':{paymentProvider:()=> 'authorizenet'},
  '@/lib/authorizenet-payments':{verifyAnetWebhookSignature:(_raw,signature)=>signature==='fixture-valid',createAnetAdapter:()=>({transactionDetails:async()=>({order:{invoiceNumber:'A'.repeat(20)}})}),classifyAnetTransaction:()=>({state:'paid'})},
  '@/lib/runtime':{runtime:()=>env,one:async()=>({id:orderId,owner:'synthetic-owner',status:'awaiting_payment',total:10000})},
  '@/lib/checkout':{reconcile:async(owner,id,hints,actor)=>{reconciled++;assert.equal(id,orderId);assert.deepEqual(actor,{source:'system',actor:'Authorize.net webhook reconciliation',actorType:'system',action:'payment.webhook_reconcile'});}},
 });
 const paymentRequest=signature=>new Request('https://trybiomod.com/api/payments/authorizenet',{method:'POST',headers:{'x-anet-signature':signature},body:JSON.stringify({eventType:'net.authorize.payment.authcapture.created',payload:{entityName:'transaction',id:'12345'}})});
 assert.equal((await payments.POST(paymentRequest('invalid'))).status,401);assert.equal(reconciled,0);
 assert.equal((await payments.POST(paymentRequest('fixture-valid'))).status,200);assert.equal(reconciled,1);
 console.log('PASS: actual scheduled job dispatch and audit transactions isolate COA/recovery/retention identities; verified shipping webhook attribution; invalid/test callbacks do not write; Authorize.net reconciliation passes truthful actor; raw writes stay unknown. No live sends.');
}finally{sql.close();global.fetch=oldFetch;}})().catch(error=>{console.error(error);process.exitCode=1;});
