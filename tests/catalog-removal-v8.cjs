/* Verify withdrawn products cannot be published, purchased or reopened from history. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { products } = require('../lib/catalog.ts');
const { currentCart, currentSelection, unavailableOrder, orderView } = require('../lib/catalog-visibility.ts');
const { presentationData } = require('../lib/private-presentation.ts');
const { batchRecords, laboratoryDocuments } = require('../lib/testing.ts');
const removed = [744,745,1389,746,747];
const forbidden = /\bglp(?:[- ]?[123])?\b|retatrutide|tirzepatide|tirzeptatide|cagrilintide|cagrilitide|semaglutide|semiglutide|c-heat|heat-r|heat-t|2381089-83-2|2023788-19-2|1415456-99-3|910463-68-2/i;
assert.equal(products.length,45);
assert.equal(batchRecords.length,45);
assert.equal(laboratoryDocuments.filter(d=>d.is_certificate).length,21);
assert(!forbidden.test(JSON.stringify({products,batchRecords,laboratoryDocuments})));
assert(products.some(p=>p.slug==='semax'));
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
  if(request==='./runtime')return {one:async()=>oldOrder,runtime:()=>({CHASE_ENVIRONMENT:'sandbox'}),parse:(s,d)=>s?JSON.parse(s):d};
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
 console.log('PASS: removed catalog and COAs, remaining Semax, stale carts and complete pack groups, historical projections without ledger edits, and checkout URL reuse guards.');
})().catch(e=>{console.error(e);process.exitCode=1;});
