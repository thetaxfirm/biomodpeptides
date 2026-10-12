// Production-built routes and real local D1; all provider responses are synthetic.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {shippingWorkerFixture} from './shipping-worker-fixture-v1.mjs';
const f=await shippingWorkerFixture();
const origin='https://trybiomod.com',headers={origin,'content-type':'application/json',cookie:`bm_access=fixture-only; bm_session=${f.sessionId}`};
const post=async(action,payload,custom=headers)=>{const r=await f.mf.dispatchFetch(origin+'/api/store/'+action,{method:'POST',headers:custom,body:JSON.stringify(payload)});assert.equal(r.headers.get('cache-control'),'no-store');return {status:r.status,body:await r.json()};};
try{
 let r=await post('delivery',{address:f.address},{...headers,cookie:`bm_session=${f.sessionId}`});assert.equal(r.status,400);assert.equal(f.calls.rates,0);
 r=await post('delivery',{address:f.address});assert.equal(r.status,200,JSON.stringify(r.body));const q=r.body;assert.equal(q.shipping,0);assert.equal(q.shippingOptions.length,3);assert.equal(q.shippingOptions.find(o=>o.tier==='overnight').shipping,3500);assert.equal(f.calls.rates,1);
 r=await post('delivery',{address:f.address,quoteId:q.quoteId,shippingOptionId:'rate_overnight',shipping:0});assert.equal(r.status,200,JSON.stringify(r.body));const selected=r.body;assert.equal(selected.shipping,3500);assert.equal(selected.tax,1675);assert.equal(selected.total,25175);assert.equal(selected.quoteExpiresAt,q.quoteExpiresAt);assert.equal(f.calls.rates,1);
 const body={accepted:true,requestKey:randomUUID(),address:f.address,quoteId:selected.quoteId,shippingOptionId:selected.shippingOptionId,expectedTotal:selected.total};
 r=await post('checkout',{...body,shippingOptionId:'rate_ground'});assert.equal(r.status,400);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM orders').first()).n,0);
 r=await post('checkout',{...body,expectedTotal:1});assert.equal(r.status,400);
 r=await post('checkout',body);assert.equal(r.status,200,JSON.stringify(r.body));const id=r.body.id;
 let order=await f.db.prepare('SELECT status,total,data FROM orders WHERE id=?').bind(id).first();const saved=JSON.parse(order.data);assert.equal(order.status,'awaiting_payment');assert.equal(order.total,25175);assert.equal(saved.shippingOption.carrierService,'NextDayAir');assert.equal(saved.shippingOption.handlingCents,1000);assert.equal(saved.shippingOptions,undefined);
 const pay=await f.mf.dispatchFetch(origin+'/api/store/pay?id='+id,{headers});assert.equal(pay.status,200,await pay.text());assert.equal(f.calls.hosted.length,1);assert.equal(f.calls.hosted[0].transactionRequest.amount,'251.75');assert.equal(f.calls.hosted[0].transactionRequest.shipping.amount,'35.00');
 // Local fixture marks a synthetic order paid solely to exercise the manual label route.
 await f.db.prepare("UPDATE orders SET status='paid' WHERE id=?").bind(id).run();
 const label=await f.mf.dispatchFetch(origin+'/api/admin/shipping',{method:'POST',headers,body:JSON.stringify({id})});assert.equal(label.status,200,await label.text());assert.equal(f.calls.buys.length,1);assert.equal(f.calls.buys[0].rate.id,'rate_overnight');order=await f.db.prepare('SELECT status,data FROM orders WHERE id=?').bind(id).first();assert.equal(order.status,'paid','A purchased label is not dispatch');assert.equal(JSON.parse(order.data).shipment.service,'UPS Next Day Air');
 r=await post('admin-config',{...f.store,shippingOptions:{...f.store.shippingOptions,overnightHandlingCents:1750}});assert.equal(r.status,200,JSON.stringify(r.body));
 const state=await(await f.mf.dispatchFetch(origin+'/api/store/state',{headers})).json();assert.equal(state.config.shippingOptions.overnightHandlingCents,1750);
 r=await post('delivery',{address:f.address});assert.equal(r.status,200);assert.equal(r.body.shippingOptions.find(o=>o.tier==='overnight').shipping,4250);assert.equal(r.body.shipping,0);
 // An older editor omitting the new block preserves current delivery settings.
 const {shippingOptions:_options,...legacy}=f.store;r=await post('admin-config',legacy);assert.equal(r.status,200);assert.equal(JSON.parse((await f.db.prepare("SELECT value FROM settings WHERE key='store'").first()).value).shippingOptions.overnightHandlingCents,1750);
 const history=(await f.db.prepare("SELECT * FROM change_events WHERE entity_type='setting' AND entity_id='store'").all()).results;assert(history.some(e=>e.actor===f.email&&e.actor_type==='staff'&&e.source==='admin'&&JSON.parse(e.changes).some(c=>c.field==='Overnight handling (cents)'&&c.before===1000&&c.after===1750)),'Settings fee change is attributed with exact before/after values');
 assert.equal(f.calls.forbidden,0);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM change_context').first()).n,0);
 console.log('PASS: built Worker delivery selection, saved quote tamper guards, exact tax/payment amount and receipt service, paid-label carrier/service match, shared admin settings preservation and audit. Synthetic local order and intercepted providers only.');
}finally{await f.close();}
