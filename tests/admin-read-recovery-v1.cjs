/* Actual Admin component, isolated hooks and provider fixtures only.
 * Before the fix at d6d3999, an initial GET admin rejection left the page at
 * "Loading store administration…", with no alert/retry and no reread after
 * transport recovery plus same-admin rerenders. A fresh mount succeeded.
 * No network, credentials, real people, order/payment or inventory calls. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const root=process.env.BIOMOD_ADMIN_TEST_ROOT||path.resolve(__dirname,'..');
const projectRequire=Module.createRequire(path.join(root,'package.json'));
const ts=projectRequire('typescript'),React=projectRequire('react');
let active;
const hooks={...React,
 useState(initial){const h=active,i=h.cursor++;if(!(i in h.slots))h.slots[i]=typeof initial==='function'?initial():initial;return[h.slots[i],value=>{const next=typeof value==='function'?value(h.slots[i]):value;if(!Object.is(next,h.slots[i])){h.slots[i]=next;h.dirty=true;h.writes++;}}];},
 useRef(initial){const h=active,i=h.cursor++;if(!(i in h.slots))h.slots[i]={current:initial};return h.slots[i];},
 useEffect(fn,deps){const h=active,i=h.cursor++,old=h.slots[i];if(!old||deps.some((v,n)=>!Object.is(old[n],v))){h.slots[i]=deps;h.effectFns[i]=fn;h.effects.push(()=>{h.cleanups[i]?.();h.cleanups[i]=fn();});}},
};
let hosts=[];
function mount(){const h={slots:[],effectFns:[],cleanups:[],cursor:0,effects:[],dirty:false,writes:0,tree:null,beforeEffects:null,
 render(){for(let n=0;n<30;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=Admin();if(n===0)this.beforeEffects=this.tree;for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}throw Error('render loop');},
 replay(){this.cleanups.forEach(fn=>fn?.());this.effectFns.forEach((fn,i)=>{if(fn)this.cleanups[i]=fn();});this.render();},
 unmount(){this.cleanups.forEach(fn=>fn?.());this.cleanups=[];},};h.render();hosts.push(h);return h;}
function nodes(t,out=[]){if(Array.isArray(t))t.forEach(x=>nodes(x,out));else if(t&&typeof t==='object'&&t.props){out.push(t);nodes(t.props.children,out);}return out;}
function text(t){if(t==null||typeof t==='boolean')return'';if(Array.isArray(t))return t.map(text).join(' ').replace(/\s+/g,' ').trim();if(typeof t!=='object')return String(t);return text(t.props?.children);}
const find=(h,p)=>{const n=nodes(h.tree).find(p);assert(n,'Expected rendered control');return n;};
const button=(h,label)=>find(h,n=>n.type==='button'&&text(n)===label);
const alerts=h=>nodes(h.tree).filter(n=>n.props.role==='alert').map(text).join(' ');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async h=>{for(let i=0;i<16;i++)await Promise.resolve();h?.render();};
const noop=()=>null;
function Field(){}function Check(){}function Choice(){}function Blank(){}function AuthPage(){}function ShippingLabel(){}function Dialog(){}
const ownerA={id:'fixture-admin-a',name:'Fixture A',email:'a@example.invalid'};
const ownerB={id:'fixture-admin-b',name:'Fixture B',email:'b@example.invalid'};
const fixture=(label='Snapshot A')=>({config:{presalesEnabled:false,rewardsEnabled:false,affiliateEnabled:false,packDiscounts:{},shippingCents:null,freeShippingAt:20000},products:[{id:900001,name:label,price:10000,stockQuantity:1,inStock:true,purchasable:true}],campaigns:[{id:'fixture-campaign',title:'Simulated campaign',active:false,starts:'2099-01-01',ends:'2099-02-01'}],orders:[{id:'fixture-order',status:'pending',total:10000,created:0,data:{items:[]}}],requests:[{id:'fixture-request',kind:'fixture',status:'new',created:0,data:{}}],searchPublishing:{}});
let state,apiImpl,refreshImpl,calls,reports,successes,infos,refreshCalls,allowedMutation;
const provider={useStore:()=>({...state,refresh:()=>{refreshCalls++;return refreshImpl();}}),api:async(action,body)=>{assert(action==='admin'||action===allowedMutation,'Only GET admin and explicitly permitted simulated action are allowed');if(action==='admin')assert.equal(body,undefined,'Read retry never has a mutation payload');calls.push({action,body});return apiImpl(action,body);},report:e=>reports.push(e)};
const filename=path.join(root,'components/store/admin.tsx');
const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{
 if(id==='react')return hooks;if(id==='react/jsx-runtime')return projectRequire('react/jsx-runtime');if(id==='./provider')return provider;
 if(id==='sonner')return{toast:{success:v=>successes.push(v),info:v=>infos.push(v)}};
 if(id==='@/lib/catalog')return{money:c=>'$'+(c/100).toFixed(2)};if(id==='@/lib/packs')return{supportsPacks:()=>false};
 if(id==='./account')return{AuthPage};if(id==='./shipping-admin')return{ShippingLabel};
 if(id==='./primitives')return{Field,Check,Choice,Blank,formData:form=>form.fields};
 if(id==='@/components/ui/dialog')return{Dialog,DialogContent:noop,DialogTitle:noop,DialogDescription:noop};
 if(['./traffic-diagnostics','./promo-analytics','./seo-admin','./sales-diagnostics','./order-admin','@/components/ui/tabs','@/components/ui/table'].includes(id))return new Proxy({}, {get:()=>noop});
 throw Error('Unexpected dependency '+id);
};
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {Admin}=mod.exports;
global.fetch=()=>{throw Error('Network forbidden in isolated test');};
function reset(overrides={}){hosts.forEach(h=>h.unmount());hosts=[];state={store:{admin:true,customer:ownerA,payment:{state:'live'}},ready:true,loadError:'',...overrides};calls=[];reports=[];successes=[];infos=[];refreshCalls=0;allowedMutation=null;apiImpl=async()=>fixture();refreshImpl=async()=>{};}
const reads=()=>calls.filter(c=>c.action==='admin').length;
const mutations=()=>calls.filter(c=>c.action!=='admin').length;
const settingsForm=h=>nodes(h.tree).find(n=>n.type==='form');
const event=()=>({preventDefault(){},currentTarget:{fields:{pack3:'',pack5:'',pack10:'',shipping:'',threshold:'200'}}});
const shippingDone=h=>find(h,n=>n.type===ShippingLabel).props.onDone;
const productNames=h=>nodes(h.tree).filter(n=>n.type===Dialog).map(n=>n.props.open).join(',');
(async()=>{
 // Failed reads persist and retry remains a single-flight GET, never a mutation.
 reset();apiImpl=async()=>{throw Error('Simulated admin read outage');};let h=mount();await flush(h);
 assert.match(alerts(h),/Store administration could not load/);assert(!text(h.tree).includes('Loading store administration…'));assert.equal(reads(),1);
 const held=deferred();apiImpl=()=>held.promise;const retry=button(h,'Retry administration').props.onClick;retry();retry();h.render();assert.equal(reads(),2);assert(button(h,'Refreshing administration…').props.disabled);assert.match(alerts(h),/could not load/);
 held.reject(Error('Simulated repeated read outage'));await flush(h);assert.equal(button(h,'Retry administration').props.disabled,false);
 apiImpl=async()=>fixture();button(h,'Retry administration').props.onClick();await flush(h);assert(text(h.tree).includes('Snapshot A'));assert.equal(alerts(h),'');assert.equal(mutations(),0);assert.equal(refreshCalls,0);h.unmount();

 // Provider/readiness failure is recoverable, and unauthorized views never read admin.
 reset({ready:false,loadError:'Simulated access read failure'});h=mount();assert.match(alerts(h),/Administrator access could not load/);assert.equal(reads(),0);
 const access=deferred();refreshImpl=()=>access.promise;const retryAccess=button(h,'Retry administrator access').props.onClick;const attempt=retryAccess();retryAccess();h.render();assert.equal(refreshCalls,1);assert(button(h,'Retrying access…').props.disabled);access.reject(Error('Simulated access outage'));await attempt;h.render();assert.match(alerts(h),/could not load/);
 refreshImpl=async()=>{state.ready=true;state.loadError='';};await button(h,'Retry administrator access').props.onClick();await flush(h);await flush(h);assert(text(h.tree).includes('Snapshot A'));assert.equal(reads(),1);
 for(const store of [{admin:false,customer:null},{admin:false,customer:ownerA}]){reset({store});h=mount();await flush(h);assert.equal(reads(),0);assert.equal(h.tree.type,store.customer?Blank:AuthPage);}

 // Malformed success is a recoverable failure instead of a false empty report/crash.
 reset();apiImpl=async()=>({config:{},products:[]});h=mount();await flush(h);assert.match(alerts(h),/could not load/);assert(!text(h.tree).includes('No orders received'));

 // A saved change followed by failed refresh keeps last data; retry only rereads.
 reset();h=mount();await flush(h);allowedMutation='admin-config';apiImpl=async action=>{if(action==='admin-config')return{message:'Simulated save'};throw Error('Simulated follow-up read outage');};
 await settingsForm(h).props.onSubmit(event());h.render();assert.equal(mutations(),1);assert.equal(refreshCalls,1);assert.deepEqual(successes,['Simulated save']);assert(text(h.tree).includes('Snapshot A'));assert.match(alerts(h),/could not refresh.*last loaded information/);
 const recovery=deferred();apiImpl=()=>recovery.promise;const savedRetry=button(h,'Retry administration').props.onClick;savedRetry();savedRetry();assert.equal(mutations(),1);recovery.resolve(fixture('Snapshot refreshed'));await flush(h);assert(text(h.tree).includes('Snapshot refreshed'));assert.equal(alerts(h),'');assert.equal(mutations(),1);

 // Inline actions preserve their payloads and never replay after a follow-up read failure.
 for(const action of ['campaign','request','reconcile']){
  reset();h=mount();await flush(h);allowedMutation='admin-'+action;
  apiImpl=async method=>{if(method===allowedMutation)return{message:'Simulated action confirmed'};throw Error('Simulated inline refresh failure');};
  if(action==='campaign')await button(h,'Enable').props.onClick();
  if(action==='request')await find(h,n=>n.type===Choice).props.onChange('resolved');
  if(action==='reconcile')await button(h,'Reconcile payment').props.onClick();
  h.render();assert.equal(mutations(),1);assert.match(alerts(h),/could not refresh/);assert(text(h.tree).includes('Snapshot A'));
  const write=calls.find(c=>c.action===allowedMutation);
  if(action==='campaign')assert.equal(write.body.active,true);
  if(action==='request')assert.deepEqual(write.body,{id:'fixture-request',status:'resolved'});
  if(action==='reconcile'){assert.deepEqual(write.body,{id:'fixture-order'});assert.deepEqual(infos,['Simulated action confirmed']);}
  apiImpl=async()=>fixture('Inline read recovered');button(h,'Retry administration').props.onClick();await flush(h);
  assert.equal(mutations(),1);assert(text(h.tree).includes('Inline read recovered'));assert.equal(alerts(h),'');
 }

 // Failed mutation is never automatically repeated and does not erase valid data.
 reset();h=mount();await flush(h);allowedMutation='admin-config';apiImpl=async()=>{throw Error('Simulated save rejected');};await settingsForm(h).props.onSubmit(event());h.render();assert.equal(mutations(),1);assert.equal(reads(),1);assert.equal(successes.length,0);assert.equal(reports.length,1);assert(text(h.tree).includes('Snapshot A'));

 // A newer action-triggered snapshot wins over a previously requested read.
 reset();h=mount();await flush(h);const oldRead=deferred();apiImpl=()=>oldRead.promise;shippingDone(h)();h.render();allowedMutation='admin-config';apiImpl=async action=>action==='admin-config'?{}:fixture('Newer snapshot');await settingsForm(h).props.onSubmit(event());h.render();assert(text(h.tree).includes('Newer snapshot'));oldRead.reject(Error('Simulated stale read failure'));await flush(h);assert.equal(alerts(h),'');assert(text(h.tree).includes('Newer snapshot'));

 // Mask old data synchronously, clear editing/search/settings and block old actions.
 reset();h=mount();await flush(h);button(h,'Edit').props.onClick();find(h,n=>n.type==='input'&&n.props['aria-label']==='Find a product to edit').props.onChange({target:{value:'Snapshot'}});h.render();assert.equal(productNames(h),'true');
 const staleForm=settingsForm(h).props.onSubmit,staleCampaign=button(h,'Enable').props.onClick,staleRequest=find(h,n=>n.type===Choice).props.onChange,staleShipping=shippingDone(h);
 const oldOwnerRead=deferred();apiImpl=()=>oldOwnerRead.promise;staleShipping();const newerOwnerRead=deferred();apiImpl=()=>newerOwnerRead.promise;state.store.customer=ownerB;h.render();assert(!text(h.beforeEffects).includes('Snapshot A'));assert(!text(h.tree).includes('Snapshot A'));const count=calls.length;
 await staleForm(event());await staleCampaign();await staleRequest('resolved');await staleShipping();assert.equal(calls.length,count);
 oldOwnerRead.resolve(fixture('Old owner leaked'));await flush(h);assert(!text(h.tree).includes('Old owner leaked'));newerOwnerRead.resolve(fixture('Snapshot B'));await flush(h);assert(text(h.tree).includes('Snapshot B'));assert.equal(productNames(h),'false');assert.equal(find(h,n=>n.type==='input'&&n.props['aria-label']==='Find a product to edit').props.value,'');

 // A -> B -> A does not revive an older tenure or let its failure overwrite A.
 reset();const a1=deferred(),b=deferred(),a2=deferred();apiImpl=()=>a1.promise;h=mount();apiImpl=()=>b.promise;state.store.customer=ownerB;h.render();apiImpl=()=>a2.promise;state.store.customer=ownerA;h.render();a1.resolve(fixture('Old A'));await flush(h);assert(!text(h.tree).includes('Old A'));a2.resolve(fixture('Current A'));await flush(h);b.reject(Error('Stale B'));await flush(h);assert(text(h.tree).includes('Current A'));assert.equal(alerts(h),'');

 // Sign-out, lost role/readiness, unmount and effect replay discard late responses.
 for(const transition of ['signout','role','readiness']){reset();const pending=deferred();apiImpl=()=>pending.promise;h=mount();if(transition==='signout')state.store.customer=null;else if(transition==='role')state.store.admin=false;else state.ready=false;h.render();pending.resolve(fixture('Stale private snapshot'));await flush(h);assert(!text(h.tree).includes('Stale private snapshot'));assert.equal(reads(),1);}
 for(const reject of [false,true]){reset();const pending=deferred();apiImpl=()=>pending.promise;h=mount();h.unmount();const writes=h.writes;if(reject)pending.reject(Error('Unmounted read'));else pending.resolve(fixture());await flush();assert.equal(h.writes,writes);assert.equal(reports.length,0);}
 reset();const beforeReplay=deferred(),afterReplay=deferred();apiImpl=()=>beforeReplay.promise;h=mount();apiImpl=()=>afterReplay.promise;h.replay();beforeReplay.resolve(fixture('Discarded replay'));await flush(h);assert(!text(h.tree).includes('Discarded replay'));afterReplay.resolve(fixture('Replay current'));await flush(h);assert(text(h.tree).includes('Replay current'));

 // An old owner's completed mutation cannot toast, reload, or clear B's action lock.
 reset();h=mount();await flush(h);allowedMutation='admin-config';const oldAction=deferred();apiImpl=()=>oldAction.promise;const oldSave=settingsForm(h).props.onSubmit(event());
 state.store.customer=ownerB;apiImpl=async()=>fixture('Owner B active');h.render();await flush(h);const newAction=deferred();apiImpl=()=>newAction.promise;const newSave=settingsForm(h).props.onSubmit(event());h.render();assert(button(h,'Save store settings').props.disabled);const before=calls.length;
 oldAction.resolve({message:'Old owner save'});await oldSave;await flush(h);assert.equal(calls.length,before);assert.equal(successes.length,0);assert.equal(refreshCalls,0);assert(button(h,'Save store settings').props.disabled);
 apiImpl=async()=>fixture('Owner B refreshed');newAction.resolve({message:'Current save'});await newSave;h.render();assert.deepEqual(successes,['Current save']);assert.equal(refreshCalls,1);assert.equal(button(h,'Save store settings').props.disabled,false);assert(text(h.tree).includes('Owner B refreshed'));
 hosts.forEach(x=>x.unmount());console.log('Admin read recovery passed: actual component failure/retry, retained data, GET-only recovery, latest read, owner/role/tenure/unmount/replay and stale mutation boundaries. All fixtures isolated; no live I/O.');
})().catch(error=>{console.error(error);process.exitCode=1});
