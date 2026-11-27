import { migrationStatements } from './sql-migration-fixture.mjs';
// Built Worker, isolated D1 and mocked authentication/carriers. No live account or email calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { Miniflare, Log, LogLevel } from 'miniflare';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),built=path.join(root,'dist/server');
const config=JSON.parse(await fs.readFile(path.join(built,'wrangler.json'),'utf8'));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'biomod-fulfillment-worker-'));
const paths=(await fs.readdir(built,{recursive:true})).filter(n=>/\.(?:m?js)$/.test(n));
const fixtureEmail='fulfillment-fixture@example.invalid',fixtureSecret='isolated-fixture-secret';
const calls=[];let carrierStatus='pre_transit';
const mf=new Miniflare({name:'isolated-fulfillment',cf:false,modules:[config.main,...paths.filter(n=>n!==config.main)].map(n=>({type:'ESModule',path:path.join(built,n)})),modulesRoot:built,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:{SUPABASE_URL:'https://auth.example.invalid',SUPABASE_ANON_KEY:'fixture',STORE_ADMIN_EMAILS:fixtureEmail,EASYPOST_API_KEY:'fixture-api-key',EASYPOST_WEBHOOK_SECRET:fixtureSecret},d1Databases:{DB:'fixture-shipping'},d1Persist:path.join(temporary,'d1'),outboundService:async request=>{
 calls.push({url:request.url,method:request.method});
 if(request.url==='https://auth.example.invalid/auth/v1/user')return Response.json({id:'fixture-admin',email:fixtureEmail,email_confirmed_at:'2099-01-01',user_metadata:{name:'Isolated preview'}});
 if(request.url==='https://api.easypost.com/v2/carrier_accounts')return Response.json({carrier_accounts:[]});
 if(request.url==='https://api.easypost.com/v2/webhooks')return Response.json({webhooks:[{url:'https://trybiomod.com/api/shipping/easypost',disabled_at:null}]});
 if(request.url==='https://api.easypost.com/v2/shipments/shp_fixture')return Response.json({id:'shp_fixture',mode:'production',tracking_code:'FIXTURETRACK',tracker:{tracking_code:'FIXTURETRACK',status:carrierStatus}});
 throw Error('External action forbidden in shipping fixture');
},log:new Log(LogLevel.ERROR)});
const origin='https://trybiomod.com',id='00000001-0000-4000-8000-000000000001';
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for(const name of (await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort()){
  const sql=await fs.readFile(path.join(root,'drizzle',name),'utf8');
  await db.batch(migrationStatements(sql).map(v=>db.prepare(v)));
 }
 await db.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').bind(id,'fixture-admin','fixture-session','shipped',10000,JSON.stringify({items:[],email:fixtureEmail,shipment:{shipmentId:'shp_fixture',tracking:'FIXTURETRACK',status:'pre_transit'}}),Date.now(),Date.now()).run();
 const anonymous=await mf.dispatchFetch(origin+'/api/admin/shipping');assert.equal(anonymous.status,403);assert.equal(calls.length,0);
 const headers={cookie:'bm_access=isolated-fixture-token',origin,'content-type':'application/json'};
 const health=await mf.dispatchFetch(origin+'/api/admin/shipping',{headers});assert.equal(health.status,200);assert.equal(health.headers.get('cache-control'),'no-store');assert((await health.json()).connected);
 const post=()=>mf.dispatchFetch(origin+'/api/admin/shipping',{method:'POST',headers,body:JSON.stringify({id,refreshTracking:true})});
 assert.equal((await post()).status,200);const snapshot=await db.prepare('SELECT status,data FROM orders WHERE id=?').bind(id).first();assert.equal(snapshot.status,'shipped');assert.equal(JSON.parse(snapshot.data).shipment.status,'pre_transit','Legacy status remains but carrier truth is preserved');
 carrierStatus='in_transit';assert.equal((await post()).status,200);assert.equal(JSON.parse((await db.prepare('SELECT data FROM orders WHERE id=?').bind(id).first()).data).shipment.status,'in_transit');
 const body=JSON.stringify({description:'tracker.updated',created_at:new Date(Date.now()+1000).toISOString(),result:{object:'Tracker',mode:'production',shipment_id:'shp_fixture',tracking_code:'FIXTURETRACK',status:'delivered'}});
 const signature='hmac-sha256-hex='+createHmac('sha256',fixtureSecret).update(body).digest('hex');
 assert.equal((await mf.dispatchFetch(origin+'/api/shipping/easypost',{method:'POST',headers:{'x-hmac-signature':signature},body})).status,200);
 assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').bind(id).first()).status,'delivered');
 const history=(await db.prepare('SELECT * FROM change_events').all()).results;
 const refreshEvents=history.filter(event=>event.action==='shipping.refresh_tracking');assert.equal(refreshEvents.length,4);
 for(const event of refreshEvents){assert.equal(event.actor,fixtureEmail);assert.equal(event.actor_type,'staff');assert.equal(event.source,'admin');}
 const updates=history.filter(event=>event.action==='order.update');assert.equal(updates.length,2);
 assert.equal(updates[0].actor,fixtureEmail);assert.equal(updates[0].source,'admin');
 assert.equal(updates[1].actor,'Verified EasyPost tracking webhook');assert.equal(updates[1].source,'system');
 assert(JSON.parse(updates[1].changes).some(change=>change.field==='Status'&&change.after==='delivered'));
 assert(!JSON.stringify(history).includes('FIXTURETRACK'),'Tracking number must not be copied into audit history');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM change_context').first()).n,0);
 assert(calls.every(c=>c.method==='GET'),'No label purchase, mail or other external mutation');
 // Actual order routes retain private admin evidence and guard every fulfillment path.
 const storePost=(action,body)=>mf.dispatchFetch(origin+'/api/store/admin-'+action,{method:'POST',headers,body:JSON.stringify(body)});
 const paidId='00000002-0000-4000-8000-000000000002',preorderId='00000003-0000-4000-8000-000000000003';
 const failedData={items:[],email:fixtureEmail,paymentVerified:{at:Date.now(),state:'failed',why:'Fixture missing capture'}};
 const preorderItems=[{id:1,quantity:1,product:{activePreorder:{percentOff:15,ships:'early November 2026',basePrice:10000}}}];
 for(const [orderId,data] of [[paidId,failedData],[preorderId,{items:preorderItems,email:fixtureEmail}]]) await db.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').bind(orderId,'fixture-admin','fixture-'+orderId,'paid',10000,JSON.stringify(data),Date.now(),Date.now()).run();
 let queue=await storePost('orders',{id:paidId});assert.equal(queue.status,200);let queueBody=await queue.json();assert.equal(queueBody.orders[0].data.paymentVerified.state,'failed','admin projection retains failed verification');assert.equal(queueBody.orders[0].version.length,64);
 const beforeProviders=calls.filter(c=>!c.url.includes('auth.example.invalid')).length;
 for(const orderId of [paidId,preorderId]){
   assert.equal((await mf.dispatchFetch(origin+'/api/admin/shipping',{method:'POST',headers,body:JSON.stringify({id:orderId})})).status,409);
   assert.equal((await storePost('order-handoff',{orderId})).status,409);
   assert.equal((await storePost('order',{id:orderId,status:'shipped',tracking:'FIXTURE'})).status,400);
   assert.equal((await mf.dispatchFetch(origin+'/api/admin/order-reship',{method:'POST',headers,body:JSON.stringify({orderId,tracking:'FIXTURE'})})).status,409);
 }
 assert.equal(calls.filter(c=>!c.url.includes('auth.example.invalid')).length,beforeProviders,'blocked fulfillment never reaches the carrier');
 queueBody=await (await storePost('orders',{id:preorderId})).json();let version=queueBody.orders[0].version;
 const originalVersion=version;
 const planBody={orderId:preorderId,expectedVersion:version,dispatchDate:'2099-01-10',note:'Supplier confirmed revised dispatch estimate.'};
 assert.equal((await storePost('preorder-plan',{...planBody,owner:'forged@example.invalid'})).status,400,'ownership cannot be forged');
 assert.equal((await storePost('preorder-plan',{...planBody,expectedVersion:'0'.repeat(64)})).status,400);
 const savePlan=await storePost('preorder-plan',planBody);assert.equal(savePlan.status,200,JSON.stringify(await savePlan.clone().json()));
 const planned=JSON.parse((await db.prepare('SELECT data FROM orders WHERE id=?').bind(preorderId).first()).data);assert.deepEqual(planned.items,preorderItems);assert.equal(planned.preorderPlan.owner,fixtureEmail);assert(!planned.preorderRelease);
 const planAudit=await db.prepare("SELECT actor,source,changes FROM change_events WHERE action='admin-preorder-plan' AND entity_id=?").bind(preorderId).first();assert.equal(planAudit.actor,fixtureEmail);assert.equal(planAudit.source,'admin');assert(!planAudit.changes.includes(planBody.note));
 assert.equal((await mf.dispatchFetch(origin+'/api/admin/shipping',{method:'POST',headers,body:JSON.stringify({id:preorderId})})).status,409,'saving an estimate does not release stock');
 queueBody=await (await storePost('orders',{id:preorderId})).json();version=queueBody.orders[0].version;assert.notEqual(version,originalVersion);assert.equal(queueBody.orders[0].data.preorderPlan.dispatchDate,'2099-01-10');
 assert.equal((await storePost('preorder-plan',planBody)).status,400);
 assert.equal((await storePost('preorder-release',{orderId:preorderId,note:'Warehouse confirmed exact lot ready.',expectedVersion:originalVersion})).status,400);
 assert.equal((await storePost('preorder-release',{orderId:preorderId,note:'Warehouse confirmed exact lot ready.',expectedVersion:'0'.repeat(64)})).status,400);
 const release=await storePost('preorder-release',{orderId:preorderId,note:'Warehouse confirmed exact lot ready.',expectedVersion:version});assert.equal(release.status,200,JSON.stringify(await release.clone().json()));
 const released=JSON.parse((await db.prepare('SELECT data FROM orders WHERE id=?').bind(preorderId).first()).data);assert.deepEqual(released.items,preorderItems);assert.equal(released.preorderRelease.by,fixtureEmail);
 const audit=await db.prepare("SELECT actor,source FROM change_events WHERE action='admin-preorder-release' AND entity_id=?").bind(preorderId).first();assert.equal(audit.actor,fixtureEmail);assert.equal(audit.source,'admin');
 const ready=await (await storePost('orders',{tab:'to_ship'})).json();assert(ready.orders.some(o=>o.id===preorderId));assert(!ready.orders.some(o=>o.id===paidId));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM change_context').first()).n,0);
 console.log('PASS: built order routes preserve payment evidence, reject failed/preorder label/manual/handoff/reship actions before any provider request, release preorder stock with atomic audit, reject stale releases and preserve purchased line snapshots.');
 console.log('PASS: actual built Worker authenticated carrier health, anonymous denial, isolated D1 tracking refresh and signed delivered transition. Only mocked read-only provider requests.');
}finally{await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}
