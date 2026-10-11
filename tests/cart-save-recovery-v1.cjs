/* Actual StoreProvider, Cart and Checkout cart-save recovery. All HTTP and
 * React effects are isolated fixtures; no live carts, credentials or payments. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const React=require('react');
const root=path.resolve(__dirname,'..');
let active;
const hooks={...React,
 useId(){return 'isolated-promo';},
 useState(initial){const h=active,i=h.cursor++;if(!(i in h.slots))h.slots[i]=typeof initial==='function'?initial():initial;return[h.slots[i],value=>{const next=typeof value==='function'?value(h.slots[i]):value;if(!Object.is(next,h.slots[i])){h.slots[i]=next;h.dirty=true;}}];},
 useRef(initial){const h=active,i=h.cursor++;if(!(i in h.slots))h.slots[i]={current:initial};return h.slots[i];},
 useEffect(fn,deps){const h=active,i=h.cursor++,old=h.slots[i];if(!old||deps.some((v,n)=>!Object.is(old[n],v))){h.slots[i]=deps;h.effectFns[i]=fn;h.effects.push(()=>{h.cleanups[i]?.();h.cleanups[i]=fn();});}},
};
function harness(component){const h={slots:[],effectFns:[],cleanups:[],cursor:0,effects:[],dirty:false,tree:null,
 render(){for(let n=0;n<30;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=component();for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}throw Error('render loop');},
 replay(){this.cleanups.forEach(fn=>fn?.());this.effectFns.forEach((fn,i)=>{if(fn)this.cleanups[i]=fn();});},
 unmount(){this.cleanups.forEach(fn=>fn?.());this.cleanups=[];},};h.render();hosts.push(h);return h;}
let providerHost,hosts=[];
const noop=()=>null;
function Check(){}function Blank(){}function Promo(){}
const cache=new Map();
function load(relative){if(cache.has(relative))return cache.get(relative).exports;const filename=path.join(root,relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);cache.set(relative,mod);
 mod.require=id=>{
  if(id.endsWith('.module.css'))return{__esModule:true,default:{}};
  if(id==='react')return hooks;if(id==='react/jsx-runtime')return require('react/jsx-runtime');
  if(id==='next/navigation')return{usePathname:()=>window.location.pathname,useSearchParams:()=>new URLSearchParams(window.location.search)};
  if(id==='sonner')return{toast:{success:noop,error:noop,info:noop},Toaster:noop};
  if(id==='lucide-react')return new Proxy({}, {get:()=>noop});
  if(relative.startsWith('components/')&&id==='./provider')return{...load('components/store/provider.tsx'),useStore:()=>providerHost.tree.props.value};
  if(id==='./promo-code')return{PromoCode:Promo};if(id==='./product-image')return{ProductImage:noop};if(relative.startsWith('components/')&&id==='./catalog')return{ProductCard:noop};
  if(id==='./primitives')return{Field:noop,Check,Blank,Choice:noop,formData:form=>form.fields};
  if(id.startsWith('@/lib/')||id.startsWith('.')){
   const target=id.startsWith('@/')?id.slice(2):path.relative(root,path.resolve(path.dirname(filename),id));
   if(target.endsWith('.json'))return JSON.parse(fs.readFileSync(path.join(root,target),'utf8'));
   assert(target.startsWith('lib/'),'Unapproved module: '+target);return load(target+'.ts');
  }
  throw Error('Unapproved dependency '+id);
 };
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);return mod.exports;
}
const {products}=load('lib/catalog.ts');
const {eligibleDiscovery}=load('lib/product-discovery.ts');
const p=products.find(p=>p.slug==='bpc-157-10mg');
assert(eligibleDiscovery(p));
const {StoreProvider}=load('components/store/provider.tsx');
const {Cart,Checkout}=load('components/store/account.tsx');
const {PromoCode:ActualPromoCode}=load('components/store/promo-code.tsx');
let state,metrics,apiCalls,frames,observers,frameId,cartError,stateError,metricsError,deliveryImpl,checkoutImpl,redirects,operationOrder,stateImpl,cartImpl;
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const context=()=>providerHost.tree.props.value;
const payloads=()=>metrics.map(r=>JSON.parse(r.options.body));
const count=event=>payloads().filter(p=>p.event===event).length;
const totals=cart=>{const items=cart.map(l=>{const product=products.find(p=>p.id===l.id)||p;return{...l,product,lineTotal:product.price*l.quantity};});const total=items.reduce((s,l)=>s+l.lineTotal,0);return{subtotal:total,discount:0,packDiscount:0,promoDiscount:0,total,items,promo:null};};
function fresh(options={}){
 hosts.forEach(h=>h.unmount());hosts=[];metrics=[];apiCalls=[];frames=new Map();observers=new Set();frameId=0;cartError=null;stateError=null;metricsError=null;redirects=[];operationOrder=[];
 stateImpl=null;cartImpl=null;deliveryImpl=async()=>({quoteId:'isolated-quote',total:p.price+500,shipping:500,tax:0});checkoutImpl=async()=>({url:'/api/store/pay?id=isolated-fixture'});
 const listeners=new Map();
 global.document={visibilityState:'visible',referrer:'https://www.google.com/search?q=not-transmitted',body:{},marker:options.pathname||'/shop',
  querySelector:q=>q==='main[data-traffic-path]'&&document.marker?{getAttribute:()=>document.marker}:null,
  addEventListener:(k,fn)=>{if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener:(k,fn)=>listeners.get(k)?.delete(fn),emit:k=>[...(listeners.get(k)||[])].forEach(fn=>fn())};
 Object.defineProperty(document,'cookie',{get(){throw Error('Cookies forbidden');},set(){throw Error('Cookies forbidden');}});
 global.window={location:{origin:'https://trybiomod.com',pathname:options.pathname||'/shop',search:options.search||''},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)};
 for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw Error('Storage forbidden');}});
 Object.defineProperty(global,'navigator',{value:{globalPrivacyControl:false,doNotTrack:null,webdriver:false},configurable:true});
 global.location={assign:url=>{redirects.push(url);operationOrder.push('assign');}};
 global.MutationObserver=class{constructor(fn){this.fn=fn;}observe(){observers.add(this);}disconnect(){observers.delete(this);}};
 const cart=options.cart||[{id:p.id,quantity:1}];
 state={products,cart,cartConflict:null,cartError:'',wishlist:[],savedPacks:[],campaigns:[],customer:{id:'isolated-owner',name:'Fixture',email:'fixture@example.invalid'},authReady:true,googleReady:false,admin:false,payment:{enabled:true,state:'live'},config:{freeShippingAt:20000},totals:totals(cart),...options.store};
 global.fetch=(url,request={})=>{
  if(url==='/api/metrics'){metrics.push({url,options:request});operationOrder.push(JSON.parse(request.body).event);if(metricsError==='sync')throw Error('Isolated metrics failure');if(metricsError)return Promise.reject(Error('Isolated metrics failure'));return Promise.resolve({ok:true,json:async()=>({})});}
  assert(url.startsWith('/api/store/'),'Live/unapproved fetch blocked: '+url);const action=url.slice('/api/store/'.length);const body=request.body?JSON.parse(request.body):undefined;apiCalls.push({action,body});
  return Promise.resolve().then(async()=>{
   let data;if(action==='auth-refresh')data={};else if(action==='state'){if(stateImpl)return stateImpl();if(stateError)throw stateError;data=structuredClone(state);}
   else if(action==='cart'){if(cartImpl)return cartImpl(body);if(cartError)throw cartError;state.cart=body.cart;state.totals=totals(body.cart);data={cart:structuredClone(body.cart),totals:state.totals};}
   else if(action==='promo')data={};else if(action==='delivery'||action==='checkout')throw Error('Orders, quotes, and payments are forbidden in cart recovery tests');else throw Error('Unapproved action '+action);
   return{ok:true,json:async()=>data};
  });
 };
 providerHost=harness(()=>StoreProvider({children:null,initialCatalog:products,shoppingMeasurementEnabled:options.enabled!==false}));
}
async function loaded(options={}){fresh(options);await flush();providerHost.render();assert.equal(context().ready,true);}
function paint(){const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());}
function mutate(){[...observers].forEach(o=>o.fn());paint();}
function navigate(pathname,search=''){window.location.pathname=pathname;window.location.search=search;document.marker=pathname;}
async function update(changes){Object.assign(state,changes);await context().refresh();providerHost.render();}
function nodes(tree,out=[]){if(Array.isArray(tree)){tree.forEach(x=>nodes(x,out));return out;}if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(Array.isArray(tree))return tree.map(text).join(' ').replace(/\s+/g,' ').trim();if(typeof tree!=='object')return String(tree);return text(tree.props?.children);}
const find=(host,predicate)=>{const node=nodes(host.tree).find(predicate);assert(node,'Expected rendered control');return node;};
const button=(host,label)=>find(host,n=>n.type==='button'&&text(n)===label);
const form=host=>find(host,n=>n.type==='form');

const second=products.find(p=>p.slug==='mots-c-10mg');assert(second&&eligibleDiscovery(second));
const clone=value=>structuredClone(value);
const response=data=>({ok:true,json:async()=>clone(data)});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const writes=()=>apiCalls.filter(r=>r.action==='cart');
const readCount=()=>apiCalls.filter(r=>r.action==='state').length;
const ids=()=>context().store.cart.map(l=>l.id);
const settle=async()=>{await flush();providerHost.render();};
const assertNoFinancialCalls=()=>assert(!apiCalls.some(r=>['delivery','checkout','pay','reconcile','resume-payment'].includes(r.action)));
(async()=>{
 // A confirmed write survives the subsequent failed GET, including its totals.
 await loaded({pathname:'/cart',cart:[]});stateError=Error('Isolated read outage');
 await context().add(p);await settle();
 assert.deepEqual(ids(),[p.id]);assert.equal(context().store.totals.total,p.price);
 assert.equal(context().cartSync,'saved');assert.equal(count('cart_add_confirmed'),1);
 let view=harness(Cart);assert(!nodes(view.tree).some(n=>n.type===Blank&&n.props.title==='Your cart is empty.'));
 assert(text(view.tree).includes('Your cart change was saved.'));assert(button(view,'Retry cart access'));
 stateError=null;await context().add(second);await settle();
 assert.deepEqual(ids(),[p.id,second.id]);assert.deepEqual(writes().map(r=>r.body.cart.map(l=>l.id)),[[p.id],[p.id,second.id]]);
 assert.equal(count('cart_add_confirmed'),1,'Measurement remains suppressed by the prior account-read error until a fresh state succeeds');assert.equal(context().cartSync,'current');assertNoFinancialCalls();
 // Read-only retry never repeats POST, including repeated click while it is pending.
 stateError=Error('Read outage');await context().saveCart([{id:p.id,quantity:2}]);await settle();
 view=harness(Cart);let gate=deferred();stateError=null;stateImpl=()=>gate.promise;
 const beforeWrites=writes().length,beforeReads=readCount(),retry=button(view,'Retry cart access').props.onClick();
 await button(view,'Retry cart access').props.onClick();await flush();assert.equal(readCount(),beforeReads+1);
 gate.resolve(response(state));await retry;await settle();assert.equal(writes().length,beforeWrites);assert.equal(context().cartSync,'current');
 // Even a confirmed empty save preserves its confirmation notice on GET failure.
 stateImpl=null;stateError=Error('Read outage');await context().saveCart([]);await settle();view=harness(Cart);
 assert.deepEqual(ids(),[]);assert(text(view.tree).includes('Your cart change was saved.'));assert(button(view,'Retry cart access'));
 // Lost POST response can follow a committed save. Keep the last confirmed view,
 // block further writes/checkout, and reconcile by GET without POST replay.
 await loaded({pathname:'/cart',cart:[]});cartImpl=async body=>{state.cart=clone(body.cart);state.totals=totals(state.cart);throw Error('Response lost');};
 await assert.rejects(context().add(p),/could not confirm/);await settle();assert.equal(context().cartSync,'uncertain');assert.deepEqual(ids(),[]);
 view=harness(Cart);assert(!nodes(view.tree).some(n=>n.type===Blank));assert(text(view.tree).includes('last cart change could not be confirmed'));
 let checkout=harness(Checkout);assert(text(checkout.tree).includes('Review your saved cart'));assert(!nodes(checkout.tree).some(n=>n.type==='form'));
 await assert.rejects(context().add(second),/retry cart access/);assert.equal(writes().length,1);assert.equal(count('cart_add_confirmed'),0);
 stateError=Error('Read still unavailable');await button(view,'Retry cart access').props.onClick();await settle();assert.equal(context().cartSync,'uncertain');assert.equal(writes().length,1);
 stateError=null;cartImpl=null;view.render();await button(view,'Retry cart access').props.onClick();await settle();
 assert.deepEqual(ids(),[p.id]);assert.equal(context().cartSync,'current');assert.equal(writes().length,1);assert.equal(count('cart_add_confirmed'),0);
 await context().add(second);await settle();assert.deepEqual(ids(),[p.id,second.id]);assert.equal(writes().length,2);assertNoFinancialCalls();
 // Nonempty uncertain carts must not emit a checkout-form view for the recovery
 // screen, and pending writes must not record a settled shopping stage.
 await loaded({pathname:'/cart'});cartError=Error('Rejected');await assert.rejects(context().add(second));await settle();
 navigate('/checkout');checkout=harness(Checkout);paint();assert.equal(count('checkout_form_view'),0);assert(!nodes(checkout.tree).some(n=>n.type==='form'));
 cartError=null;await context().refresh();await settle();checkout.render();paint();assert.equal(count('checkout_form_view'),1);
 await loaded({pathname:'/checkout'});gate=deferred();cartImpl=()=>gate.promise;const writing=context().add(second);await flush();providerHost.render();checkout=harness(Checkout);paint();assert.equal(count('checkout_form_view'),0);assert.equal(button(checkout,'Calculate delivery and tax').props.disabled,true);
 state.cart.push({id:second.id,quantity:1});state.totals=totals(state.cart);cartImpl=null;gate.resolve(response({cart:state.cart,totals:state.totals}));await writing;await settle();checkout.render();paint();assert.equal(count('cart_add_confirmed'),1);assert.equal(count('checkout_form_view'),1);
 // Explicit rejection also stays conservative until a successful authoritative read.
 await loaded();cartImpl=async()=>({ok:false,json:async()=>({error:'Isolated stock rejection'})});
 await assert.rejects(context().saveCart([]),/stock rejection/);await settle();assert.deepEqual(ids(),[p.id]);assert.equal(context().cartSync,'uncertain');
 cartImpl=null;await context().refresh();await settle();assert.deepEqual(ids(),[p.id]);assert.equal(context().cartSync,'current');
 // Every write is serialized. A queued replacement based on old rendered state
 // cannot remove an addition which was already waiting ahead of it.
 await loaded();gate=deferred();cartImpl=()=>gate.promise;const add=context().add(second);await flush();
 const stale=context().saveCart([],clone(context().store.cart));const staleChecked=assert.rejects(stale,/cart changed while/);await flush();assert.equal(writes().length,1);
 state.cart=[{id:p.id,quantity:1},{id:second.id,quantity:1}];state.totals=totals(state.cart);cartImpl=null;gate.resolve(response({cart:state.cart,totals:state.totals}));
 await add;await staleChecked;await settle();assert.deepEqual(ids(),[p.id,second.id]);assert.equal(writes().length,1);
 // Actual stale Cart handler includes the render's expected snapshot, even after
 // the provider adopted a newer cart before the Cart itself rerendered.
 view=harness(Cart);const remove=nodes(view.tree).find(n=>n.type==='button'&&n.props['aria-label']==='Remove '+p.name);assert(remove);
 await context().add(p);await settle();await remove.props.onClick();await settle();assert.equal(writes().length,2);assert.equal(context().store.cart[0].quantity,2);
 // Multiple deliberate additions use the latest confirmed execution-time cart.
 await loaded({cart:[]});const both=[context().add(p),context().add(second)];await Promise.all(both);await settle();assert.deepEqual(ids(),[p.id,second.id]);assert.equal(count('cart_add_confirmed'),2);
 // Reads begun before OR during the POST cannot overwrite its accepted result.
 for(const during of [false,true]){
  await loaded({cart:[]});const old=clone(state),readGate=deferred(),writeGate=deferred();let oldRead,oldReadChecked;
  stateImpl=()=>readGate.promise;
  if(!during){oldRead=context().refresh();oldReadChecked=assert.rejects(oldRead,/newer cart or account/);await flush();}
  cartImpl=()=>writeGate.promise;const save=context().add(p);await flush();
  if(during){oldRead=context().refresh();oldReadChecked=assert.rejects(oldRead,/newer cart or account/);await flush();}
  state.cart=[{id:p.id,quantity:1}];state.totals=totals(state.cart);stateImpl=null;cartImpl=null;
  writeGate.resolve(response({cart:state.cart,totals:state.totals}));await save;await settle();
  readGate.resolve(response(old));await oldReadChecked;await settle();assert.deepEqual(ids(),[p.id]);assert.equal(context().loadError,'');
 }
 // Stale failures do not replace a newer successful state with an error.
 await loaded();gate=deferred();stateImpl=()=>gate.promise;const oldRead=context().refresh(),oldReadChecked=assert.rejects(oldRead,/newer cart or account/);await flush();stateImpl=null;await context().refresh();gate.reject(Error('Stale read'));await oldReadChecked;await settle();assert.equal(context().loadError,'');
 // A superseded read cannot resolve successfully for callers (such as promo
 // recovery) while the newer read fails. Only an accepted read clears recovery.
 await loaded();gate=deferred();stateImpl=()=>gate.promise;const discarded=context().refresh(),discardedChecked=assert.rejects(discarded,/newer cart or account/);await flush();
 stateImpl=null;stateError=Error('Latest read outage');await assert.rejects(context().refresh(),/Latest read outage/);gate.resolve(response(state));await discardedChecked;await settle();assert(context().loadError);
 stateError=null;await context().refresh();await settle();assert.equal(context().loadError,'');
 // Actual PromoCode must stay locked when its post-save refresh is discarded
 // and the superseding read fails; only its successful GET retry unlocks it.
 await loaded();const promoBusy=[];const promo=harness(()=>ActualPromoCode({onBusyChange:value=>promoBusy.push(value)}));
 find(promo,n=>n.type==='input').props.onChange({target:{value:'ISOLATED'}});promo.render();gate=deferred();stateImpl=()=>gate.promise;
 form(promo).props.onSubmit({preventDefault(){}});await flush();stateImpl=null;stateError=Error('Newer read failure');await assert.rejects(context().refresh());gate.resolve(response(state));await settle();promo.render();
 assert.equal(promoBusy.at(-1),true);assert(button(promo,'Reload totals'));assert(!text(promo.tree).includes('Promo code applied.'));
 stateError=null;button(promo,'Reload totals').props.onClick();await settle();promo.render();assert.equal(promoBusy.at(-1),false);assert(text(promo.tree).includes('Order totals updated.'));assert.equal(apiCalls.filter(c=>c.action==='promo').length,1);assert.equal(writes().length,0);
 // Owner tenure protects late responses and queued writes across A -> B -> A,
 // and guest -> member -> guest, not just same-id checks.
 for(const guest of [false,true]){
  await loaded({cart:[],store:{customer:guest?null:{id:'owner-a'}}});const writeGate=deferred();cartImpl=()=>writeGate.promise;
  const activeWrite=context().add(p),activeChecked=assert.rejects(activeWrite,/account changed/);await flush();
  const waiting=context().add(second),waitingChecked=assert.rejects(waiting,/account changed/);
  await update({customer:{id:'owner-b'},cart:[],totals:totals([])});
  await update({customer:guest?null:{id:'owner-a'},cart:[],totals:totals([])});
  cartImpl=null;writeGate.resolve(response({cart:[{id:p.id,quantity:1}],totals:totals([{id:p.id,quantity:1}])}));
  await activeChecked;await waitingChecked;await settle();assert.deepEqual(ids(),[]);assert.equal(writes().length,1);assert.equal(count('cart_add_confirmed'),0);
 }
 // An owner change during the follow-up GET also suppresses the old success.
 await loaded({cart:[]});stateImpl=async()=>response({...state,customer:{id:'owner-b'},cart:[],totals:totals([])});
 await assert.rejects(context().add(p),/account changed/);await settle();assert.deepEqual(ids(),[]);assert.equal(context().store.customer.id,'owner-b');
 // Unmount and effect replay cannot let an old pending write take over new state.
 await loaded({cart:[]});gate=deferred();cartImpl=()=>gate.promise;const obsolete=context().add(p),obsoleteChecked=assert.rejects(obsolete,/account changed/);await flush();providerHost.replay();await flush();
 cartImpl=null;gate.resolve(response({cart:[{id:p.id,quantity:1}],totals:totals([{id:p.id,quantity:1}])}));await obsoleteChecked;await settle();assert.deepEqual(ids(),[]);assert.equal(count('cart_add_confirmed'),0);
 // Completion from the old mount must not invalidate the new mount's read.
 await loaded({cart:[]});const oldWriteGate=deferred(),newReadGate=deferred();cartImpl=()=>oldWriteGate.promise;
 const oldSave=context().add(p),oldSaveChecked=assert.rejects(oldSave,/account changed/);await flush();stateImpl=()=>newReadGate.promise;providerHost.replay();await flush();
 oldWriteGate.resolve(response({cart:[{id:p.id,quantity:1}],totals:totals([{id:p.id,quantity:1}])}));await oldSaveChecked;newReadGate.resolve(response({...state,customer:{id:'fresh-owner'}}));await settle();assert.equal(context().store.customer.id,'fresh-owner');assert.deepEqual(ids(),[]);
 // No writes can run against the not-yet-loaded anonymous default.
 fresh({cart:[]});await assert.rejects(context().add(p),/saved cart to load/);assert.equal(writes().length,0);await settle();
 assertNoFinancialCalls();hosts.forEach(h=>h.unmount());
 console.log('PASS actual cart save recovery: accepted writes, read-only retry, uncertainty, serialization, stale snapshots/reads, owner tenure, and lifecycle; no live calls');
})().catch(e=>{console.error(e);process.exitCode=1;});
