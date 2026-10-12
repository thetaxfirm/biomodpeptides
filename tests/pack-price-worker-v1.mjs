// Built Worker integration: synthetic fixture state and intercepted providers, no production records.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {shippingWorkerFixture} from './shipping-worker-fixture-v1.mjs';
const f=await shippingWorkerFixture();
const origin='https://trybiomod.com',headers={origin,'content-type':'application/json',cookie:`bm_access=fixture-only; bm_session=${f.sessionId}`};
const guest={...headers,cookie:`bm_session=${f.sessionId}`};
const get=async(action,custom=headers)=>{const response=await f.mf.dispatchFetch(origin+'/api/store/'+action,{headers:custom});assert.equal(response.status,200,action);return response.json();};
const post=async(action,payload,custom=headers)=>{const response=await f.mf.dispatchFetch(origin+'/api/store/'+action,{method:'POST',headers:custom,body:JSON.stringify(payload)});assert.equal(response.headers.get('cache-control'),'no-store');return {status:response.status,body:await response.json()};};
const raw=async id=>(await f.db.prepare('SELECT data FROM product_overrides WHERE id=?').bind(id).first())?.data||'';
const edit=async(id,changes={})=>{const p=(await get('admin')).products.find(p=>p.id===id),before=JSON.parse(await raw(id)||'{}');assert(p);return post('admin-product',{id,price:p.price,packPrices:p.packPrices,inStock:p.inStock,purchasable:p.purchasable,stockQuantity:p.stockQuantity,maxQuantity:p.maxQuantity||100,expectedStock:before.stockQuantity??null,expectedVersion:p.editVersion,availability:p.availability,sale:p.sale,preorder:p.preorder,...changes});};
const packCart=(id,size)=>[{id,quantity:size,packId:'synthetic-pack-'+size,packSize:size,packKind:'fixed'}];
const checkoutBody=q=>({accepted:true,requestKey:randomUUID(),address:f.address,quoteId:q.quoteId,shippingOptionId:q.shippingOptionId,expectedTotal:q.total});
try{
 let r=await post('cart',{cart:packCart(f.product.id,3)});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.totals.total,54000);
 r=await post('delivery',{address:f.address});assert.equal(r.status,200);const oldQuote=r.body;assert.equal(oldQuote.items[0].lineTotal,54000);assert.equal(oldQuote.tax,4523);assert.equal(oldQuote.total,58523);
 r=await post('checkout',checkoutBody(oldQuote));assert.equal(r.status,200,JSON.stringify(r.body));const oldId=r.body.id,historical=await f.db.prepare('SELECT data,total FROM orders WHERE id=?').bind(oldId).first();assert.equal(historical.total,58523);
 const initial=(await get('admin')).products,formats=['research-compounds','softgels','spray-products'],selection=formats.map(slug=>slug==='research-compounds'?initial.find(p=>p.id===f.product.id):initial.find(p=>p.purchasable&&p.categories.some(c=>c.slug===slug)));
 assert(selection.every(Boolean));const expected={3:29697,5:46746,10:87992};
 for(const p of selection){
  r=await edit(p.id,{price:10999,packPrices:{3:1,5:2,10:3},preorder:null,sale:null});assert.equal(r.status,200,JSON.stringify(r.body));
  const current=(await get('state',guest)).products.find(v=>v.id===p.id);assert.deepEqual(current.packPrices,expected);assert.equal(current.price,10999);for(const key of ['editVersion','packPricingMode','batch'])assert.equal(current[key],undefined,'Private or ephemeral field is not public: '+key);
  assert.equal(JSON.parse(await raw(p.id)).packPricingMode,undefined);
  for(const size of [3,5,10]){r=await post('cart',{cart:packCart(p.id,size)});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.totals.total,expected[size]);assert.equal(r.body.totals.items[0].lineTotal,expected[size]);}
 }
 // Payment quote uses the same newly saved 3-pack cents and recalculates tax.
 r=await post('cart',{cart:packCart(f.product.id,3)});assert.equal(r.status,200);
 r=await post('checkout',checkoutBody(oldQuote));assert.equal(r.status,200);assert.equal(r.body.id,oldId,'An already-created order keeps its original immutable price');assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM orders').first()).n,1);
 // Close only this synthetic fixture order so a genuinely new checkout reaches quote validation.
 await f.db.prepare("UPDATE orders SET status='shipped' WHERE id=?").bind(oldId).run();await f.db.prepare('DELETE FROM inventory_reservations WHERE order_id=?').bind(oldId).run();
 r=await post('checkout',checkoutBody(oldQuote));assert.equal(r.status,400);assert.match(r.body.error,/quote changed|expired/);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM orders').first()).n,1,'Stale quote cannot create a second order');
 r=await post('delivery',{address:f.address});assert.equal(r.status,200);assert.equal(r.body.items[0].lineTotal,29697);assert.equal(r.body.tax,2487);assert.equal(r.body.total,32184);
 const currentVersion=(await get('admin')).products.find(p=>p.id===f.product.id).editVersion;
 r=await edit(f.product.id,{price:11999,packPricingMode:'custom',packPrices:{3:24001,5:40001,10:75001}});assert.equal(r.status,200,JSON.stringify(r.body));r=await post('cart',{cart:packCart(f.product.id,3)});assert.equal(r.status,200);assert.equal(r.body.totals.total,24001,'Manual prices remain authoritative');
 r=await edit(f.product.id,{price:12999,packPricingMode:'automatic',expectedVersion:currentVersion});assert.equal(r.status,400);assert.match(r.body.error,/changed|outdated/);assert.equal(JSON.parse(await raw(f.product.id)).price,11999);
 r=await edit(f.product.id,{packPricingMode:'automatic',packPrices:{3:1,5:1,10:1}});assert.equal(r.status,200);assert.deepEqual(JSON.parse(await raw(f.product.id)).packPrices,{3:32397,5:50996,10:95992});
 const latest=(await get('admin')).orders.find(o=>o.id===oldId);assert.equal(latest.total,historical.total);assert.deepEqual(await f.db.prepare('SELECT data,total FROM orders WHERE id=?').bind(oldId).first(),historical,'Price updates cannot rewrite previous order');assert.equal(latest.data.items[0].product.price,20000);assert.equal(latest.data.items[0].lineTotal,54000);
 const events=(await f.db.prepare("SELECT * FROM change_events WHERE entity_type='product' AND source='admin'").all()).results;assert(events.some(e=>e.actor===f.email&&JSON.parse(e.changes).some(c=>c.field==='3-pack price (cents)'&&c.after===29697)),'Automatic fixed-pack change has staff attribution and exact cents');
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM change_context').first()).n,0);assert.equal(f.calls.buys.length,0);assert.equal(f.calls.hosted.length,0);assert.equal(f.calls.forbidden,0);
 console.log('PASS: built Worker automatic pack pricing across vial/softgel/spray, public state/cart/delivery exact cents, manual override, stale version/quote denial, immutable older checkout and attributed pack audit. One synthetic local order only; no payment forms, labels or live providers.');
}finally{await f.close();}
