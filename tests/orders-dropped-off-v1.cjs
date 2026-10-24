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
  if(id==='./shipping-admin')return{ShippingLabel:()=>null};
  if(id==='./order-admin')return{OrderDetails:()=>null};
  if(id==='@/lib/payment-check')return{paymentLine:()=>'',paymentAdvice:()=>'',savedPaymentCheck:()=>null};
  if(id==='./fulfillment-admin')return{CarrierConnection:()=>null};
  if(id==='./primitives')return{Field:()=>null};
  if(id==='@/components/ui/sheet')return{Sheet:()=>null,SheetContent:()=>null,SheetTitle:()=>null,SheetDescription:()=>null};
  if(id==='@/lib/catalog')return{money:n=>'$'+(n/100).toFixed(2)};
  if(id==='@/lib/fulfillment')return{fulfillmentLabel:()=>'',carrierWords:{},stalledLabel:()=>false,stuckInTransit:()=>false,awaitingLabelApproval:()=>false};
  if(id==='@/lib/order-queue')return{bucketStatus:{},queueTabs:[]};
  if(id==='@/lib/ship-cutoff')return{shipDue:()=>null}; /* Cutoff tracker has its own suite (ship-cutoff-v1). */
  if(id==='@/lib/request-issues')return load('lib/request-issues.ts');
  if(id==='@/lib/win-back')return load('lib/win-back.ts');
  if(id==='@/lib/order-messages')return load('lib/order-messages.ts');
  return require(id);};
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,jsx:4,esModuleInterop:true}}).outputText,name);return m.exports;}
function mount(fn,props={}){const h={s:[],i:0,tree:null,render(){this.i=0;active=this;this.tree=fn(props);return this.tree;}};h.render();return h;}

const {canMarkDroppedOff,DroppedOff}=load('components/store/orders-admin.tsx');
const may=p=>p==='orders:fulfill',mayNot=()=>false;
const labelled={id:'fixture-label-order',status:'paid',bucket:'label',data:{tracking:'FIXTURE-TRACK',shipment:{labelUrl:'https://example.invalid/l.png'}}};

// Shown only where a bought label is waiting, not yet handed over, and the role may fulfil.
assert.equal(canMarkDroppedOff(labelled,may),true);
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
