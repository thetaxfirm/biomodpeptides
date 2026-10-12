// Saved preorder promises across checkout, history, receipts and fulfillment. Synthetic fixtures; no providers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..'),originalLoad=Module._load;
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
Module._load=function(name,parent,...rest){
 if(name==='@/lib/catalog')return require('../lib/catalog.ts');
 if(name==='@/lib/fulfillment')return require('../lib/fulfillment.ts');
 if(parent?.filename.endsWith('/lib/checkout.ts') && ['./runtime','./auth','./commerce','./easypost','./payments','./checkout-tax'].includes(name))return {};
 return originalLoad.call(this,name,parent,...rest);
};
global.fetch=async()=>{throw Error('Network forbidden in preorder tests')};
const {products}=require('../lib/catalog.ts');
const {orderView,adminOrderView}=require('../lib/catalog-visibility.ts');
const {itemDetail,anetOrderDetails,orderEmailHtml}=require('../lib/order-summary.ts');
const {savedPreorder,orderPreorderNotice,orderHasPreorder,fulfillmentLabel,needsFulfillmentAttention}=require('../lib/fulfillment.ts');
const {quoteFingerprint}=require('../lib/checkout.ts');
const preorder={percentOff:15,ships:'early November 2026',basePrice:10000,unexpected:'must not leak'};
const p=products.find(p=>p.categories.some(c=>c.slug==='softgels')),v=products.find(p=>p.categories.some(c=>c.slug==='research-compounds'));
const data={items:[{id:p.id,quantity:1,lineTotal:8500,product:{name:'Synthetic preorder',price:8500,activePreorder:preorder}},{id:v.id,quantity:1,lineTotal:5000,product:{name:'Synthetic available vial',price:5000}}],subtotal:13500,discount:0,shipping:500,tax:0,total:14000,address:{},promo:{code:'BIOMOD15',savings:0}};
const original=JSON.stringify(data);
for(const view of [orderView(data),adminOrderView(data)]){
 assert.deepEqual(view.items[0].product.activePreorder,{percentOff:15,ships:'early November 2026',basePrice:10000});
 assert.equal(view.items[1].product.activePreorder,undefined);
 assert.match(orderPreorderNotice(view),/early November 2026/);
 assert.match(orderPreorderNotice(view),/All items.*ship together/);
 assert.equal(view.total,14000);
}
assert.equal(JSON.stringify(data),original,'Reading the view never reprices or mutates the stored order');
assert.match(itemDetail(data.items[0]),/15% off; estimated dispatch early November 2026/);
assert.match(anetOrderDetails(data).note,/All items.*ship together/);
assert.match(orderEmailHtml('synthetic-order',data),/early November 2026/);
assert.match(orderEmailHtml('synthetic-order',data),/Timing may change/);
assert.match(fulfillmentLabel({status:'paid',data}),/Payment confirmed.*Preorder.*early November 2026/);
assert(needsFulfillmentAttention({status:'paid',data}),'Paid preorder stays visible for team review');
assert.match(fulfillmentLabel({status:'shipped',data:{...data,shipment:{status:'in_transit'}}}),/In transit: confirmed by carrier/,'Real carrier movement outranks preorder estimate');
assert.match(fulfillmentLabel({status:'paid',data:{...data,shipment:{status:'pre_transit'}}}),/Label created/);
const historical={...data,items:data.items.map(i=>({...i,product:{...i.product,activePreorder:undefined}}))};
assert.equal(orderHasPreorder(historical),false);assert.equal(orderPreorderNotice(orderView(historical)),'');
assert.equal(fulfillmentLabel({status:'paid',data:historical}),'Payment confirmed: awaiting packing and dispatch');
assert.doesNotMatch(anetOrderDetails(historical).note,/Preorder/,'Old purchases do not inherit current product preorder terms');
assert.notEqual(quoteFingerprint(data),quoteFingerprint({...data,items:data.items.map((i,n)=>n?i:{...i,product:{...i.product,activePreorder:{...preorder,ships:'December 2026'}}})}),'Changed dispatch promise invalidates checkout quote even if amount is unchanged');
assert.notEqual(quoteFingerprint(data),quoteFingerprint(historical),'Enabling or disabling preorder invalidates the prior quote');
assert.equal(savedPreorder({percentOff:15,ships:'',basePrice:10000}),null);assert.equal(savedPreorder({...preorder,basePrice:-1}),null);
const filename=path.join(root,'components/store/order-admin.tsx'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(root);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:1,target:9,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename);
const html=renderToStaticMarkup(React.createElement(m.exports.OrderDetails,{order:{data:adminOrderView(data),total:data.total}}));
assert.match(html,/15% off included/);assert.match(html,/early November 2026/);assert.match(html,/ship together/);
Module._load=originalLoad;
console.log('PASS: immutable preorder snapshot, mixed-order shipment notice, quote invalidation, saved admin/customer/receipt/email terms, carrier precedence and unchanged historical orders. No network.');
