/* Per-service shipping: owner-chosen services, extras and wording through quote, payment, label and live check.
 * Full isolated SQLite migrations, synthetic data and intercepted providers only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const root = path.resolve(__dirname, '..');
const sql = new DatabaseSync(':memory:');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
class Statement {
  constructor(query, values = []) { this.query = query; this.values = values; }
  bind(...values) { return new Statement(this.query, values); }
  async first() { return sql.prepare(this.query).get(...this.values) || null; }
  async all() { return { results: sql.prepare(this.query).all(...this.values) }; }
  async run() { const result = sql.prepare(this.query).run(...this.values); return { meta: { changes: result.changes } }; }
}
const db = {
  prepare: query => new Statement(query),
  async batch(statements) {
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
};
let clock = Date.now();
const env = { EASYPOST_API_KEY: 'EZAK_isolated_fixture', TAXJAR_API_TOKEN: 'isolated-tax', STORE_ORIGIN_ZIP: '89118', STORE_ORIGIN_STATE: 'NV' };
const runtime = {
  runtime: () => env, database: () => db, timestamp: () => clock, uid: randomUUID,
  parse: (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } },
  all: async (query, ...values) => (await db.prepare(query).bind(...values).all()).results,
  one: async (query, ...values) => db.prepare(query).bind(...values).first(),
  run: async (query, ...values) => db.prepare(query).bind(...values).run(),
  setting: async (key, fallback) => { const row = sql.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; },
};
const paymentRequests = [];
const originalLoad = Module._load, originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network is forbidden in this test'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/checkout.ts') || parent?.filename.endsWith('/lib/commerce.ts')) {
    if (request === './runtime') return runtime;
    if (request === './auth') return { customer: async () => ({ email: 'fixture@example.invalid' }) };
    if (request === './payments') return {
      paymentEnvironment: () => 'isolated', paymentReturnUrl: () => 'https://example.invalid/return',
      createPaymentAdapter: () => ({ getStatus: () => ({ checkoutEnabled: true }), reference: id => 'isolated-' + id,
        createCheckout: async order => { paymentRequests.push(order); return { providerReference: 'isolated-' + order.id, url: '/isolated-payment/' + order.id }; } }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const shipping = require('../lib/shipping-options.ts');
const ep = require('../lib/easypost.ts');
const { products } = require('../lib/catalog.ts');
const { config } = require('../lib/commerce.ts');
const { deliveryQuote, issueQuote, checkout, quoteFingerprint } = require('../lib/checkout.ts');
const product = products.find(p => p.slug === 'bpc-157-10mg');
const lines = [{ id: product.id, quantity: 1 }];
const address = { name: 'Synthetic fixture', line1: '1 Example Road', line2: '', city: 'Las Vegas', state: 'NV', zip: '89101', country: 'US', phone: '7025550100' };
const defaults = shipping.normalizeShippingOptions();
const store = (overrides = {}) => sql.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('store', JSON.stringify({ shippingCents: 700, freeShippingAt: 20000, ...overrides }));
const seedProduct = (price = 10000) => sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(product.id, JSON.stringify({ price, inStock: true, purchasable: true, stockQuantity: 100, maxQuantity: 100 }));
const rate = (id,carrier,service,price,days=null,extra={}) => ({ id:'rate_'+id, carrier, service, rate:price, delivery_days:days, currency:'USD', ...extra });
let available = [rate('ground','USPS','GroundAdvantage','9.00',1),rate('priority','USPS','Priority','12.00',2),rate('express','USPS','Express','21.00'),rate('overnight','UPSDAP','NextDayAir','25.00'),rate('fedex','FedEx','STANDARD_OVERNIGHT','24.00',1),rate('wrongcurrency','UPS','NextDayAir','1.00',1,{currency:'EUR'}),rate('prefix','UPS_FAKE','Ground','1.00'),rate('invented','USPS','MagicOneDay','1.00',1)];
let carrierCalls=0,buyCalls=[],taxCalls=[],failRates=false;
global.fetch=async(url,init)=>{
 const body=init.body ? JSON.parse(init.body):null;
 if(url==='https://api.easypost.com/v2/shipments'){carrierCalls++;if(failRates)return Response.json({}, {status:503});return Response.json({id:'shp_fixture',mode:'production',rates:available});}
 if(url==='https://api.easypost.com/v2/shipments/shp_fixture/buy'){buyCalls.push(body.rate.id);return Response.json({id:'shp_fixture',tracking_code:'SYNTHETIC',postage_label:{label_url:'https://example.invalid/label'},tracker:{public_url:'https://example.invalid/tracking'}});}
 if(url==='https://api.taxjar.com/v2/taxes'){taxCalls.push(body);return Response.json({tax:{amount_to_collect:Math.round((body.amount+body.shipping)*10)/100}});}
 throw Error('Unexpected external request prohibited: '+url);
};
const requestBody = q => ({accepted:true,requestKey:randomUUID(),address,quoteId:q.quoteId,shippingOptionId:q.shippingOptionId,expectedTotal:q.total});
const rejected = async(fn,pattern)=>{const count=sql.prepare('SELECT COUNT(*) n FROM orders').get().n,payments=paymentRequests.length;await assert.rejects(fn,pattern);assert.equal(sql.prepare('SELECT COUNT(*) n FROM orders').get().n,count);assert.equal(paymentRequests.length,payments);};
(async()=>{
 seedProduct();
 available=[rate('ground','USPS','GroundAdvantage','9.00',3),rate('upsground','UPSDAP','Ground','11.50',4),rate('priority','USPS','Priority','12.00',2),rate('overnight','UPSDAP','NextDayAir','25.00',1),rate('fedex','FedEx','STANDARD_OVERNIGHT','24.00',1),rate('odd','UPS','WorldwideExpedited','40.00',3)];
 const services=[
  {key:'USPS:GROUNDADVANTAGE',enabled:true,markupCents:473,label:'Standard',note:''},
  {key:'UPS:GROUND',enabled:true,markupCents:0,label:'UPS Ground',note:'Tracked'},
  {key:'UPS:NEXTDAYAIR',enabled:true,markupCents:1500,label:'Overnight',note:'Next business day'},
  {key:'FedEx:STANDARDOVERNIGHT',enabled:false,markupCents:900,label:'FedEx overnight',note:''},
  {key:'bogus',enabled:true,markupCents:1,label:'x',note:''},
 ];
 const cfg=shipping.normalizeShippingOptions({freeStandardEnabled:true,services});
 assert.deepEqual(cfg.carriers,['USPS','UPS'],'Carriers follow the services turned on');
 assert.equal(cfg.standardEnabled,true);assert.equal(cfg.expeditedEnabled,false);assert.equal(cfg.overnightEnabled,true);
 assert.equal(cfg.services.length,4,'Malformed service keys are dropped');
 store({shippingOptions:{freeStandardEnabled:true,services}});
 // Customers see exactly the services turned on, at carrier price plus the owner's extra, with the owner's wording.
 let q=await deliveryQuote(lines,address);
 assert.deepEqual(q.shippingOptions.map(o=>[o.shippingService,o.shipping,o.note||'']),[['UPS Ground',1150,'Tracked'],['Standard',1373,''],['Overnight',4000,'Next business day']]);
 assert(!q.shippingOptions.some(o=>o.carrier==='FedEx'||o.carrierService==='Priority'),'Services left off never appear');
 assert.equal(q.shippingOption.serviceKey,'UPS:GROUND','Cheapest offered option is preselected');
 // Selection, payment handoff and the saved order keep the exact service and extra.
 const first=await issueQuote('svc-owner',lines,address);
 const chosen=await issueQuote('svc-owner',lines,address,undefined,{quoteId:first.quoteId,shippingOptionId:'rate_overnight'});
 assert.equal(chosen.shipping,4000);assert.equal(chosen.shippingService,'Overnight');
 const result=await checkout('svc-owner',lines,requestBody(chosen));
 const saved=JSON.parse(sql.prepare('SELECT data FROM orders WHERE id=?').get(result.id).data);
 assert.equal(paymentRequests.at(-1).totalCents,chosen.total);
 assert.deepEqual([saved.shipping,saved.shippingOption.serviceKey,saved.shippingOption.handlingCents,saved.shippingOption.carrierCents,saved.shippingOption.note],[4000,'UPS:NEXTDAYAIR',1500,2500,'Next business day']);
 // Label purchase buys the carrier service the customer paid for, at carrier cost.
 const label=await ep.buyLabel(env,address,[],'Synthetic label',shipping.savedShippingOption(saved.shippingOption));
 assert.equal(buyCalls.at(-1),'rate_overnight');assert.equal(label.costCents,2500);
 // A price change after quoting forces a new quote instead of charging the old price.
 const stale=await issueQuote('svc-owner-2',lines,address);
 store({shippingOptions:{freeStandardEnabled:true,services:services.map(s=>s.key==='UPS:GROUND'?{...s,markupCents:200}:s)}});
 await rejected(()=>issueQuote('svc-owner-2',lines,address,undefined,{quoteId:stale.quoteId,shippingOptionId:'rate_upsground'}),/shipping options changed/);
 // Turning a service off removes it, including from a pending quote.
 const pending=await issueQuote('svc-owner-3',lines,address);
 store({shippingOptions:{freeStandardEnabled:true,services:services.map(s=>s.key==='UPS:NEXTDAYAIR'?{...s,enabled:false}:s)}});
 await rejected(()=>issueQuote('svc-owner-3',lines,address,undefined,{quoteId:pending.quoteId,shippingOptionId:'rate_overnight'}),/shipping options changed/);
 assert(!(await deliveryQuote(lines,address)).shippingOptions.some(o=>o.serviceKey==='UPS:NEXTDAYAIR'));
 // Free shipping over the minimum: only the cheapest offered standard service is free.
 store({shippingOptions:{freeStandardEnabled:true,services}});seedProduct(20000);
 q=await deliveryQuote(lines,address);
 assert.deepEqual(q.shippingOptions.map(o=>[o.serviceKey,o.shipping,o.free]),[['USPS:GROUNDADVANTAGE',0,true],['UPS:GROUND',1150,false],['UPS:NEXTDAYAIR',4000,false]]);
 const freeFirst=await issueQuote('svc-free',lines,address);
 const paidStd=await issueQuote('svc-free',lines,address,undefined,{quoteId:freeFirst.quoteId,shippingOptionId:'rate_upsground'});
 assert.equal(paidStd.shipping,1150,'A second standard service keeps its price over the minimum');
 store({shippingOptions:{freeStandardEnabled:false,services}});q=await deliveryQuote(lines,address);assert(!q.shippingOptions.some(o=>o.free));
 // Owner, Oct 17 2026: no standard service on, so USPS Priority Mail is the free service at the minimum; Express never is.
 const usps=[{key:'USPS:GROUNDADVANTAGE',enabled:false,markupCents:0,label:'USPS Ground Advantage',note:''},{key:'USPS:PRIORITY',enabled:true,markupCents:0,label:'USPS Priority Mail',note:''},{key:'USPS:EXPRESS',enabled:true,markupCents:1000,label:'USPS Priority Mail Express',note:''}];
 const ratesBefore=available;available=[rate('ground','USPS','GroundAdvantage','9.00',3),rate('priority','USPS','Priority','12.00',2),rate('express','USPS','Express','21.00',2)];
 store({freeShippingAt:25000,shippingOptions:{freeStandardEnabled:true,services:usps}});seedProduct(24999);
 q=await deliveryQuote(lines,address);
 assert.deepEqual(q.shippingOptions.map(o=>[o.serviceKey,o.shipping,o.free]),[['USPS:PRIORITY',1200,false],['USPS:EXPRESS',3100,false]],'Below $250 nothing is free');
 seedProduct(25000);
 q=await deliveryQuote(lines,address);
 assert.deepEqual(q.shippingOptions.map(o=>[o.serviceKey,o.shipping,o.free,o.shippingService]),[['USPS:PRIORITY',0,true,'Free · USPS Priority Mail'],['USPS:EXPRESS',3100,false,'USPS Priority Mail Express']]);
 const freePriority=await issueQuote('svc-priority',lines,address);
 assert.equal(freePriority.shipping,0);
 const priorityOrder=await checkout('svc-priority',lines,requestBody(freePriority));
 const prioritySaved=JSON.parse(sql.prepare('SELECT data FROM orders WHERE id=?').get(priorityOrder.id).data);
 assert.deepEqual([prioritySaved.shipping,prioritySaved.shippingOption.serviceKey,prioritySaved.shippingOption.free],[0,'USPS:PRIORITY',true]);
 assert(shipping.savedShippingOption(prioritySaved.shippingOption),'A free Priority snapshot is a valid saved option');
 assert.equal(shipping.savedShippingOption({...prioritySaved.shippingOption,serviceKey:'USPS:EXPRESS',carrierService:'Express'}),null,'A free Express snapshot is refused');
 const pendingFree=await issueQuote('svc-priority-2',lines,address);
 store({freeShippingAt:25000,shippingOptions:{freeStandardEnabled:false,services:usps}});
 await rejected(()=>issueQuote('svc-priority-2',lines,address,undefined,{quoteId:pendingFree.quoteId,shippingOptionId:'rate_priority'}),/shipping options changed/);
 store({freeShippingAt:25000,shippingOptions:{freeStandardEnabled:true,services:usps.map(s=>s.key==='USPS:PRIORITY'?{...s,enabled:false}:s)}});
 assert(!(await deliveryQuote(lines,address)).shippingOptions.some(o=>o.free),'Express alone is never free');
 const { shippingTerms: terms }=require('../lib/shipping-terms.ts');
 const t=terms({freeShippingAt:25000,shippingOptions:{freeStandardEnabled:true,services:usps}});
 assert.equal(t.standard,'USPS Priority Mail is free on orders of $250 or more after discounts and before tax. Faster services are priced separately.');
 assert.equal(t.banner,'U.S. shipping · Free USPS Priority Mail on orders of $250 or more.');
 assert.equal(t.freeLabel,'USPS Priority Mail');
 available=ratesBefore;
 seedProduct();
 // Everything off: checkout refuses rather than inventing a price (no backup price set).
 store({shippingCents:null,shippingOptions:{freeStandardEnabled:true,services:services.map(s=>({...s,enabled:false}))}});
 await assert.rejects(deliveryQuote(lines,address),/No enabled delivery option/);
 // Live admin check uses the same pricing and reports each service honestly.
 const check=await ep.liveShippingCheck(env,address,[],shipping.normalizeShippingOptions({services:[...services.slice(0,3),{key:'FedEx:PRIORITYOVERNIGHT',enabled:true,markupCents:100,label:'FedEx AM',note:''}]}));
 assert.deepEqual(check.services.map(s=>[s.key,s.status,s.customerCents]),[['USPS:GROUNDADVANTAGE','ok',1373],['UPS:GROUND','ok',1150],['UPS:NEXTDAYAIR','ok',4000],['FedEx:PRIORITYOVERNIGHT','missing',null]]);
 assert(check.rates.some(r=>r.key==='FedEx:STANDARDOVERNIGHT'),'All carrier quotes are listed for the owner, including services not offered');
 assert.equal(check.freeStandardLabel,'Free · Standard');
 // Public policy copy follows per-service settings.
 const { shippingTerms }=require('../lib/shipping-terms.ts');
 assert.match(shippingTerms({freeShippingAt:20000,shippingOptions:{services}}).overnight,/Overnight delivery is offered/);
 assert.equal(shippingTerms({freeShippingAt:20000,shippingOptions:{services:services.map(s=>s.key==='UPS:NEXTDAYAIR'?{...s,enabled:false}:s)}}).overnight,null);
 // A product with no stock count is untracked: it never blocks checkout with a contact-us hold.
 store();sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(product.id,JSON.stringify({price:7999}));
 const untracked=await issueQuote('untracked-owner',[{id:product.id,quantity:2}],address);
 const order=await checkout('untracked-owner',[{id:product.id,quantity:2}],requestBody(untracked));
 assert.match(order.url,/isolated-payment/);
 assert.equal(sql.prepare('SELECT quantity FROM inventory_reservations WHERE order_id=?').get(order.id).quantity,2);
 sql.prepare("UPDATE orders SET status='paid' WHERE id=?").run(order.id);
 const inv=require('../lib/inventory-statements.json');sql.prepare(inv.settleInventory).run(order.id,order.id,order.id);
 assert.equal(JSON.parse(sql.prepare('SELECT data FROM product_overrides WHERE id=?').get(product.id).data).stockQuantity ?? null,null,'Paying never invents a count');
 // A counted product still cannot be oversold.
 sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(product.id,JSON.stringify({price:7999,stockQuantity:1,inStock:true,purchasable:true}));
 await rejected(async()=>{const over=await issueQuote('counted-owner',[{id:product.id,quantity:2}],address);return checkout('counted-owner',[{id:product.id,quantity:2}],requestBody(over));},/./);
 // Tampered snapshots are refused.
 assert.equal(shipping.savedShippingOption({...saved.shippingOption,serviceKey:'USPS:PRIORITY'}),null);
 assert.equal(shipping.savedShippingOption({...saved.shippingOption,note:'x'.repeat(161)}),null);
 console.log('PASS: per-service shipping: only chosen services shown, carrier price + owner extra, owner wording, exact saved service and label, stale price/off-service quotes refused, free minimum on the lowest-carrier-cost standard only, no invented price, live check statuses, policy copy, untracked stock never holds checkout while counted stock cannot oversell. No live providers.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Module._load=originalLoad;global.fetch=originalFetch;sql.close();});
