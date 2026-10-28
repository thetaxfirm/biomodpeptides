// Queue "Dropped off" handoff: real component, isolated fetch, no provider or network calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require('typescript'),React=require('react');
let active;const hooks={...React,useState(v){const h=active,i=h.i++;if(!(i in h.s))h.s[i]=v;return[h.s[i],x=>h.s[i]=typeof x==='function'?x(h.s[i]):x];},useRef(v){const h=active,i=h.i++;if(!(i in h.s))h.s[i]={current:v};return h.s[i];},useEffect(){}};
let toasts=[];
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);m.require=id=>{
  if(id==='react')return hooks;
  if(id.endsWith('.module.css'))return{};
  if(id==='sonner')return{toast:{success(t){toasts.push(t);},info(t){toasts.push(t);},error(t){toasts.push(t);}}};
  if(id==='./provider')return{api(){throw Error('Test must not call the admin API');},report(){}};
  if(id==='./shipping-admin')return{ShippingLabel:()=>React.createElement('span',{'data-shipping-label-control':true},'Fixture label control')};
  if(id==='./order-admin')return{OrderDetails:()=>null};
  if(id==='@/lib/payment-check')return load('lib/payment-check.ts');
  if(id==='./fulfillment-admin')return{CarrierConnection:()=>null};
  if(id==='./primitives')return{Field:()=>null};
  if(id==='@/components/ui/sheet')return Object.fromEntries(['Sheet','SheetContent','SheetTitle','SheetDescription'].map(name=>[name,({children})=>React.createElement('div',null,children)]));
  if(id==='@/lib/catalog')return{money:n=>'$'+(n/100).toFixed(2)};
  if(id==='@/lib/fulfillment')return load('lib/fulfillment.ts');
  if(id==='@/lib/order-queue')return load('lib/order-queue.ts');
  if(id==='@/lib/ship-cutoff')return load('lib/ship-cutoff.ts'); /* Cutoff tracker has its own suite (ship-cutoff-v1). */
  if(id==='@/lib/request-issues')return load('lib/request-issues.ts');
  if(id==='@/lib/win-back')return load('lib/win-back.ts');
  if(id==='@/lib/order-messages')return load('lib/order-messages.ts');
  if(file.startsWith('lib/') && id.startsWith('./'))return load('lib/'+id.slice(2)+'.ts');
  return require(id);};
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,jsx:4,esModuleInterop:true}}).outputText,name);return m.exports;}
function mount(fn,props={},states=[]){const h={s:states,i:0,tree:null,render(){this.i=0;active=this;this.tree=fn(props);return this.tree;}};h.render();return h;}

const {canMarkDroppedOff,DroppedOff}=load('components/store/orders-admin.tsx');
const may=p=>p==='orders:fulfill',mayNot=()=>false;
const labelled={id:'fixture-label-order',status:'paid',bucket:'label',data:{tracking:'FIXTURE-TRACK',shipment:{labelUrl:'https://example.invalid/l.png'}}};

// Shown only where a bought label is waiting, not yet handed over, and the role may fulfil.
assert.equal(canMarkDroppedOff(labelled,may),true);
assert.equal(canMarkDroppedOff({...labelled,data:{...labelled.data,paymentVerified:{at:1,state:'failed'}}},may),false,'failed payment verification blocks handoff');
assert.equal(canMarkDroppedOff(labelled,mayNot),false,'read-only roles get no shortcut');
assert.equal(canMarkDroppedOff({...labelled,bucket:'to_ship'},may),false,'no label bought yet');
assert.equal(canMarkDroppedOff({...labelled,bucket:'delivered',status:'delivered'},may),false,'already delivered');
assert.equal(canMarkDroppedOff({...labelled,status:'review'},may),false,'payment unresolved');
assert.equal(canMarkDroppedOff({...labelled,data:{...labelled.data,handoff:{at:1,by:'x'}}},may),false,'already dropped off');

// Declining the confirmation writes nothing.
let calls=[];const change=async(action,body,onSaved)=>{calls.push({action,body});onSaved?.({});};
global.window={confirm:()=>false};
let h=mount(DroppedOff,{order:labelled,busy:false,change});
assert.equal(h.tree.props.children,'Dropped off');
h.tree.props.onClick();
assert.deepEqual(calls,[],'a declined confirmation records nothing');
assert.deepEqual(toasts,[]);

