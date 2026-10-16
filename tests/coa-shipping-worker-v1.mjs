// Production-built routes on real local D1. The owner removed the "never ship without a COA" rule on
// October 14 2026, so this suite asserts what the store does now: a missing certificate holds nothing
// up. It is still a regression test — if the rule is ever switched back on, or the gating code starts
// blocking again on its own, these assertions fail loudly instead of the change going unnoticed.
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

 // An order containing a product with no certificate on file.
 const id=randomUUID();
 const data={email:'fixture@example.invalid',address:f.address,items:[{id:withCoa.id,quantity:1,product:{id:withCoa.id,name:withCoa.name}},{id:noCoa.id,quantity:1,product:{id:noCoa.id,name:noCoa.name}}],shipping:900,shippingService:'Standard shipping',total:5000};
 await f.db.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,checkout_ref,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,f.owner,randomUUID(),'paid',JSON.stringify(data),5000,'fixture-'+id,Date.now(),Date.now()).run();

 // It gets a label like any other order: the rule is off, so nothing is withheld for a missing COA.
 let r=await call('/api/admin/shipping',{method:'POST',body:JSON.stringify({id})});
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(f.calls.buys.length,1,'the carrier was asked for exactly one label');
 const labelled=await f.db.prepare('SELECT status,data FROM orders WHERE id=?').bind(id).first();
 assert.equal(labelled.status,'paid','a bought label is never a dispatch');
 assert.equal(JSON.parse(labelled.data).shipment.tracking,'SYNTHETIC_ONLY');

 // And it can be confirmed as handed to the carrier.
 r=await call('/api/store/admin-order',{method:'POST',body:JSON.stringify({id,status:'shipped',tracking:'SYNTHETIC_ONLY'})});
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal((await f.db.prepare('SELECT status FROM orders WHERE id=?').bind(id).first()).status,'shipped');

 // The queue flags nothing and lists no blocked products while the rule is off.
 // The search term travels in the body: it is a customer's own contact detail.
 r=await call('/api/store/admin-orders',{method:'POST',body:JSON.stringify({tab:'all'})});assert.equal(r.status,200);
 const row=r.body.orders.find(o=>o.id===id);
 assert(row,'the order is in the queue');
 assert.deepEqual(row.coaMissing,[],'no order is held for a missing certificate');
 assert.deepEqual(r.body.noCoa,[],'and none is listed as blocking');

 // A second order of the same product is not blocked either.
 const second=randomUUID();
 await f.db.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,checkout_ref,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').bind(second,f.owner,randomUUID(),'paid',JSON.stringify({...data,items:[{id:noCoa.id,quantity:1,product:{id:noCoa.id,name:noCoa.name}}]}),5000,'fixture-'+second,Date.now(),Date.now()).run();
 r=await call('/api/store/admin-orders',{method:'POST',body:JSON.stringify({tab:'to_ship'})});assert.equal(r.status,200);
 assert.deepEqual((r.body.orders.find(o=>o.id===second)||{}).coaMissing,[],'a COA-less product does not hold its order');
 assert.equal(f.calls.forbidden,0);
 console.log('PASS: built Worker with the COA-before-shipping rule removed: a product without a certificate is labelled, confirmed shipped and never flagged in the queue; a label is still not a dispatch. Synthetic data only.');
}finally{await f.close();}
