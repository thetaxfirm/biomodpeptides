// Real catalog/price/quote functions; isolated product overrides, no providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const originalLoad = Module._load;
let overrides = [];
Module._load = function(name,parent,isMain) {
 if(name === './runtime' && parent.filename.endsWith('/lib/commerce.ts')) return {runtime:()=>({}),database:()=>({prepare:q=>({all:async()=>({results:q.includes('coa_original_reports')?[]:overrides})})}),all:async()=>overrides,one:async()=>null,setting:async(k,f)=>f,parse:(v,f)=>v?JSON.parse(v):f};
 return originalLoad.call(this,name,parent,isMain);
};
global.fetch=async()=>{throw Error('No network in isolated preorder tests');};
const {products}=require('../lib/catalog.ts');
const {initialRunIds}=require('../lib/preorders.ts');
const {applySale}=require('../lib/sales.ts');
const {fixedPackPrice}=require('../lib/packs.ts');
const {catalog,quote}=require('../lib/commerce.ts');
const affected=products.filter(p=>p.categories.some(c=>['softgels','spray-products'].includes(c.slug)));
assert.equal(affected.length,18);
assert.deepEqual(affected.map(p=>p.id).sort((a,b)=>a-b),[...initialRunIds].sort((a,b)=>a-b));
for(const p of affected){
 const current={...p,price:17900,packPrices:{3:48330,5:76075,10:143200}};
 const discounted=applySale(current);
 assert.equal(discounted.price,15215);
 assert.equal(discounted.activePreorder.ships,'early November 2026');
 assert.equal(fixedPackPrice(discounted,3),41081);
 assert.equal(fixedPackPrice(discounted,5),64664);
 assert.equal(fixedPackPrice(discounted,10),121720);
 assert.deepEqual(applySale(discounted),discounted,'Never apply preorder twice');
 assert.equal(applySale({...discounted,preorder:{...current.preorder,enabled:false}}).price,17900);
 const sale={enabled:true,percentOff:50,starts:'2020-01-01T00:00:00Z',ends:'2099-01-01T00:00:00Z'};
 assert.equal(applySale({...current,sale}).price,15215,'Preorder replaces sale, does not combine it');
 for(const held of [{inStock:false},{purchasable:false},{stockQuantity:0}]) assert.deepEqual(Object.fromEntries(Object.keys(held).map(k=>[k,applySale({...current,...held})[k]])),held);
}
for(const p of products.filter(p=>!initialRunIds.includes(p.id)))assert(!applySale(p).activePreorder,'No vial or supply becomes preorder');
(async()=>{
 const p=affected[0],vial=products.find(p=>p.slug==='bpc-157-10mg');
 overrides=[{id:p.id,data:JSON.stringify({price:17900,stockQuantity:10,packPrices:{3:48330},sale:null})},{id:vial.id,data:JSON.stringify({price:3500,stockQuantity:10})}];
 const ps=await catalog();assert.equal(ps.find(x=>x.id===p.id).price,15215);
 assert.equal((await catalog(false)).find(x=>x.id===p.id).price,17900,'Admin edits undiscounted base');
 for(const [code,percent] of [[' bm10 ',10],['biomod15',15],['bmod20',20],['anna20',20],['kimc15',15]]){
  const q=await quote([{id:p.id,quantity:1}],code);
  assert.equal(q.total,15215-Math.round(15215*percent/100));
  assert.equal(q.items[0].product.activePreorder.percentOff,15);
  assert.equal(q.promo.code,code.trim().toUpperCase());
  assert.equal(q.items.reduce((s,i)=>s+i.lineTotal,0),q.total);
 }
 const mixed=await quote([{id:p.id,quantity:1},{id:vial.id,quantity:1}]);assert.equal(mixed.total,18715);
 assert(mixed.items[0].product.activePreorder);assert(!mixed.items[1].product.activePreorder);
 const pack=await quote([{id:p.id,quantity:3,packId:'preorder-fixed',packKind:'fixed',packSize:3}]);assert.equal(pack.total,41081);
 for(const state of [{stockQuantity:0},{purchasable:false},{inStock:false}]){
  overrides[0].data=JSON.stringify({price:17900,stockQuantity:10,...state});
  await assert.rejects(()=>quote([{id:p.id,quantity:1}]),/available/);
 }
 overrides[0].data=JSON.stringify({price:18000,stockQuantity:10,preorder:{enabled:false,percentOff:15,ships:'early November 2026'}});
 const released=(await catalog()).find(x=>x.id===p.id);assert.equal(released.price,18000);assert(!released.activePreorder);
 assert.equal(products.find(x=>x.id===p.id).preorder.enabled,true,'Runtime edits do not mutate defaults');
 console.log('PASS: 18 preorder products, live override precedence, 15% integer-cent pricing, packs/all codes, no double discount, mixed snapshot, release toggle and stock/hold guards');
})().catch(e=>{console.error(e);process.exitCode=1});