// Accepting records the handoff only: no status, no tracking rewrite, and the customer is not told.
let asked='';global.window={confirm:m=>{asked=m;return true;}};
h.tree.props.onClick();
assert.equal(calls.length,1);
assert.deepEqual(calls[0],{action:'order-handoff',body:{orderId:'fixture-label-order'}});
assert(asked.includes('#FIXTURE-'),'confirmation names the order');
assert(asked.includes('not emailed'),'confirmation says the customer is not emailed');
assert(toasts.some(t=>t.includes('dropped off')));

// Busy saves disable the control.
assert.equal(mount(DroppedOff,{order:labelled,busy:true,change}).tree.props.disabled,true);
console.log('PASS: Dropped off shortcut: gated on role, label and no prior handoff; confirm required; records the handoff only, never a status or a customer email.');

// Real Orders component, isolated fixture state: the screen distinguishes money from movement,
// uses five primary work views, and requires opening history before a recovery draft is offered.
const {renderToStaticMarkup}=require('react-dom/server');
const {OrdersAdmin}=load('components/store/orders-admin.tsx');
const queue=load('lib/order-queue.ts');
const fixtureRows=[{id:'fixture-progress-order',status:'paid',created:Date.now(),total:1234,data:{address:{name:'Fixture Customer'},shipment:{status:'pre_transit'},handoff:{at:Date.now()}}}];
const page=queue.queryOrders(fixtureRows,{tab:'all'});
const screen=mount(OrdersAdmin,{reloadToken:0,allowed:may,busy:false,change,submit:()=>{},markDraft:()=>{},reload:()=>{},onWinBack:()=>{}},[{issue:'out_of_stock',note:''},'all','','',page,page.orders,false,'',null]);
const html=renderToStaticMarkup(screen.tree);
for(const words of ['Pack &amp; ship','Payment to confirm','Needs attention','Track parcels','All orders','Payment</th>','Shipment</th>','Paid · recorded','Handed over','awaiting carrier scan','No contact recorded'])assert(html.includes(words),words);
assert(!html.includes('Refunded / cancelled'));
assert(!html.includes('Win back'));
assert(!html.includes('Not contacted'));
assert(html.includes('value="refunded"')&&html.includes('value="cancelled"')&&html.includes('value="delivered"'),'completed records have distinct views');
const nodes=[];function walk(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return;}nodes.push(n);walk(n.props?.children);}walk(screen.tree);
const recordSelect=nodes.find(n=>n.type==='select'&&n.props.value==='');
recordSelect.props.onChange({target:{value:'refunded'}});screen.render();
assert(renderToStaticMarkup(screen.tree).includes('Orders recorded as refunded'),'record selector actually changes the active view');
console.log('PASS: real Orders screen separates payment and shipment, groups work and record views, shows evidence and avoids unsolicited recovery shortcuts.');

// Payment review wins over a postage approval and blocks detail-panel fulfillment controls.
for (const verification of ['failed','settled']) {
  const order={id:'fixture-verification-order',status:'paid',created:Date.now(),total:1234,data:{paymentVerified:{at:Date.now(),state:verification},labelApproval:{cents:2500,limitCents:1000}}};
  const result=queue.queryOrders([order],{tab:'all'});
  const component=mount(OrdersAdmin,{reloadToken:0,allowed:may,busy:false,change,submit:()=>{},markDraft:()=>{},reload:()=>{}},[{issue:'out_of_stock',note:''},'all','','',result,result.orders,false,'',result.orders[0]]);
  const rendered=renderToStaticMarkup(component.tree);
  if (verification==='failed') {
    assert(rendered.includes('Review payment'),'payment review is the row action even when label approval is needed');
    assert(rendered.includes('Fulfillment controls are unavailable'),'detail panel explains the blocked controls');
    assert(!rendered.includes('data-shipping-label-control'),'neither row nor detail panel offers label purchase');
    assert(!rendered.includes('Update fulfillment'),'manual fulfillment is blocked');
    assert(!rendered.includes('Buying it below approves'),'no stale label-purchase instruction remains');
  } else {
    assert(rendered.includes('data-shipping-label-control'),'successful verification restores label controls');
    assert(rendered.includes('Update fulfillment'),'successful verification restores manual fulfillment');
  }
}
console.log('PASS: failed payment verification takes action priority and blocks label, manual fulfillment and handoff controls until resolved.');
