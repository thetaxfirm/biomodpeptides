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
function mount(props={},Component=Admin){const h={props,slots:[],effectFns:[],cleanups:[],cursor:0,effects:[],dirty:false,writes:0,tree:null,beforeEffects:null,
 render(){for(let n=0;n<30;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=Component(this.props);if(n===0)this.beforeEffects=this.tree;for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}throw Error('render loop');},
 replay(){this.cleanups.forEach(fn=>fn?.());this.effectFns.forEach((fn,i)=>{if(fn)this.cleanups[i]=fn();});this.render();},
 unmount(){this.cleanups.forEach(fn=>fn?.());this.cleanups=[];},};h.render();hosts.push(h);return h;}
function nodes(t,out=[]){if(Array.isArray(t))t.forEach(x=>nodes(x,out));else if(t&&typeof t==='object'&&t.props){out.push(t);nodes(t.props.children,out);}return out;}
function text(t){if(t==null||typeof t==='boolean')return'';if(Array.isArray(t))return t.map(text).join(' ').replace(/\s+/g,' ').trim();if(typeof t!=='object')return String(t);if(t.type===AdminProducts)return (t.props.edited?[t.props.edited]:t.props.products).map(p=>p.name).join(' ');return text(t.props?.children);}
const find=(h,p)=>{const n=nodes(h.tree).find(p);assert(n,'Expected rendered control');return n;};
const button=(h,label)=>find(h,n=>n.type==='button'&&text(n)===label);
const alerts=h=>nodes(h.tree).filter(n=>n.props.role==='alert').map(text).join(' ');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async h=>{for(let i=0;i<16;i++)await Promise.resolve();h?.render();};
const noop=()=>null;
function Field(){}function Check(){}function Choice(){}function Blank(){}function AuthPage(){}function ShippingLabel(){}function Dialog(){}function Tabs(){}function TabsTrigger(){}function TabsContent(){}function CoaAutomation(){}function ChangeHistory(){}function AdminProducts(){}function AdminShippingSettings(){}
const ownerA={id:'fixture-admin-a',name:'Fixture A',email:'a@example.invalid'};
const ownerB={id:'fixture-admin-b',name:'Fixture B',email:'b@example.invalid'};
const fixture=(label='Snapshot A')=>({config:{presalesEnabled:false,rewardsEnabled:false,affiliateEnabled:false,packDiscounts:{},shippingCents:null,freeShippingAt:20000},products:[{id:900001,name:label,price:10000,stockQuantity:1,inStock:true,purchasable:true}],campaigns:[{id:'fixture-campaign',title:'Simulated campaign',active:false,starts:'2099-01-01',ends:'2099-02-01'}],orders:[{id:'fixture-order',status:'pending',total:10000,created:0,data:{items:[]}}],requests:[{id:'fixture-request',kind:'fixture',status:'new',created:0,data:{}}],searchPublishing:{}});
let state,apiImpl,refreshImpl,calls,reports,successes,infos,refreshCalls,allowedMutation;
const provider={useStore:()=>({...state,refresh:()=>{refreshCalls++;return refreshImpl();}}),api:async(action,body)=>{assert(action==='admin'||action===allowedMutation,'Only GET admin and explicitly permitted simulated action are allowed');if(action==='admin')assert.equal(body,undefined,'Read retry never has a mutation payload');calls.push({action,body});return apiImpl(action,body);},report:e=>reports.push(e)};
const inboxFilename=path.join(root,'components/store/request-inbox.tsx'),inboxModule=new Module(inboxFilename,module);
inboxModule.filename=inboxFilename;inboxModule.paths=Module._nodeModulePaths(root);
inboxModule.require=id=>id==='react'?hooks:id==='react/jsx-runtime'?projectRequire(id):id.endsWith('.module.css')?{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})}:(()=>{throw Error('Unexpected inbox dependency '+id);})();
inboxModule._compile(ts.transpileModule(fs.readFileSync(inboxFilename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,inboxFilename);
const {RequestInbox}=inboxModule.exports;
const filename=path.join(root,'components/store/admin.tsx');
const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{
 if(id==='@/lib/fulfillment'){const m={exports:{}};new Function('exports',require('typescript').transpileModule(require('node:fs').readFileSync(require('node:path').join(root,'lib/fulfillment.ts'),'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(m.exports);return m.exports;}
 if(id==='./fulfillment-admin')return {FulfillmentQueue:()=>null,CarrierConnection:()=>null};
 if(id==='react')return hooks;if(id==='react/jsx-runtime')return projectRequire('react/jsx-runtime');if(id==='./provider')return provider;
 if(id==='sonner')return{toast:{success:v=>successes.push(v),info:v=>infos.push(v)}};
 if(id==='@/lib/catalog')return{money:c=>'$'+(c/100).toFixed(2)};if(id==='@/lib/packs')return{supportsPacks:p=>Boolean(p.categories?.some(c=>['research-compounds','spray-products','softgels'].includes(c.slug)))};
 if(id==='./account')return{AuthPage};if(id==='./shipping-admin')return{ShippingLabel};
 if(id==='./coa-automation')return{CoaAutomation};
 if(id==='./change-history')return{ChangeHistory};
 if(id==='./admin-products')return{AdminProducts};
 if(id==='./admin-shipping-settings'){
  const file=path.join(root,'components/store/admin-shipping-settings.tsx'),child=new Module(file,module);child.filename=file;child.paths=Module._nodeModulePaths(root);
  child.require=dep=>dep==='@/lib/shipping-options'?{}:dep.endsWith('.module.css')?{}:mod.require(dep);
  child._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
  return{AdminShippingSettings,shippingSettingsFromForm:child.exports.shippingSettingsFromForm};
 }

 if(id==='./team-admin')return{TeamAdmin:noop};if(id==='@/lib/staff')return require('./staff-module-fixture.cjs').loadStaffModule();
 if(id==='./request-inbox')return{RequestInbox};
 if(id==='./primitives')return{Field,Check,Choice,Blank,formData:form=>form.fields};
 if(id==='@/components/ui/tabs')return{Tabs,TabsTrigger,TabsList:noop,TabsContent};
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
const productPanel=h=>find(h,n=>n.type===AdminProducts);
const editFirst=h=>{const panel=productPanel(h);panel.props.onEdit(panel.props.products[0]);};
const productNames=h=>String(Boolean(productPanel(h).props.edited));
(async()=>{
 // Default and deep-linked sections use the actual Admin and Experience components.
 reset();let h=mount();await flush(h);
 assert.equal(find(h,n=>n.type===Tabs).props.value,'orders');
 assert.deepEqual(nodes(h.tree).filter(n=>n.type===TabsTrigger).slice(0,2).map(n=>[n.props.value,text(n)]),[['orders','Orders'],['promos','Affiliate & promo codes']]);
 for(const initialTab of ['orders','promos','settings','changes','unknown','https://example.invalid/','../orders']){
  reset({store:{admin:false,customer:null}});h=mount({initialTab});
  assert.equal(h.tree.type,AuthPage);assert.equal(h.tree.props.returnTo,'/admin?tab='+(['orders','promos','settings','changes'].includes(initialTab)?initialTab:'orders'));assert.equal(reads(),0);
 }
 const experienceFile=path.join(root,'components/store/experience.tsx');
 const experienceModule=new Module(experienceFile,module);experienceModule.filename=experienceFile;experienceModule.paths=Module._nodeModulePaths(root);
 experienceModule.require=id=>id==='react/jsx-runtime'?projectRequire(id):id==='./admin'?{Admin}:new Proxy({}, {get:()=>noop});
 experienceModule._compile(ts.transpileModule(fs.readFileSync(experienceFile,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,experienceFile);
 const routed=experienceModule.exports.Experience({path:'admin',query:{tab:'promos'}});assert.equal(routed.type,Admin);assert.equal(routed.props.initialTab,'promos');
 reset();h=mount(routed.props);await flush(h);assert.equal(find(h,n=>n.type===Tabs).props.value,'promos');
 h.props={initialTab:'orders'};h.render();assert.equal(find(h,n=>n.type===Tabs).props.value,'orders');
 const changesRoute=experienceModule.exports.Experience({path:'admin',query:{tab:'changes'}});assert.equal(changesRoute.type,Admin);assert.equal(changesRoute.props.initialTab,'changes');
 const permissionModule=require('./staff-module-fixture.cjs').loadStaffModule();
 for(const role of ['owner','manager','support','fulfillment']) {
  reset();apiImpl=async()=>({...fixture(),role,permissions:permissionModule.permissionsFor(role)});h=mount(changesRoute.props);await flush(h);
  const mayRead=role==='owner'||role==='manager';
  assert.equal(find(h,n=>n.type===Tabs).props.value,mayRead?'changes':'orders');
  assert.equal(nodes(h.tree).some(n=>n.type===TabsTrigger&&n.props.value==='changes'),mayRead);
  assert.equal(nodes(h.tree).some(n=>n.type===ChangeHistory),mayRead,'History is never mounted without reports permission');
  assert.equal(nodes(h.tree).some(n=>n.type===AdminProducts),mayRead,'Products editor is never mounted without store write permission');
  assert.equal(nodes(h.tree).some(n=>n.type===AdminShippingSettings),mayRead,'Shipping settings are never mounted without store write permission');
 }
 reset();h=mount({initialTab:'changes'});await flush(h);const priorHistoryKey=find(h,n=>n.type===ChangeHistory).key;
 button(h,'Refresh administration').props.onClick();await flush(h);assert.notEqual(find(h,n=>n.type===ChangeHistory).key,priorHistoryKey,'Global admin refresh remounts the history reader');
 const urls=[];global.window={location:{href:'https://example.invalid/admin?measurement=off'},history:{replaceState:(_state,_title,url)=>urls.push(url)}};
 find(h,n=>n.type===Tabs).props.onValueChange('changes');h.render();assert.equal(urls.at(-1),'/admin?measurement=off&tab=changes');
 find(h,n=>n.type===Tabs).props.onValueChange('orders');h.render();assert.equal(urls.at(-1),'/admin?measurement=off&tab=orders');delete global.window;


 // An open, healthy empty snapshot can read two new orders without a remount or mutation.
 reset();apiImpl=async()=>({...fixture(),orders:[]});h=mount();await flush(h);
 assert(nodes(h.tree).some(n=>n.type===Blank&&n.props.title==='No orders received.'));
 const initialKey=settingsForm(h).key;
 find(h,n=>n.type===Tabs).props.onValueChange('promos');
 productPanel(h).props.onQuery('Snapshot');h.render();
 const updated={...fixture(),orders:['order001-new','order002-new'].map((id,i)=>({id,status:i?'shipped':'paid',total:10000,created:0,data:{items:[]}}))};
 const newRead=deferred();apiImpl=()=>newRead.promise;h.render();assert.equal(reads(),1,'Same-owner rerender alone must not poll');
 const manualRefresh=button(h,'Refresh administration').props.onClick;manualRefresh();manualRefresh();h.render();
 assert.equal(reads(),2);assert(button(h,'Refreshing administration…').props.disabled);assert.equal(settingsForm(h).key,initialKey);
 newRead.resolve(updated);await flush(h);
 assert(text(h.tree).includes('order001'));assert(text(h.tree).includes('order002'));assert(!nodes(h.tree).some(n=>n.type===Blank&&n.props.title==='No orders received.'));
 assert.equal(find(h,n=>n.type===Tabs).props.value,'promos');assert.equal(productPanel(h).props.query,'Snapshot');
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
 editFirst(h);h.render();assert.equal(productNames(h),'true');assert(button(h,'Refresh administration').props.disabled);
 const productForm=productPanel(h);productForm.props.onDraft();h.render();
 productPanel(h).props.onCancel();h.render();assert.equal(productNames(h),'false');assert.equal(button(h,'Refresh administration').props.disabled,false);assert.equal(mutations(),0);

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
 reset();h=mount();await flush(h);allowedMutation='admin-product';editFirst(h);h.render();
 const editor=productPanel(h);
 const productSave=deferred();apiImpl=()=>productSave.promise;
 const oldProductSave=editor.props.onSave({preventDefault(){},currentTarget:{fields:{price:'100',stockQuantity:'1',maxQuantity:'100',salePercent:''}}});h.render();
 productPanel(h).props.onCancel();h.render();editFirst(h);h.render();
 assert.equal(calls.find(c=>c.action==='admin-product').body.expectedStock,1,'Product save uses the loaded stock snapshot');
 assert.equal(calls.find(c=>c.action==='admin-product').body.stockQuantity,1);
 productSave.resolve({message:'Earlier product saved'});await oldProductSave;h.render();
 assert.equal(productNames(h),'true');assert(button(h,'Refresh administration').props.disabled);assert.equal(mutations(),1);assert.equal(reads(),1);assert.match(alerts(h),/protect unsaved edits/);

 // Extracted Products editor retains the original stock snapshot, configured offers
 // and cents/pack transforms. A failed inventory save leaves the draft intact.
 reset();const configured={...fixture().products[0],categories:[{slug:'softgels'}],stockQuantity:37,preorder:{enabled:false,percentOff:15,ships:'early November 2026'},packPrices:{3:25000,5:null,10:80000}};
 apiImpl=async()=>({...fixture(),products:[configured]});h=mount({initialTab:'products'});await flush(h);editFirst(h);h.render();
 productPanel(h).props.onEdit({...productPanel(h).props.edited,availability:'sold_out',inStock:false,purchasable:false,sale:{enabled:true,percentOff:20,starts:'2099-01-01T00:00:00Z',ends:'2099-01-04T00:00:00Z'}});h.render();
 allowedMutation='admin-product';apiImpl=async action=>{if(action==='admin-product')throw Error('Synthetic inventory conflict');return fixture();};
 await productPanel(h).props.onSave({preventDefault(){},currentTarget:{fields:{price:'125.50',fixed3:'',fixed5:'500.75',fixed10:'800',stockQuantity:'35',maxQuantity:'12',preorderPercent:'15',preorderShips:'early November 2026',salePercent:'20',saleStarts:'2099-01-01T00:00:00Z',saleEnds:'2099-01-04T00:00:00Z'}}});h.render();
 const productWrite=calls.find(c=>c.action==='admin-product').body;
 assert.equal(productWrite.expectedStock,37);assert.equal(productWrite.stockQuantity,35);assert.equal(productWrite.availability,'sold_out');assert.equal(productWrite.inStock,false);assert.equal(productWrite.purchasable,false);assert.equal(productWrite.price,12550);assert.equal(productWrite.maxQuantity,12);
 assert.deepEqual(productWrite.packPrices,{3:null,5:50075,10:80000});assert.deepEqual(productWrite.preorder,configured.preorder);assert.deepEqual(productWrite.sale,{enabled:true,percentOff:20,starts:'2099-01-01T00:00:00.000Z',ends:'2099-01-04T00:00:00.000Z'});
 assert.equal(productNames(h),'true');assert(button(h,'Refresh administration').props.disabled);assert.equal(productPanel(h).props.busy,false);assert.equal(reports.length,1);assert.equal(reads(),1,'Failed inventory write does not accept a replacement snapshot');

 // Shipping settings share the existing guarded Settings save and retain all
 // unrelated program/pack fields in the same payload.
 reset();h=mount({initialTab:'settings'});await flush(h);allowedMutation='admin-config';
 settingsForm(h).props.onChangeCapture();h.render();const shippingSettings=find(h,n=>n.type===AdminShippingSettings);assert.equal(shippingSettings.props.busy,false);assert.deepEqual(shippingSettings.props.config,fixture().config);
 apiImpl=async action=>action==='admin-config'?{message:'Synthetic shipping settings saved'}:fixture();
 await settingsForm(h).props.onSubmit({preventDefault(){},currentTarget:{fields:{pack3:'10',pack5:'15',pack10:'20',shipping:'',threshold:'200',shippingSettingsVersion:'1',standardEnabled:'on',expeditedEnabled:'on',overnightEnabled:'on',freeStandardEnabled:'on',standardHandling:'0',expeditedHandling:'2.50',overnightHandling:'10',shippingCarrierUSPS:'on',shippingCarrierUPS:'on'}}});h.render();
 assert.deepEqual(calls.find(c=>c.action==='admin-config').body,{presalesEnabled:false,rewardsEnabled:false,affiliateEnabled:false,packDiscounts:{3:10,5:15,10:20},shippingCents:null,freeShippingAt:20000,shippingOptions:{standardEnabled:true,expeditedEnabled:true,overnightEnabled:true,freeStandardEnabled:true,standardHandlingCents:0,expeditedHandlingCents:250,overnightHandlingCents:1000,carriers:['USPS','UPS']}});
 assert.equal(button(h,'Refresh administration').props.disabled,false);assert.equal(mutations(),1);

 // COA config/send delegates stay under parent draft, single-flight and owner guards.
 reset();h=mount({initialTab:'requests'});await flush(h);
 let coa=find(h,n=>n.type===CoaAutomation);assert.equal(coa.props.busy,false);assert.equal(coa.props.dirty,false);assert.deepEqual(coa.props.requests,fixture().requests,'Outbox uses already-loaded request identities');
 coa.props.onDraft();h.render();assert.equal(find(h,n=>n.type===CoaAutomation).props.dirty,true);
 const beforeCoaReads=reads();await coa.props.onProcess('fixture-request');assert.equal(reads(),beforeCoaReads);assert.equal(mutations(),0);
 allowedMutation='admin-coa-config';apiImpl=async action=>action==='admin-coa-config'?{message:'Fixture config saved'}:fixture();
 await find(h,n=>n.type===CoaAutomation).props.onSave({preventDefault(){},currentTarget:{fields:{enabled:'on',replyTo:'reply@example.invalid',notifyTo:''}}});h.render();
 assert.deepEqual(calls.find(c=>c.action==='admin-coa-config').body,{enabled:true,replyTo:'reply@example.invalid',notifyTo:null});assert.equal(find(h,n=>n.type===CoaAutomation).props.dirty,false);
 allowedMutation='admin-coa-process';const coaProcess=deferred();apiImpl=action=>action==='admin-coa-process'?coaProcess.promise:Promise.resolve(fixture());
 coa=find(h,n=>n.type===CoaAutomation);const sending=coa.props.onProcess('fixture-request');coa.props.onProcess('fixture-request');h.render();
 assert.equal(calls.filter(c=>c.action==='admin-coa-process').length,1);assert.equal(find(h,n=>n.type===CoaAutomation).props.busy,true);
 coaProcess.resolve({message:'Fixture accepted, not delivered'});await sending;h.render();assert.equal(find(h,n=>n.type===CoaAutomation).props.busy,false);
 const staleCoa=find(h,n=>n.type===CoaAutomation).props;state.store.customer=ownerB;apiImpl=async()=>fixture('Owner B');h.render();await flush(h);const callCount=calls.length;
 staleCoa.onDraft();await staleCoa.onProcess('fixture-request');await staleCoa.onSave(event());assert.equal(calls.length,callCount);
 assert.equal(find(h,n=>n.type===CoaAutomation).props.dirty,false);

 // RequestInbox delegates retain the exact snapshot status and parent mutation guards.
 reset();h=mount({initialTab:'requests'});await flush(h);
 let inbox=find(h,n=>n.type===RequestInbox);assert.deepEqual(inbox.props.requests,fixture().requests);assert.equal(inbox.props.busy,false);assert.equal(inbox.props.dirty,false);assert.equal(inbox.props.refreshing,false);
 const initialInbox=inbox.props;settingsForm(h).props.onChangeCapture();h.render();assert.equal(find(h,n=>n.type===RequestInbox).props.dirty,true);
 await initialInbox.onStatus(initialInbox.requests[0],'resolved');await assert.rejects(()=>initialInbox.onPrepareReply({id:'fixture-request',mode:'ai',expectedRevision:null}));assert.equal(mutations(),0);
 button(h,'Discard unsaved edits').props.onClick();h.render();
 const waitingRead=deferred();apiImpl=()=>waitingRead.promise;button(h,'Refresh administration').props.onClick();h.render();inbox=find(h,n=>n.type===RequestInbox);assert.equal(inbox.props.refreshing,true);
 await inbox.props.onStatus(inbox.props.requests[0],'spam');await assert.rejects(()=>inbox.props.onPrepareReply({id:'fixture-request',mode:'ai',expectedRevision:null}));assert.equal(mutations(),0);
 waitingRead.resolve(fixture());await flush(h);
 allowedMutation='admin-request';const requestAction=deferred();apiImpl=action=>action==='admin-request'?requestAction.promise:Promise.resolve(fixture());
 inbox=find(h,n=>n.type===RequestInbox);const captured=inbox.props;const marking=captured.onStatus(captured.requests[0],'in_progress');captured.onStatus(captured.requests[0],'spam');h.render();
 assert.equal(mutations(),1);assert(find(h,n=>n.type===RequestInbox).props.busy);assert.deepEqual(calls.find(c=>c.action==='admin-request').body,{id:'fixture-request',status:'in_progress',expectedStatus:'new'});
 requestAction.resolve({message:'Synthetic request updated'});await marking;h.render();assert.equal(find(h,n=>n.type===RequestInbox).props.busy,false);
 const countAfterStatus=calls.length;await captured.onStatus(captured.requests[0],'resolved');assert.equal(calls.length,countAfterStatus,'A detached pre-refresh callback cannot change a newer request snapshot');
 allowedMutation='admin-request-reply';const inboxSend=deferred();apiImpl=action=>action==='admin-request-reply'?inboxSend.promise:Promise.resolve(fixture());inbox=find(h,n=>n.type===RequestInbox);
 const input={id:'fixture-request',mode:'staff',body:'Synthetic reply.',expectedRevision:null};
 const processing=inbox.props.onPrepareReply(input);await assert.rejects(()=>inbox.props.onPrepareReply(input));h.render();assert.equal(calls.filter(c=>c.action==='admin-request-reply').length,1);assert(find(h,n=>n.type===RequestInbox).props.busy);
 const reply={id:'fixture-request',status:'queued',revision:1};inboxSend.resolve({reply});assert.deepEqual(await processing,reply);h.render();assert(!find(h,n=>n.type===RequestInbox).props.busy);
 const staleInbox=find(h,n=>n.type===RequestInbox).props;state.store.customer=ownerB;apiImpl=async()=>fixture('New inbox owner');h.render();await flush(h);const inboxCount=calls.length;
 await staleInbox.onStatus(staleInbox.requests[0],'resolved');await assert.rejects(()=>staleInbox.onPrepareReply(input));assert.equal(calls.length,inboxCount,'Earlier-owner inbox actions are inert');

 // The actual reply editor remains mounted through tabs, and clears at authorization boundaries.
 reset();const replyFixture=()=>({...fixture(),requests:[{id:'reply-roundtrip',kind:'contact',status:'new',created:0,data:{name:'Synthetic request',email:'reply@example.invalid',subject:'Synthetic question',message:'Synthetic original'}}]});
 apiImpl=async()=>replyFixture();h=mount({initialTab:'requests'});await flush(h);
 let child=null,childKey=null;
 const reconcileInbox=()=>{
  const panel=nodes(h.tree).find(n=>n.type===TabsContent&&n.props.value==='requests');
  const tab=nodes(h.tree).find(n=>n.type===Tabs)?.props.value;
  // Radix mounts selected content; forceMount explicitly retains inactive content.
  const present=panel&&(panel.props.forceMount||tab==='requests');
  if(!present){child?.unmount();child=null;childKey=null;return null;}
  const key=h.tree.key;
  if(child&&childKey!==key){child.unmount();child=null;}
  const item=nodes(panel).find(n=>n.type===RequestInbox);assert(item);
  if(!child){child=mount(item.props,RequestInbox);childKey=key;}else{child.props=item.props;child.render();}
  return panel;
 };
 let panel=reconcileInbox();assert.equal(panel.props.forceMount,true);assert.equal(panel.props.hidden,false);
 button(child,'Prepare reply').props.onClick();child.render();
 const replyField=name=>find(child,n=>n.type==='textarea'&&n.props.name===name);
 replyField('replyBody').props.onChange({target:{value:'Synthetic unsaved reply'}});child.render();
 replyField('replyInstruction').props.onChange({target:{value:'Synthetic unsaved instruction'}});child.render();
 const sameChild=child;
 find(h,n=>n.type===Tabs).props.onValueChange('orders');h.render();panel=reconcileInbox();
 assert.equal(panel.props.hidden,true,'Inactive content stays hidden');assert.equal(child,sameChild,'Tab switch retains the editor instance');
 find(h,n=>n.type===Tabs).props.onValueChange('requests');h.render();panel=reconcileInbox();
 assert.equal(panel.props.hidden,false);assert.equal(replyField('replyBody').props.value,'Synthetic unsaved reply');assert.equal(replyField('replyInstruction').props.value,'Synthetic unsaved instruction');assert.equal(mutations(),0);
 // Changing administrators immediately removes the protected subtree and its local draft.
 state.store.customer=ownerB;h.render();assert.equal(reconcileInbox(),null);await flush(h);reconcileInbox();
 assert.notEqual(child,sameChild);button(child,'Prepare reply').props.onClick();child.render();assert.equal(replyField('replyBody').props.value,'');assert.equal(replyField('replyInstruction').props.value,'');
 // A refreshed role with no requests permission must not retain a hidden inbox.
 apiImpl=async()=>({...replyFixture(),role:'fulfillment',permissions:permissionModule.permissionsFor('fulfillment')});button(h,'Refresh administration').props.onClick();await flush(h);assert.equal(reconcileInbox(),null);
 state.store.customer=null;h.render();assert.equal(h.tree.type,AuthPage);assert.equal(reconcileInbox(),null);

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
  if(action==='request'){const inbox=find(h,n=>n.type===RequestInbox);await inbox.props.onStatus(inbox.props.requests[0],'resolved');}
  if(action==='reconcile')await button(h,'Reconcile payment').props.onClick();
  h.render();assert.equal(mutations(),1);assert.match(alerts(h),/could not refresh/);assert(text(h.tree).includes('Snapshot A'));
  const write=calls.find(c=>c.action===allowedMutation);
  if(action==='campaign')assert.equal(write.body.active,true);
  if(action==='request')assert.deepEqual(write.body,{id:'fixture-request',status:'resolved',expectedStatus:'new'});
  if(action==='reconcile'){assert.deepEqual(write.body,{id:'fixture-order'});assert.deepEqual(infos,['Simulated action confirmed']);}
  apiImpl=async()=>fixture('Inline read recovered');button(h,'Retry administration').props.onClick();await flush(h);
  assert.equal(mutations(),1);assert(text(h.tree).includes('Inline read recovered'));assert.equal(alerts(h),'');
 }

 // Failed mutation is never automatically repeated and does not erase valid data.
 reset();h=mount();await flush(h);allowedMutation='admin-config';apiImpl=async()=>{throw Error('Simulated save rejected');};await settingsForm(h).props.onSubmit(event());h.render();assert.equal(mutations(),1);assert.equal(reads(),1);assert.equal(successes.length,0);assert.equal(reports.length,1);assert(text(h.tree).includes('Snapshot A'));

 // A newer action-triggered snapshot wins over a previously requested read.
 reset();h=mount();await flush(h);const oldRead=deferred();apiImpl=()=>oldRead.promise;shippingDone(h)();h.render();allowedMutation='admin-config';apiImpl=async action=>action==='admin-config'?{}:fixture('Newer snapshot');await settingsForm(h).props.onSubmit(event());h.render();assert(text(h.tree).includes('Newer snapshot'));oldRead.reject(Error('Simulated stale read failure'));await flush(h);assert.equal(alerts(h),'');assert(text(h.tree).includes('Newer snapshot'));

 // Mask old data synchronously, clear editing/search/settings and block old actions, including manual refresh.

 reset();h=mount();await flush(h);editFirst(h);productPanel(h).props.onQuery('Snapshot');h.render();assert.equal(productNames(h),'true');
 const staleRefresh=button(h,'Refresh administration').props.onClick;
 const staleForm=settingsForm(h).props.onSubmit,staleCampaign=button(h,'Enable').props.onClick,staleRequest=find(h,n=>n.type===RequestInbox).props.onStatus,staleShipping=shippingDone(h);
 const oldOwnerRead=deferred();apiImpl=()=>oldOwnerRead.promise;staleShipping();const newerOwnerRead=deferred();apiImpl=()=>newerOwnerRead.promise;state.store.customer=ownerB;h.render();assert(!text(h.beforeEffects).includes('Snapshot A'));assert(!text(h.tree).includes('Snapshot A'));const count=calls.length;
 staleRefresh();await staleForm(event());await staleCampaign();await staleRequest(fixture().requests[0],'resolved');await staleShipping();assert.equal(calls.length,count);
 oldOwnerRead.resolve(fixture('Old owner leaked'));await flush(h);assert(!text(h.tree).includes('Old owner leaked'));newerOwnerRead.resolve(fixture('Snapshot B'));await flush(h);assert(text(h.tree).includes('Snapshot B'));assert.equal(productNames(h),'false');assert.equal(productPanel(h).props.query,'');

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
