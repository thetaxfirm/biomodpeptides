// Production-built routes on real local D1: a paid order with a product lacking a COA cannot be labeled or marked shipped,
// and the Orders queue lists it. Providers are intercepted; no postage is bought.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {shippingWorkerFixture} from './shipping-worker-fixture-v1.mjs';
const f=await shippingWorkerFixture();
const origin='https://trybiomod.com',headers={origin,'content-type':'application/json',cookie:`bm_access=fixture-only; bm_session=${f.sessionId}`};
const call=async(url,init={})=>{const r=await f.mf.dispatchFetch(origin+url,{headers,...init});return {status:r.status,body:await r.json()};};
try{
 const state=await call('/api/store/state');
 const noCoa=state.body.products.find(p=>p.resolvedBatch&&p.resolvedBatch.coa_available===false&&p.purchasable);
 const withCoa=state.body.products.find(p=>p.resolvedBatch?.coa_available===true);
 assert(noCoa&&withCoa,'Fixture catalog has both kinds');
 const id=randomUUID();
 const data={email:'fixture@example.invalid',address:f.address,items:[{id:withCoa.id,quantity:1,product:{id:withCoa.id,name:withCoa.name}},{id:noCoa.id,quantity:1,product:{id:noCoa.id,name:noCoa.name}}],shipping:900,shippingService:'Standard',total:5000};
 await f.db.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,checkout_ref,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,f.owner,randomUUID(),'paid',JSON.stringify(data),5000,'fixture-'+id,Date.now(),Date.now()).run();
 let r=await call('/api/admin/shipping',{method:'POST',body:JSON.stringify({id})});
 assert.equal(r.status,409,JSON.stringify(r.body));assert.match(r.body.error,new RegExp('no COA on file for '+noCoa.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.equal(f.calls.rates,0,'No carrier call');assert.equal(f.calls.buys.length,0,'No postage bought');
 r=await call('/api/store/admin-order',{method:'POST',body:JSON.stringify({id,status:'shipped',tracking:'X'})});
 assert.notEqual(r.status,200);assert.match(r.body.error,/no COA on file/);
 assert.equal((await f.db.prepare('SELECT status FROM orders WHERE id=?').bind(id).first()).status,'paid','Order stays paid, not shipped');
 r=await call('/api/store/admin-orders?tab=to_ship');assert.equal(r.status,200);
 const row=r.body.orders.find(o=>o.id===id);assert.deepEqual(row.coaMissing,[noCoa.name]);
 const listed=r.body.noCoa.find(p=>p.id===noCoa.id);assert.equal(listed.waitingOrders,1);assert(!r.body.noCoa.some(p=>p.id===withCoa.id));
 console.log('PASS: built Worker no-COA rule: label refused before any carrier call, mark-shipped refused, order stays paid, queue flags the order and lists '+r.body.noCoa.length+' products with waiting counts. Synthetic data only.');
}finally{await f.close();}
