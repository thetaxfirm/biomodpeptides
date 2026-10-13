// Production-built shipping services admin route and checkout on real local D1; providers are synthetic.
import assert from 'node:assert/strict';
import {shippingWorkerFixture} from './shipping-worker-fixture-v1.mjs';
const f=await shippingWorkerFixture();
const origin='https://trybiomod.com',headers={origin,'content-type':'application/json',cookie:`bm_access=fixture-only; bm_session=${f.sessionId}`};
const call=async(url,init={})=>{const r=await f.mf.dispatchFetch(origin+url,{headers,...init});return {status:r.status,body:await r.json()};};
const save=settings=>call('/api/admin/shipping-services',{method:'POST',body:JSON.stringify({action:'save',destination:'ny',sample:'v3',settings})});
const services=[{key:'USPS:GROUNDADVANTAGE',enabled:true,markupCents:500,label:'Standard',note:'Tracked'},{key:'UPS:NEXTDAYAIR',enabled:true,markupCents:2000,label:'Overnight',note:'Next business day'},{key:'UPS:2NDDAYAIR',enabled:false,markupCents:0,label:'UPS 2nd Day Air',note:''},{key:'FedEx:PRIORITYOVERNIGHT',enabled:true,markupCents:100,label:'FedEx AM',note:''}];
try{
 let r=await call('/api/admin/shipping-services');assert.equal(r.status,200);assert.equal(r.body.catalog.length,20);assert.equal(r.body.connected,true);assert.equal(r.body.settings.services,undefined,'Legacy until first save');
 r=await call('/api/admin/shipping-services',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:JSON.stringify({action:'check'})});assert.equal(r.status,403);
 r=await call('/api/admin/shipping-services',{method:'POST',headers:{...headers,cookie:`bm_session=${f.sessionId}`},body:JSON.stringify({action:'check'})});assert.equal(r.status,403,'Signed-out request refused');
 r=await save({services:[{...services[0],markupCents:-1}],freeStandardEnabled:true,freeShippingAt:20000,shippingCents:700});assert.equal(r.status,400);
 // Save, read back, live check: FedEx is not quoted by the fixture, so it is reported, never shown as green.
 r=await save({services,freeStandardEnabled:true,freeShippingAt:25000,shippingCents:900});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.savedMatches,true);assert.equal(r.body.check.ok,true);
 assert.deepEqual(r.body.check.options.map(o=>[o.label,o.cents]),[['Standard',1400],['Overnight',4500]]);
 assert.deepEqual(r.body.check.services.map(s=>[s.key,s.status]),[['USPS:GROUNDADVANTAGE','ok'],['UPS:NEXTDAYAIR','ok'],['FedEx:PRIORITYOVERNIGHT','missing']]);
 const stored=JSON.parse((await f.db.prepare("SELECT value FROM settings WHERE key='store'").first()).value);
 assert.equal(stored.freeShippingAt,25000);assert.equal(stored.shippingCents,900);assert.deepEqual(stored.packDiscounts,f.store.packDiscounts,'Unrelated settings preserved');assert.equal(stored.shippingOptions.services.length,4);
 // Customer checkout now shows exactly those services, prices and wording (cart is $200, under the new $250 minimum).
 r=await call('/api/store/delivery',{method:'POST',body:JSON.stringify({address:f.address})});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.deepEqual(r.body.shippingOptions.map(o=>[o.shippingService,o.shipping,o.note||'']),[['Standard',1400,'Tracked'],['Overnight',4500,'Next business day']]);
 // The old store Settings save cannot wipe shipping services.
 r=await call('/api/store/admin-config',{method:'POST',body:JSON.stringify({packDiscounts:{3:12},presalesEnabled:false,rewardsEnabled:false,affiliateEnabled:false})});assert.equal(r.status,200,JSON.stringify(r.body));
 const after=JSON.parse((await f.db.prepare("SELECT value FROM settings WHERE key='store'").first()).value);assert.equal(after.shippingOptions.services.length,4);assert.equal(after.freeShippingAt,25000);assert.equal(after.packDiscounts['3'],12);
 const history=await f.db.prepare("SELECT summary FROM change_events WHERE action='shipping.services'").all();assert.match(history.results[0].summary,/Turned on Standard/);
 assert.equal(f.calls.buys.length,0,'Checks never buy postage');assert.equal(f.calls.forbidden,0);
 console.log('PASS: built Worker shipping services admin: catalog, origin/sign-in guards, validation, save read-back, live check with honest missing service, checkout shows owner services/prices/wording, store Settings save preserves shipping, change history. Synthetic providers only.');
}finally{await f.close();}
