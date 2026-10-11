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
function mount(props={}){const h={props,slots:[],effectFns:[],cleanups:[],cursor:0,effects:[],dirty:false,writes:0,tree:null,beforeEffects:null,
 render(){for(let n=0;n<30;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=Admin(this.props);if(n===0)this.beforeEffects=this.tree;for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}throw Error('render loop');},
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
function Field(){}function Check(){}function Choice(){}function Blank(){}function AuthPage(){}function ShippingLabel(){}function Dialog(){}function Tabs(){}function TabsTrigger(){}
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
 if(id==='@/components/ui/tabs')return{Tabs,TabsTrigger,TabsList:noop,TabsContent:noop};
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
 // Default and deep-linked sections use the actual Admin and Experience components.
 reset();let h=mount();await flush(h);
 assert.equal(find(h,n=>n.type===Tabs).props.value,'orders');
 assert.deepEqual(nodes(h.tree).filter(n=>n.type===TabsTrigger).slice(0,2).map(n=>[n.props.value,text(n)]),[['orders','Orders'],['promos','Affiliate & promo codes']]);
 for(const initialTab of ['orders','promos','settings','unknown','https://example.invalid/','../orders']){
  reset({store:{admin:false,customer:null}});h=mount({initialTab});
  assert.equal(h.tree.type,AuthPage);assert.equal(h.tree.props.returnTo,'/admin?tab='+(['orders','promos','settings'].includes(initialTab)?initialTab:'orders'));assert.equal(reads(),0);
 }
 const experienceFile=path.join(root,'components/store/experience.tsx');
 const experienceModule=new Module(experienceFile,module);experienceModule.filename=experienceFile;experienceModule.paths=Module._nodeModulePaths(root);
 experienceModule.require=id=>id==='react/jsx-runtime'?projectRequire(id):id==='./admin'?{Admin}:new Proxy({}, {get:()=>noop});
 experienceModule._compile(ts.transpileModule(fs.readFileSync(experienceFile,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,experienceFile);
 const routed=experienceModule.exports.Experience({path:'admin',query:{tab:'promos'}});assert.equal(routed.type,Admin);assert.equal(routed.props.initialTab,'promos');
 reset();h=mount(routed.props);await flush(h);assert.equal(find(h,n=>n.type===Tabs).props.value,'promos');
 h.props={initialTab:'orders'};h.render();assert.equal(find(h,n=>n.type===Tabs).props.value,'orders');

 // An open, healthy empty snapshot can read two new orders without a remount or mutation.
 reset();apiImpl=async()=>({...fixture(),orders:[]});h=mount();await flush(h);
 assert(nodes(h.tree).some(n=>n.type===Blank&&n.props.title==='No orders received.'));
 const initialKey=settingsForm(h).key;
 find(h,n=>n.type===Tabs).props.onValueChange('promos');
 find(h,n=>n.type==='input'&&n.props['aria-label']==='Find a product to edit').props.onChange({target:{value:'Snapshot'}});h.render();
 const updated={...fixture(),orders:['order001-new','order002-new'].map((id,i)=>({id,status:i?'shipped':'paid',total:10000,created:0,data:{items:[]}}))};
 const newRead=deferred();apiImpl=()=>newRead.promise;h.render();assert.equal(reads(),1,'Same-owner rerender alone must not poll');
 const manualRefresh=button(h,'Refresh administration').props.onClick;manualRefresh();manualRefresh();h.render();
 assert.equal(reads(),2);assert(button(h,'Refreshing administration…').props.disabled);assert.equal(settingsForm(h).key,initialKey);
 newRead.resolve(updated);await flush(h);
 assert(text(h.tree).includes('order001'));assert(text(h.tree).includes('order002'));assert(!nodes(h.tree).some(n=>n.type===Blank&&n.props.title==='No orders received.'));
 assert.equal(find(h,n=>n.type===Tabs).props.value,'promos');assert.equal(find(h,n=>n.type==='input'&&n.props['aria-label']==='Find a product to edit').props.value,'Snapshot');
 assert.notEqual(settingsForm(h).key,initialKey);assert(find(h,n=>n.type==='time').props.dateTime);assert.equal(mutations(),0);assert.equal(refreshCalls,0);
 const acceptedKey=settingsForm(h).key,acceptedTime=find(h,n=>n.type==='time').props.dateTime;
 apiImpl=async()=>{throw Error('Simulated manual read outage');};button(h,'Refresh administration').props.onClick();await flush(h);
 assert.match(alerts(h),/could not refresh/);assert(text(h.tree).includes('order002'));assert.equal(settingsForm(h).key,acceptedKey);assert.equal(find(h,n=>n.type==='time').props.dateTime,acceptedTime);
 assert.equal(mutations(),0);

 // Input changes, controlled settings flags, editor and all admin forms protect drafts.
 reset();apiImpl=async()=>({...fixture(),orders:updated.orders});h=mount();await flush(h);
 const cleanRefresh=button(h,'Refresh administration').props.onClick;
 for(const formTitle of ['Mix-and-match discounts','Create a presale','Reward ledger','Tracking number / carrier']){
  const form=nodes(h.tree).find(n=>n.type==='form'&&(formTitle==='Tracking number / carrier'?nodes(n).some(f=>f.type===Field&&f.props.label===formTitle):text(n).includes(formTitle)));assert(form);
  const key=form.key;form.props.onChangeCapture();h.render();const before=reads();cleanRefresh();button(h,'Refresh administration').props.onClick();
  assert.equal(reads(),before);assert(button(h,'Refresh administration').props.disabled);assert(text(h.tree).includes('Save or discard unsaved edits'));
  find(h,n=>n.type===Tabs).props.onValueChange('products');h.render();assert.equal(find(h,n=>n.type===Tabs).props.value,'orders');
  button(h,'Discard unsaved edits').props.onClick();h.render();assert.equal(button(h,'Refresh administration').props.disabled,false);assert.notEqual(settingsForm(h).key,key);
 }
 find(h,n=>n.type===Check).props.onChange(true);h.render();assert.equal(find(h,n=>n.type===Check).props.checked,true);assert(button(h,'Refresh administration').props.disabled);
 button(h,'Discard unsaved edits').props.onClick();h.render();assert.equal(find(h,n=>n.type===Check).props.checked,false);
 button(h,'Edit').props.onClick();h.render();assert.equal(productNames(h),'true');assert(button(h,'Refresh administration').props.disabled);
 const productForm=nodes(h.tree).find(n=>n.type==='form'&&nodes(n).some(f=>f.type===Field&&f.props.name==='price'));assert(productForm);productForm.props.onChangeCapture();h.render();
 find(h,n=>n.type===Dialog).props.onOpenChange(false);h.render();assert.equal(productNames(h),'false');assert.equal(button(h,'Refresh administration').props.disabled,false);assert.equal(mutations(),0);

 // Starting clean is insufficient: edits during a pending read preserve both
 // uncontrolled field instances and controlled flags, and do not accept that response.
 reset();h=mount({initialTab:'settings'});await flush(h);const draftKey=settingsForm(h).key,draftTime=find(h,n=>n.type==='time').props.dateTime;
 const delayed=deferred();apiImpl=()=>delayed.promise;button(h,'Refresh administration').props.onClick();h.render();
 settingsForm(h).props.onChangeCapture();find(h,n=>n.type===Check).props.onChange(true);h.render();
 delayed.resolve(fixture('Discarded refresh'));await flush(h);
 assert.equal(settingsForm(h).key,draftKey);assert.equal(find(h,n=>n.type===Check).props.checked,true);assert(!text(h.tree).includes('Discarded refresh'));assert.equal(find(h,n=>n.type==='time').props.dateTime,draftTime);
 assert.match(alerts(h),/Refresh paused to protect unsaved edits/);assert(button(h,'Retry administration').props.disabled);
 const dirtyRetry=button(h,'Retry administration').props.onClick;dirtyRetry();assert.equal(reads(),2);
 const staleSubmit=settingsForm(h).props.onSubmit;
 button(h,'Discard unsaved edits').props.onClick();h.render();apiImpl=async()=>fixture('Accepted fresh snapshot');button(h,'Retry administration').props.onClick();await flush(h);
 assert(text(h.tree).includes('Accepted fresh snapshot'));assert.equal(find(h,n=>n.type===Tabs).props.value,'settings');assert.equal(find(h,n=>n.type===Check).props.checked,false);
 await staleSubmit(event());assert.equal(mutations(),0,'Detached pre-refresh forms cannot submit stale values');

 // Saving one form never clears a different draft; edits during a POST remain
 // unsaved. The successful action itself is never replayed by a later GET retry.
 reset();apiImpl=async()=>({...fixture(),orders:updated.orders});h=mount();await flush(h);allowedMutation='admin-order';
 const orderForms=nodes(h.tree).filter(n=>n.type==='form'&&nodes(n).some(f=>f.type===Field&&f.props.name==='tracking'));assert.equal(orderForms.length,2);
 orderForms[0].props.onChangeCapture();orderForms[1].props.onChangeCapture();h.render();apiImpl=async()=>({message:'Simulated fulfillment saved'});
 await orderForms[0].props.onSubmit({preventDefault(){},currentTarget:{fields:{tracking:'fixture tracking',status:'shipped'}}});h.render();
 assert.equal(mutations(),1);assert.equal(reads(),1);assert(button(h,'Refresh administration').props.disabled);assert.match(alerts(h),/protect unsaved edits/);
 button(h,'Discard unsaved edits').props.onClick();h.render();apiImpl=async()=>updated;button(h,'Retry administration').props.onClick();await flush(h);assert.equal(mutations(),1);assert.equal(reads(),2);
 reset();h=mount();await flush(h);allowedMutation='admin-config';settingsForm(h).props.onChangeCapture();h.render();const saving=deferred();apiImpl=()=>saving.promise;
 const save=settingsForm(h).props.onSubmit(event());h.render();assert(button(h,'Refresh administration').props.disabled);button(h,'Refresh administration').props.onClick();assert.equal(reads(),1);
 settingsForm(h).props.onChangeCapture();find(h,n=>n.type===Check).props.onChange(true);h.render();saving.resolve({message:'Earlier settings saved'});await save;h.render();
 assert(button(h,'Refresh administration').props.disabled);assert.equal(find(h,n=>n.type===Check).props.checked,true);assert.equal(reads(),1);assert.equal(mutations(),1);assert.match(alerts(h),/protect unsaved edits/);

 // Closing and reopening an editor during an earlier save creates a different
 // draft even for the same product. Its version must never reuse the old value.
 reset();h=mount();await flush(h);allowedMutation='admin-product';button(h,'Edit').props.onClick();h.render();
 const editor=nodes(h.tree).find(n=>n.type==='form'&&nodes(n).some(f=>f.type===Field&&f.props.name==='price'));
 const productSave=deferred();apiImpl=()=>productSave.promise;
 const oldProductSave=editor.props.onSubmit({preventDefault(){},currentTarget:{fields:{price:'100',stockQuantity:'1',maxQuantity:'100',salePercent:''}}});h.render();
 find(h,n=>n.type===Dialog).props.onOpenChange(false);h.render();button(h,'Edit').props.onClick();h.render();
 productSave.resolve({message:'Earlier product saved'});await oldProductSave;h.render();
 assert.equal(productNames(h),'true');assert(button(h,'Refresh administration').props.disabled);assert.equal(mutations(),1);assert.equal(reads(),1);assert.match(alerts(h),/protect unsaved edits/);

 // Failed reads persist and retry remains a single-flight GET, never a mutation.
 reset();apiImpl=async()=>{throw Error('Simulated admin read outage');};h=mount();await flush(h);
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

 // Mask old data synchronously, clear editing/search/settings and block old actions, including manual refresh.

 reset();h=mount();await flush(h);button(h,'Edit').props.onClick();find(h,n=>n.type==='input'&&n.props['aria-label']==='Find a product to edit').props.onChange({target:{value:'Snapshot'}});h.render();assert.equal(productNames(h),'true');
 const staleRefresh=button(h,'Refresh administration').props.onClick;
 const staleForm=settingsForm(h).props.onSubmit,staleCampaign=button(h,'Enable').props.onClick,staleRequest=find(h,n=>n.type===Choice).props.onChange,staleShipping=shippingDone(h);
 const oldOwnerRead=deferred();apiImpl=()=>oldOwnerRead.promise;staleShipping();const newerOwnerRead=deferred();apiImpl=()=>newerOwnerRead.promise;state.store.customer=ownerB;h.render();assert(!text(h.beforeEffects).includes('Snapshot A'));assert(!text(h.tree).includes('Snapshot A'));const count=calls.length;
 staleRefresh();await staleForm(event());await staleCampaign();await staleRequest('resolved');await staleShipping();assert.equal(calls.length,count);
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
 hosts.forEach(x=>x.unmount());console.log('Admin discovery/read recovery passed: actual routing/default tabs, healthy empty-to-two-order GET refresh, draft protection/read races, independent saves, failure retention, owner/role/tenure/unmount/replay and stale handler boundaries. All fixtures isolated; no live I/O.');
})().catch(error=>{console.error(error);process.exitCode=1});
