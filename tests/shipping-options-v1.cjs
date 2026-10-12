/* Actual shipping options, quote, payment handoff and label service matching.
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
 assert.deepEqual(defaults,{standardEnabled:true,expeditedEnabled:true,overnightEnabled:true,freeStandardEnabled:true,standardHandlingCents:0,expeditedHandlingCents:0,overnightHandlingCents:1000,carriers:['USPS','UPS']});
 const legacy=shipping.normalizeShippingOptions(undefined,{EASYPOST_CARRIERS:'UPSDAP,FedEx',SHIP_HANDLING_CENTS:'250'});assert.deepEqual(legacy.carriers,['UPS','FedEx']);assert.equal(legacy.standardHandlingCents,250);assert.equal(legacy.expeditedHandlingCents,250);assert.equal(legacy.overnightHandlingCents,1000);
 assert.deepEqual(shipping.normalizeShippingOptions({carriers:['USPS'],standardHandlingCents:0},{EASYPOST_CARRIERS:'UPS',SHIP_HANDLING_CENTS:'250'}).carriers,['USPS']);assert.equal(shipping.normalizeShippingOptions({standardHandlingCents:0},{SHIP_HANDLING_CENTS:'250'}).standardHandlingCents,0);
 assert.deepEqual(shipping.normalizeShippingOptions({carriers:[]}).carriers,[],'Empty explicit list is never silently reenabled');
 assert.equal(shipping.shippingCarrier('UPS_FAKE'),null);assert.equal(shipping.shippingTier('USPS','GroundAdvantage',1),'standard');assert.equal(shipping.shippingTier('USPS','Express',null),'expedited');assert.equal(shipping.shippingTier('USPS','Express',2),'expedited');assert.equal(shipping.shippingTier('USPS','Express',1),'overnight');assert.equal(shipping.shippingTier('UPS','Express',1),null);assert.equal(shipping.shippingTier('UPS','NextDayAir',null),'overnight');assert.equal(shipping.shippingTier('FedEx','STANDARD_OVERNIGHT',1),'overnight');
 seedProduct();store();
 const first=await issueQuote('shipping-owner',lines,address);
 assert.equal(carrierCalls,1);assert.equal(taxCalls.length,1,'Only selected option is taxed');assert.deepEqual(first.shippingOptions.map(o=>o.tier),['standard','expedited','overnight']);assert.equal(first.shipping,900);assert.equal(first.shippingOptions[2].shipping,3500);assert.equal(first.shippingOptions[2].handlingCents,1000);assert.equal(first.shippingOptions[2].days,null,'Null transit estimate stays unknown, not zero');assert.equal(first.shippingOptions[1].carrierService,'Priority');
 const initialCreated=clock;clock+=300000;
 const selected=await issueQuote('shipping-owner',lines,address,undefined,{quoteId:first.quoteId,shippingOptionId:'rate_overnight'});
 assert.equal(carrierCalls,1,'Changing option reuses one carrier quote');assert.equal(taxCalls.length,2);assert.equal(taxCalls.at(-1).shipping,35);assert.equal(selected.shipping,3500);assert.equal(selected.total,14850);assert.equal(selected.quoteExpiresAt,initialCreated+600000,'Reselection never extends rate expiry');
 await rejected(()=>issueQuote('other-owner',lines,address,undefined,{quoteId:first.quoteId,shippingOptionId:'rate_overnight'}),/expired/);
 await rejected(()=>issueQuote('shipping-owner',lines,address,undefined,{quoteId:first.quoteId,shippingOptionId:'rate_fake'}),/available shipping option/);
 await rejected(()=>issueQuote('shipping-owner',lines,{...address,zip:'90001'},undefined,{quoteId:first.quoteId,shippingOptionId:'rate_overnight'}),/cart, address or promotion changed/);
 await rejected(()=>issueQuote('shipping-owner',lines,address,'BM10',{quoteId:first.quoteId,shippingOptionId:'rate_overnight'}),/cart, address or promotion changed/);
 await rejected(()=>issueQuote('shipping-owner',[{...lines[0],quantity:2}],address,undefined,{quoteId:first.quoteId,shippingOptionId:'rate_overnight'}),/cart, address or promotion changed/);
 await rejected(()=>checkout('shipping-owner',lines,{...requestBody(selected),shippingOptionId:'rate_ground'}),/selected shipping option/);
 await rejected(()=>checkout('shipping-owner',lines,{...requestBody(selected),expectedTotal:100}),/total changed/);
 await rejected(()=>checkout('shipping-owner',lines,{...requestBody(selected),shippingOptionId:undefined}),/selected shipping option/);
 assert.notEqual(quoteFingerprint(selected),quoteFingerprint({...selected,shippingService:'USPS Express'}),'Service is part of quote identity even at equal price');
 const result=await checkout('shipping-owner',lines,{...requestBody(selected),shipping:0,shippingService:'Free overnight',handlingCents:0});
 const saved=JSON.parse(sql.prepare('SELECT data FROM orders WHERE id=?').get(result.id).data);assert.equal(saved.shipping,3500);assert.equal(saved.shippingOption.carrier,'UPS');assert.equal(saved.shippingOption.carrierService,'NextDayAir');assert.equal(saved.shippingOption.handlingCents,1000);assert.equal(saved.shippingOptions,undefined,'Unselected options do not enter historic purchase records');assert.equal(paymentRequests.at(-1).totalCents,14850);
 assert.equal((await checkout('shipping-owner',lines,requestBody(selected))).id,result.id,'Exact pending checkout resumes without another payment');
 await rejected(()=>checkout('shipping-owner',lines,{...requestBody(selected),shippingOptionId:'different_service_same_amount'}),/unresolved checkout/);
 clock=initialCreated+600001;await rejected(()=>issueQuote('shipping-owner',lines,address,undefined,{quoteId:selected.quoteId,shippingOptionId:'rate_ground'}),/expired/);clock=initialCreated;
 // Free eligibility is merchandise after promo and only zeroes Standard, including all its handling.
 for(const [code,percent] of [['bm10',10],['biomod15',15],['bmod20',20],['anna20',20],['kimc15',15]]){const offer=await issueQuote('promo-'+code,lines,address,code);const expedited=await issueQuote('promo-'+code,lines,address,code,{quoteId:offer.quoteId,shippingOptionId:'rate_overnight'});const merchandise=10000-Math.round(10000*percent/100);assert.equal(expedited.shipping,3500);assert.equal(expedited.promo.code,code.toUpperCase());assert.equal(expedited.total,merchandise+3500+Math.round((merchandise+3500)*0.1));}
 seedProduct(20000);let q=await deliveryQuote(lines,address);assert.equal(q.shipping,0);assert.equal(q.shippingOption.free,true);assert.equal(q.shippingOptions.find(o=>o.tier==='overnight').shipping,3500);
 q=await deliveryQuote(lines,address,undefined,'BIOMOD15');assert.equal(q.shipping,900);assert.equal(q.shippingOption.free,false);assert.equal(q.subtotal-q.discount,17000);
 store({shippingOptions:{...defaults,freeStandardEnabled:false,standardHandlingCents:250,overnightHandlingCents:1750}});q=await deliveryQuote(lines,address);assert.equal(q.shipping,1150);assert.equal(q.shippingOptions.find(o=>o.tier==='overnight').shipping,4250);
 store({shippingOptions:{...defaults,standardEnabled:false,expeditedEnabled:false,carriers:['FedEx']}});q=await deliveryQuote(lines,address);assert.equal(q.shippingOption.tier,'overnight');assert.equal(q.shippingOption.carrier,'FedEx');assert.equal(q.shipping,3400);assert.equal(q.shippingOptions.length,1);
 store({shippingOptions:{...defaults,standardEnabled:false,expeditedEnabled:false,overnightEnabled:false}});await assert.rejects(deliveryQuote(lines,address),/No enabled delivery option/);
 store();seedProduct();failRates=true;q=await deliveryQuote(lines,address);assert.equal(q.shipping,700);assert.deepEqual(q.shippingOptions.map(o=>o.tier),['standard']);assert.equal(q.shippingOption.handlingCents,0,'Flat fallback is its final charge, not a live carrier fee');
 store({shippingCents:null});await assert.rejects(deliveryQuote(lines,address),/No enabled delivery option/);seedProduct(20000);q=await deliveryQuote(lines,address);assert.equal(q.shipping,0,'Free Standard remains available without a paid fallback');failRates=false;
 // Paid service is fulfilled exactly even if the current carrier settings changed.
 const overnight=saved.shippingOption;const label=await ep.buyLabel(env,address,[], 'Synthetic label',overnight,shipping.normalizeShippingOptions({carriers:['USPS']}));assert.equal(label.service,'UPS Next Day Air');assert.equal(buyCalls.at(-1),'rate_overnight');assert.equal(label.costCents,2500,'Carrier label cost excludes store handling fee');
 const before=buyCalls.length;available=available.filter(r=>r.id!=='rate_overnight');await assert.rejects(ep.buyLabel(env,address,[],'Synthetic missing',overnight),/paid shipping service is not available/);assert.equal(buyCalls.length,before,'Unavailable paid overnight never purchases cheap ground');
 await ep.buyLabel(env,address,[],'Synthetic historic',{shippingService:'USPS Priority'});assert.equal(buyCalls.at(-1),'rate_priority','Historical carrier service string is honored');
 available=[rate('expressone','USPS','Express','21.00',1)];const express=await ep.carrierShippingOptions(env,address,[],defaults);assert.equal(express[0].tier,'overnight');assert.equal(express[0].shipping,3100);
 const boughtExpress=buyCalls.length;available=[rate('expresstwo','USPS','Express','21.00',2)];await assert.rejects(ep.buyLabel(env,address,[],'Synthetic changed estimate',express[0]),/paid shipping service is not available/);assert.equal(buyCalls.length,boughtExpress,'USPS Express no longer overnight must not fulfill a paid overnight selection');
 const originalFetchFixture=global.fetch;for(const mode of ['test',undefined,'unknown']){global.fetch=async()=>Response.json({id:'shp_fixture',mode,rates:available});await assert.rejects(ep.carrierShippingOptions(env,address,[],defaults),/Live carrier rates are unavailable/);}global.fetch=originalFetchFixture;
 assert.equal(shipping.savedShippingOption({...overnight,shipping:0}),null,'Invalid snapshot arithmetic is refused');assert.equal(shipping.savedShippingOption({...overnight,source:'flat'}),null);assert.equal(shipping.savedShippingOption({...overnight,privateAddress:'must not copy'}).privateAddress,undefined);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM change_context').get().n,0);
 console.log('PASS: shipping config/env precedence, strict USD/carrier/service tiers, overnight fee, free-Standard-only threshold, reusable owner/cart/address/promo-bound expiring quotes, tax/payment totals, immutable selected service, exact label match, history-safe rejection and legacy shipping. No live providers.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Module._load=originalLoad;global.fetch=originalFetch;sql.close();});
