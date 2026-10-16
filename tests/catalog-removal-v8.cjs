/* Verify HEAT restoration and rejection of unknown products without exposing withheld identities. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { products } = require('../lib/catalog.ts');
const { currentCart, currentSelection, unavailableOrder, orderView } = require('../lib/catalog-visibility.ts');
const { presentationData } = require('../lib/private-presentation.ts');
const { batchRecords, laboratoryDocuments } = require('../lib/testing.ts');
const restored = [744,745,1389,746,747];
const removed = [900001,900002,900003,900004,900005];
const forbidden = /\bglp(?:[- ]?[123])?\b|retatrutide|tirzepatide|tirzeptatide|cagrilintide|cagrilitide|semaglutide|semiglutide|2381089-83-2|2023788-19-2|1415456-99-3|910463-68-2/i;
// Counts are stated as invariants, not as today's totals: the catalog is expected to grow, and a
// suite that fails whenever a product is added teaches everyone to ignore it. What must hold is that
// every product has exactly one batch record and none is orphaned.
assert(products.length > 0);
assert.equal(batchRecords.length, products.length, 'exactly one batch record per product');
assert.equal(batchRecords.filter(r=>!products.some(p=>p.id===r.product_id)).length, 0, 'no batch record outlives its product');
assert.equal(products.filter(p=>!batchRecords.some(r=>r.product_id===p.id)).length, 0, 'no product is missing its batch record');
assert(laboratoryDocuments.filter(d=>d.is_certificate).length >= 21, 'certificates are never lost wholesale');
assert.equal(new Set(products.map(p=>p.id)).size, products.length, 'product ids are unique');
assert.equal(new Set(products.map(p=>p.slug)).size, products.length, 'product slugs are unique');
assert(!forbidden.test(JSON.stringify({products,batchRecords,laboratoryDocuments})));
assert(products.some(p=>p.slug==='semax'));
for (const id of restored) { const p=products.find(p=>p.id===id); assert(p && p.purchasable); assert(currentSelection([id])); const r=batchRecords.find(r=>r.product_id===id); assert(r && !r.document_id && !r.coa_pdf_url && !r.has_certificate_pdf); assert(p.image.filename in require('../lib/vial-branding-v37.json')); }
assert.equal(presentationData('HEAT-R 20mg and C-HEAT-S'),'HEAT-R 20mg and C-HEAT-S');
const allowed = products[0].id;
for(const id of removed){
 assert(!products.some(p=>p.id===id));assert(!currentSelection([allowed,id]));
 assert.deepEqual(currentCart([{id,quantity:1},{id:allowed,quantity:2}]),[{id:allowed,quantity:2}]);
 assert.deepEqual(currentCart([{id,quantity:1,packId:'same-pack',packSize:3},{id:allowed,quantity:2,packId:'same-pack',packSize:3},{id:allowed,quantity:1}]),[{id:allowed,quantity:1}]);
 const ledger={items:[{id,quantity:1,lineTotal:8900,product:{id,name:'Retatrutide',description:'GLP-1',image:{filename:'heat-r-30mg-v1.webp'},price:8900}}],total:8900,fingerprint:'restricted historical payload'};
 const before=JSON.stringify(ledger);const view=orderView(ledger);
 assert(unavailableOrder(ledger));assert(view.catalogUnavailable);assert.equal(view.total,8900);assert.equal(view.items[0].quantity,1);assert.equal(view.items[0].product.name,'Archived product');assert(!forbidden.test(JSON.stringify(view)));assert.equal(JSON.stringify(ledger),before);
}
assert(currentSelection([allowed]));assert(!unavailableOrder({items:[{id:allowed}]}));
const history={name:'GLP2T pack',subject:'retatrutide',message:'tirzeptatide and semiglutide',reason:'CAG and C-HEAT-S',nested:['cagrilitide','HEAT-R 20mg']};
const projected=presentationData(history);assert(!forbidden.test(JSON.stringify(projected)));assert.equal(history.subject,'retatrutide');assert.equal(presentationData('Semax and Selank'),'Semax and Selank');
let oldOrder=null;let adapterCalls=0;
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(parent?.filename.endsWith('/lib/checkout.ts')){
  if(request==='./commerce')return {quote:async lines=>{if(lines.some(l=>removed.includes(l.id)))throw Error('Unavailable product');return {};}};
  // checkout reads product overrides from the database before it validates the order, so the stub
  // answers that one read with an empty table. Any write would be a real failure of this suite,
  // which asserts the order is rejected before anything is persisted or any adapter is touched.
  if(request==='./runtime')return {one:async()=>oldOrder,runtime:()=>({CHASE_ENVIRONMENT:'sandbox'}),parse:(s,d)=>s?JSON.parse(s):d,
   timestamp:()=>1,uid:()=>'00000000-0000-4000-8000-000000000001',run:async()=>{throw Error('No write may happen for an unavailable product');},
   database:()=>({prepare:()=>({bind(){return this;},async all(){return {results:[]};},async first(){return null;},async run(){throw Error('No write may happen for an unavailable product');}}),batch:async()=>{throw Error('No write may happen for an unavailable product');}})};
  if(request==='./chase-payments')return {createChaseAdapter:()=>{adapterCalls++;throw Error('Payment must not be called');}};
  if(request==='./auth')return {customer:async()=>({id:'isolated-owner',email:'test@example.invalid',name:''})};
  if(request==='./easypost')return {easypostReady:()=>false,cheapestRate:async()=>{throw Error('Shipping must not be called');}};
  if(request==='./payments')return {paymentEnvironment:()=>'sandbox',paymentReturnUrl:()=>'',createPaymentAdapter:()=>{adapterCalls++;throw Error('Payment must not be called');}};
 }
 return originalLoad.apply(this,arguments);
};
const {checkout}=require('../lib/checkout.ts');
(async()=>{
 const lines=[{id:allowed,quantity:1}];const address={name:'Isolated test',line1:'123 Test Street',line2:'',city:'Test',state:'NV',zip:'89118',country:'US',phone:'0000000000'};
 const body={accepted:true,requestKey:'00000000-0000-4000-8000-000000000000',address,expectedTotal:100};
 const saved={environment:'sandbox',fingerprint:JSON.stringify({lines,address}),total:100,items:[{id:removed[0]}]};
 oldOrder={id:'test-existing',status:'awaiting_payment',checkout_url:'https://example.invalid/existing-checkout',data:JSON.stringify(saved)};
 await assert.rejects(checkout('isolated-owner',lines,body),/unavailable product/);
 saved.items=[{id:allowed}];oldOrder.data=JSON.stringify(saved);
 assert.deepEqual(await checkout('isolated-owner',lines,body),{id:'test-existing',url:oldOrder.checkout_url});
 await assert.rejects(checkout('isolated-owner',[{id:removed[1],quantity:1}],body),/Unavailable product/);
 assert.equal(adapterCalls,0);
 console.log('PASS: five HEAT products restored without certificates; withheld identities absent; unknown products and stale checkout reuse rejected.');
})().catch(e=>{console.error(e);process.exitCode=1;});
