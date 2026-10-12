/* Actual StoreProvider + Checkout owner/lifecycle isolation with React hook
 * rendering and isolated HTTP fixtures. No real accounts, orders or payments. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const React=require('react');
const root=path.resolve(__dirname,'..');
let active;
const hooks={...React,
 useState(initial){const h=active,i=h.cursor++;if(!(i in h.slots))h.slots[i]=typeof initial==='function'?initial():initial;return[h.slots[i],value=>{const next=typeof value==='function'?value(h.slots[i]):value;if(!Object.is(next,h.slots[i])){h.slots[i]=next;h.dirty=true;}}];},
 useRef(initial){const h=active,i=h.cursor++;if(!(i in h.slots))h.slots[i]={current:initial};return h.slots[i];},
 useEffect(fn,deps){const h=active,i=h.cursor++,old=h.slots[i];if(!old||deps.some((v,n)=>!Object.is(old[n],v))){h.slots[i]=deps;h.effectFns[i]=fn;h.effects.push(()=>{h.cleanups[i]?.();h.cleanups[i]=fn();});}},
};
function harness(component){const h={slots:[],effectFns:[],cleanups:[],cursor:0,effects:[],dirty:false,tree:null,
 render(){for(let n=0;n<30;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=component();for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}throw Error('render loop');},
 replay(){this.cleanups.forEach(fn=>fn?.());this.effectFns.forEach((fn,i)=>{if(fn)this.cleanups[i]=fn();});},
 unmount(){this.cleanups.forEach(fn=>fn?.());this.cleanups=[];},};h.render();hosts.push(h);return h;}
let providerHost,hosts=[],errors=[];
const noop=()=>null;
function Check(){}function Blank(){}function Promo(){}
const cache=new Map();
function load(relative){if(cache.has(relative))return cache.get(relative).exports;const filename=path.join(root,relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);cache.set(relative,mod);
 mod.require=id=>{
 if(id==='@/lib/fulfillment'){const m={exports:{}};new Function('exports',require('typescript').transpileModule(require('node:fs').readFileSync(require('node:path').join(root,'lib/fulfillment.ts'),'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(m.exports);return m.exports;}
  if(id==='react')return hooks;if(id==='react/jsx-runtime')return require('react/jsx-runtime');
  if(id==='next/navigation')return{usePathname:()=>window.location.pathname,useSearchParams:()=>new URLSearchParams(window.location.search)};
  if(id==='sonner')return{toast:{success:noop,error:value=>errors.push(value),info:noop},Toaster:noop};
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
const held=products.find(p=>p.slug==='tb500-10mg');
assert(eligibleDiscovery(p));assert(!eligibleDiscovery(held));
const {StoreProvider}=load('components/store/provider.tsx');
const {Cart,Checkout}=load('components/store/account.tsx');
const {TrafficMeasurement}=load('components/store/traffic-measurement.tsx');
const helpers=load('lib/shopping-measurement.ts');
const {SHOPPING_STAGES,validShoppingEvent}=load('lib/shopping-metrics.ts');
let state,metrics,apiCalls,frames,observers,frameId,cartError,stateError,metricsError,deliveryImpl,checkoutImpl,redirects,operationOrder;
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const context=()=>providerHost.tree.props.value;
const payloads=()=>metrics.map(r=>JSON.parse(r.options.body));
const count=event=>payloads().filter(p=>p.event===event).length;
const totals=cart=>{const items=cart.map(l=>({...l,product:products.find(p=>p.id===l.id)||p,lineTotal:p.price*l.quantity}));const total=items.reduce((s,l)=>s+l.lineTotal,0);return{subtotal:total,discount:0,packDiscount:0,promoDiscount:0,total,items,promo:null};};
function fresh(options={}){
 hosts.forEach(h=>h.unmount());hosts=[];errors=[];metrics=[];apiCalls=[];frames=new Map();observers=new Set();frameId=0;cartError=null;stateError=null;metricsError=null;redirects=[];operationOrder=[];
 deliveryImpl=async()=>({quoteId:'isolated-quote',total:p.price+500,shipping:500,tax:0});checkoutImpl=async()=>({url:'/api/store/pay?id=isolated-fixture'});
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
   let data;if(action==='auth-refresh')data={};else if(action==='state'){if(stateError)throw stateError;data=structuredClone(state);}
   else if(action==='cart'){if(cartError)throw cartError;state.cart=body.cart;state.totals=totals(body.cart);data={cart:structuredClone(body.cart),totals:state.totals};}
   else if(action==='delivery')data=await deliveryImpl(body);else if(action==='checkout')data=await checkoutImpl(body);else throw Error('Unapproved action '+action);
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
const fields={name:'Fixture',line1:'1 Example Street',city:'Example',state:'NV',zip:'00000',country:'US',phone:'0000000000'};
const submit=host=>form(host).props.onSubmit({preventDefault(){},currentTarget:{fields}});
async function quoted(){await loaded({pathname:'/checkout'});const h=harness(Checkout);await submit(h);h.render();find(h,n=>n.type===Check).props.onChange(true);h.render();return h;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const checkoutCalls=()=>apiCalls.filter(call=>call.action==='checkout');
const deliveryCalls=()=>apiCalls.filter(call=>call.action==='delivery');
const ownerA={id:'isolated-owner-a',name:'Fixture A',email:'a@example.invalid'};
const ownerB={id:'isolated-owner-b',name:'Fixture B',email:'b@example.invalid'};
async function forOwner(owner=ownerA){await loaded({pathname:'/checkout',store:{customer:owner}});return harness(Checkout);}
async function quoteFor(h){await submit(h);h.render();find(h,n=>n.type===Check).props.onChange(true);h.render();assert.equal(button(h,'Continue to secure payment').props.disabled,false);}
async function changeOwner(h,owner){await update({customer:owner});h.render();}
const calculationButton=h=>find(h,n=>n.type==='button'&&['Calculate delivery and tax','Calculating…'].includes(text(n)));
function blocked(h){assert.equal(button(h,'Continue to secure payment').props.disabled,true);assert.equal(find(h,n=>n.type===Check).props.checked,false);assert(text(h.tree).includes('Pending address'));}
(async()=>{
 // Successful same-owner flow remains explicit, single-flight, and measured.
 let h=await forOwner();await quoteFor(h);assert.equal(count('delivery_quote_confirmed'),1);
 let gate=deferred();checkoutImpl=()=>gate.promise;const pay=button(h,'Continue to secure payment');pay.props.onClick();pay.props.onClick();await flush();assert.equal(checkoutCalls().length,1);h.render();assert.equal(calculationButton(h).props.disabled,true);
 gate.resolve({url:'/api/store/pay?id=same-owner-isolated'});await flush();assert.deepEqual(redirects,['/api/store/pay?id=same-owner-isolated']);assert.equal(count('checkout_handoff_ready'),1);
 // Owner change invalidates accepted quote/address/terms immediately and remounts
 // the actual form boundary (clearing its uncontrolled address fields).
 h=await forOwner();await quoteFor(h);const oldForm=form(h),oldPromo=find(h,n=>n.type===Promo);
 await changeOwner(h,ownerB);blocked(h);assert.notEqual(form(h).key,oldForm.key);assert.notEqual(find(h,n=>n.type===Promo).key,oldPromo.key);
 assert.equal(checkoutCalls().length,0);assert.equal(deliveryCalls().length,1,'No automatic quote replay');
 // A stale rendered control cannot confirm acceptance or submit an old form.
 oldForm.props.onSubmit({preventDefault(){},currentTarget:{fields}});await flush();assert.equal(deliveryCalls().length,1);
 // A -> B -> A is a fresh tenure, not restoration of the previous quote.
 await changeOwner(h,ownerA);blocked(h);assert.notEqual(form(h).key,oldForm.key);
 // Late quote response and finally cannot change or unlock a newer owner's work.
 h=await forOwner();gate=deferred();deliveryImpl=()=>gate.promise;const oldQuote=submit(h);await flush();
 await changeOwner(h,ownerB);const newer=deferred();deliveryImpl=()=>newer.promise;const newQuote=submit(h);await flush();h.render();assert.equal(calculationButton(h).props.disabled,true);
 gate.resolve({quoteId:'old-owner-quote',total:p.price+100,shipping:100,tax:0});await oldQuote;h.render();assert.equal(calculationButton(h).props.disabled,true);assert(text(h.tree).includes('Pending address'));assert.equal(count('delivery_quote_confirmed'),0);
 newer.resolve({quoteId:'new-owner-quote',total:p.price+600,shipping:600,tax:0});await newQuote;h.render();assert.equal(calculationButton(h).props.disabled,false);assert.equal(count('delivery_quote_confirmed'),1);
 find(h,n=>n.type===Check).props.onChange(true);h.render();checkoutImpl=async()=>({url:'/api/store/pay?id=new-owner-order'});button(h,'Continue to secure payment').props.onClick();await flush();assert.equal(checkoutCalls().at(-1).body.quoteId,'new-owner-quote');assert.deepEqual(redirects,['/api/store/pay?id=new-owner-order']);
 // A quote response cannot revive after A -> B -> A, sign-out or unmount.
 for(const transition of ['aba','signed-out','unmount','effect-replay']){
  h=await forOwner();gate=deferred();deliveryImpl=()=>gate.promise;const waiting=submit(h);await flush();
  if(transition==='aba'){await changeOwner(h,ownerB);await changeOwner(h,ownerA);}
  if(transition==='signed-out')await changeOwner(h,null);
  if(transition==='unmount')h.unmount();
  if(transition==='effect-replay'){h.replay();h.render();}
  gate.resolve({quoteId:'obsolete-quote',total:p.price+500,shipping:500,tax:0});await waiting;
  assert.equal(count('delivery_quote_confirmed'),0);assert.equal(checkoutCalls().length,0);
  if(transition==='aba'||transition==='effect-replay'){h.render();blocked(h);}
  if(transition==='signed-out')assert(!nodes(h.tree).some(n=>n.type==='form'));
 }
 // Every new owner tenure gets a new idempotency key and fresh acceptance.
 h=await forOwner();await quoteFor(h);checkoutImpl=async()=>{throw Error('Isolated stopped handoff');};button(h,'Continue to secure payment').props.onClick();await flush();h.render();const firstKey=checkoutCalls()[0].body.requestKey;
 await changeOwner(h,ownerB);blocked(h);await quoteFor(h);button(h,'Continue to secure payment').props.onClick();await flush();h.render();const secondKey=checkoutCalls()[1].body.requestKey;assert.notEqual(secondKey,firstKey);
 await changeOwner(h,ownerA);blocked(h);await quoteFor(h);button(h,'Continue to secure payment').props.onClick();await flush();assert.notEqual(checkoutCalls()[2].body.requestKey,firstKey);
 // Late handoff success never redirects another account, a returned same-id
 // tenure, a signed-out page, an unmounted page, or a replayed mount.
 for(const transition of ['other-owner','aba','signed-out','unmount','effect-replay']){
  h=await forOwner();await quoteFor(h);gate=deferred();checkoutImpl=()=>gate.promise;button(h,'Continue to secure payment').props.onClick();await flush();assert.equal(checkoutCalls().length,1);
  if(transition==='other-owner')await changeOwner(h,ownerB);
  if(transition==='aba'){await changeOwner(h,ownerB);await changeOwner(h,ownerA);}
  if(transition==='signed-out')await changeOwner(h,null);
  if(transition==='unmount')h.unmount();
  if(transition==='effect-replay'){h.replay();h.render();}
  gate.resolve({url:'/api/store/pay?id=obsolete-order'});await flush();assert.equal(redirects.length,0,transition);assert.equal(count('checkout_handoff_ready'),0,transition);assert.equal(checkoutCalls().length,1,'No automatic replay');
  if(['other-owner','aba','effect-replay'].includes(transition)){h.render();blocked(h);}
 }
 // Old failures also cannot display an error or release a new owner's lock.
 h=await forOwner();await quoteFor(h);gate=deferred();checkoutImpl=()=>gate.promise;button(h,'Continue to secure payment').props.onClick();await flush();
 await changeOwner(h,ownerB);await quoteFor(h);const newHandoff=deferred();checkoutImpl=()=>newHandoff.promise;button(h,'Continue to secure payment').props.onClick();await flush();const errorCount=errors.length;
 gate.reject(Error('Obsolete owner failure'));await flush();h.render();assert.equal(errors.length,errorCount);assert.equal(calculationButton(h).props.disabled,true);assert.equal(redirects.length,0);
 newHandoff.resolve({url:'/api/store/pay?id=current-owner-order'});await flush();assert.deepEqual(redirects,['/api/store/pay?id=current-owner-order']);assert.equal(count('checkout_handoff_ready'),1);
 // An earlier owner's late promo callbacks cannot unlock current-owner work.
 h=await forOwner();const earlierPromo=find(h,n=>n.type===Promo);await changeOwner(h,ownerB);find(h,n=>n.type===Promo).props.onBusyChange(true);h.render();earlierPromo.props.onBusyChange(false);h.render();assert.equal(calculationButton(h).props.disabled,true);
 // Existing address/cart invalidation still removes the quote, with no replay.
 h=await forOwner();await quoteFor(h);form(h).props.onChange();h.render();assert.equal(button(h,'Continue to secure payment').props.disabled,true);assert.equal(deliveryCalls().length,1);
 await quoteFor(h);await update({cart:[{id:p.id,quantity:2}],totals:totals([{id:p.id,quantity:2}])});h.render();assert.equal(button(h,'Continue to secure payment').props.disabled,true);assert.equal(checkoutCalls().length,0);
 hosts.forEach(h=>h.unmount());
 console.log('PASS actual Checkout owner/lifecycle isolation: normal single-flight flow; reset quote/address/acceptance/key and form boundaries; owner A-B-A/signout; stale quote/handoff/error/promo callbacks; unmount/replay; preserved cart/address invalidation. Isolated fixtures only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
