// Real shipping components with isolated hooks/fetch. Never calls live providers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require('typescript'),React=require('react');
let active;const hooks={...React,useState(v){const h=active,i=h.i++;if(!(i in h.s))h.s[i]=v;return[h.s[i],x=>h.s[i]=typeof x==='function'?x(h.s[i]):x];},useRef(v){const h=active,i=h.i++;if(!(i in h.s))h.s[i]={current:v};return h.s[i];}};
function load(file){const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);m.require=id=>{if(id==='react')return hooks;if(id.endsWith('.module.css'))return{};if(id==='sonner')return{toast:{success(){},error(){}}};if(id==='@/lib/catalog')return{money:n=>'$'+(n/100).toFixed(2)};if(id==='@/lib/fulfillment')return{};return require(id);};m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:1,target:9,jsx:4,esModuleInterop:true}}).outputText,name);return m.exports;}
function mount(fn,props={}){const h={s:[],i:0,tree:null,render(){this.i=0;active=this;this.tree=fn(props);return this.tree;}};h.render();return h;}
function nodes(t,out=[]){if(Array.isArray(t))t.forEach(v=>nodes(v,out));else if(t?.props){out.push(t);nodes(t.props.children,out);}return out;}
function text(t){return Array.isArray(t)?t.map(text).join(' '):t?.props?text(t.props.children):typeof t==='string'?t:'';}
const button=(h,name)=>nodes(h.tree).find(n=>n.type==='button'&&text(n)===name);
(async()=>{const {CarrierConnection}=load('components/store/fulfillment-admin.tsx');let resolve,calls=0;
global.fetch=(url,init)=>{calls++;assert.equal(url,'/api/admin/shipping');assert(!init.method||init.method==='GET');return new Promise(r=>resolve=r);};
const h=mount(CarrierConnection);assert(text(h.tree).includes('Not checked in this view'));const click=button(h,'Check EasyPost connection').props.onClick;
const a=click(),b=click();assert.equal(calls,1);h.render();assert(button(h,'Checking…').props.disabled);
resolve(Response.json({configured:true,connected:true,checkedAt:new Date().toISOString(),webhookConfigured:true,webhookRegistered:null}));await Promise.all([a,b]);h.render();assert(text(h.tree).includes('Connected: EasyPost accepted'));assert(text(h.tree).includes('Registration could not be checked'));
global.fetch=async()=>{throw Error('isolated outage');};await button(h,'Check EasyPost connection').props.onClick();h.render();assert(text(h.tree).includes('Connection status is unavailable'));assert(!text(h.tree).includes('Connected: EasyPost accepted'));
for(const copy of ['does not book pickups','does not confirm inbox delivery','charges the connected EasyPost account','Pending payment is not ready to ship'])assert(text(h.tree).includes(copy));
const {ShippingLabel}=load('components/store/shipping-admin.tsx');let writes=0;global.fetch=()=>{writes++;throw Error('Label preview must not call a provider');};
const label=mount(ShippingLabel,{order:{id:'fixture-order',status:'paid',data:{shipment:{tracking:'FIXTURE',labelUrl:'https://example.invalid/label.png',status:'pre_transit'}}},onDone(){}});
assert(!nodes(label.tree).some(n=>n.type==='img'));button(label,'Show label').props.onClick();label.render();assert(nodes(label.tree).some(n=>n.type==='img'&&n.props.referrerPolicy==='no-referrer'));assert.equal(writes,0);
nodes(label.tree).find(n=>n.type==='img').props.onError();label.render();assert(text(label.tree).includes('cannot be previewed'));button(label,'Hide label').props.onClick();label.render();assert(!nodes(label.tree).some(n=>n.type==='img'));assert.equal(writes,0);
console.log('PASS: actual embedded guide, duplicate-click guard, current connection/error states, unknown webhook state, label preview/hide/error without provider writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
