// Queue "Mark shipped" shortcut: real component, isolated fetch, no provider or network calls.
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
  if(id==='./fulfillment-admin')return{CarrierConnection:()=>null};
  if(id==='./primitives')return{Field:()=>null};
  if(id==='@/components/ui/sheet')return{Sheet:()=>null,SheetContent:()=>null,SheetTitle:()=>null,SheetDescription:()=>null};
  if(id==='@/lib/catalog')return{money:n=>'$'+(n/100).toFixed(2)};
  if(id==='@/lib/fulfillment')return{fulfillmentLabel:()=>''};
  if(id==='@/lib/order-queue')return{bucketStatus:{},queueTabs:[]};
  if(id==='@/lib/request-issues')return load('lib/request-issues.ts');
  if(id==='@/lib/win-back')return load('lib/win-back.ts');
  return require(id);};
  m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,jsx:4,esModuleInterop:true}}).outputText,name);return m.exports;}
function mount(fn,props={}){const h={s:[],i:0,tree:null,render(){this.i=0;active=this;this.tree=fn(props);return this.tree;}};h.render();return h;}

const {canConfirmShipped,MarkShipped}=load('components/store/orders-admin.tsx');
const may=p=>p==='orders:fulfill',mayNot=()=>false;
const labelled={id:'fixture-label-order',status:'paid',bucket:'label',data:{tracking:'FIXTURE-TRACK',shipment:{labelUrl:'https://example.invalid/l.png'}}};

// Shown only where a bought label is waiting and the role may fulfil.
assert.equal(canConfirmShipped(labelled,may),true);
assert.equal(canConfirmShipped(labelled,mayNot),false,'read-only roles get no shortcut');
assert.equal(canConfirmShipped({...labelled,bucket:'to_ship'},may),false,'no label bought yet');
assert.equal(canConfirmShipped({...labelled,bucket:'delivered',status:'delivered'},may),false,'already delivered');
assert.equal(canConfirmShipped({...labelled,status:'review'},may),false,'payment unresolved');

// Declining the confirmation writes nothing.
let calls=[];const change=async(action,body,onSaved)=>{calls.push({action,body});onSaved?.({});};
global.window={confirm:()=>false};
let h=mount(MarkShipped,{order:labelled,busy:false,change});
assert.equal(h.tree.props.children,'Mark shipped');
h.tree.props.onClick();
assert.deepEqual(calls,[],'a declined confirmation must not record fulfilment');
assert.deepEqual(toasts,[]);

// Accepting records a store confirmation and keeps the tracking number from the label.
let asked='';global.window={confirm:m=>{asked=m;return true;}};
h.tree.props.onClick();
assert.equal(calls.length,1);
assert.deepEqual(calls[0],{action:'order',body:{id:'fixture-label-order',status:'shipped',tracking:'FIXTURE-TRACK'}});
assert(asked.includes('#FIXTURE-'),'confirmation names the order');
assert(asked.includes('customer'),'confirmation says the customer is told');
assert(toasts.some(t=>t.includes('marked shipped')));

// An order with no recorded tracking still confirms, with tracking left empty rather than undefined.
calls=[];mount(MarkShipped,{order:{...labelled,data:{shipment:{labelUrl:'x'}}},busy:false,change}).tree.props.onClick();
assert.equal(calls[0].body.tracking,'');

// Busy saves disable the control.
assert.equal(mount(MarkShipped,{order:labelled,busy:true,change}).tree.props.disabled,true);
console.log('PASS: shortcut visibility by bucket/status/role, declined confirmation writes nothing, accepted confirmation keeps tracking, busy disabled.');
