/* Actual StoreProvider, Cart, Checkout and traffic collector with isolated React-hook
 * rendering and HTTP fixtures. No live requests, storage, orders, or payments. */
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
let providerHost,hosts=[];
const noop=()=>null;
function Check(){}function Blank(){}function Promo(){}
const cache=new Map();
function load(relative){if(cache.has(relative))return cache.get(relative).exports;const filename=path.join(root,relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);cache.set(relative,mod);
 mod.require=id=>{
 if(id==='./affiliate-program')return {AffiliateProgram:()=>null}; /* Affiliate behavior has separate tests. */
 if(id==='@/lib/preorders'||id==='./preorder-notice'){const m={exports:{}};const filename=require('node:path').join(root,id==='@/lib/preorders'?'lib/preorders.ts':'components/store/preorder-notice.tsx');new Function('exports','require',require('typescript').transpileModule(require('node:fs').readFileSync(filename,'utf8'),{compilerOptions:{module:1,target:9,jsx:4}}).outputText)(m.exports,require);return m.exports;}
 if(id==='@/lib/fulfillment'){const m={exports:{}};new Function('exports',require('typescript').transpileModule(require('node:fs').readFileSync(require('node:path').join(root,'lib/fulfillment.ts'),'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(m.exports);return m.exports;}
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
 hosts.forEach(h=>h.unmount());hosts=[];metrics=[];apiCalls=[];frames=new Map();observers=new Set();frameId=0;cartError=null;stateError=null;metricsError=null;redirects=[];operationOrder=[];
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
(async()=>{
 // Actual accepted add boundary, not a generic cart save and not post-refresh.
 await loaded();await context().add(p);providerHost.render();assert.equal(count('cart_add_confirmed'),1);
 await context().add(p);providerHost.render();assert.equal(count('cart_add_confirmed'),2,'Each deliberate accepted addition counts');
 await context().saveCart([{id:p.id,quantity:1}]);providerHost.render();assert.equal(count('cart_add_confirmed'),2,'Quantity edit/removal is not an add');
 await context().reorder([]);providerHost.render();assert.equal(count('cart_add_confirmed'),2,'Empty reorder is not an addition');
 cartError=Error('Cart rejected');await assert.rejects(context().add(p));assert.equal(count('cart_add_confirmed'),2);cartError=null;await context().refresh();providerHost.render();
 stateError=Error('Refresh failed after accepted write');await assert.doesNotReject(context().add(p));assert.equal(count('cart_add_confirmed'),3,'Accepted write counts before read failure');providerHost.render();assert(context().loadError);
 stateError=null;await context().refresh();providerHost.render();
 for(const [label,op] of [['fixed one',()=>context().addFixedPack(p,1)],['mixed one',()=>context().addMixedPack([p.id])],['fixed three',()=>context().addFixedPack(p,3)],['mixed three',()=>context().addMixedPack([p.id,p.id,p.id])],['reorder',()=>context().reorder([{id:p.id,quantity:1}])]]){const before=count('cart_add_confirmed');await op();providerHost.render();assert.equal(count('cart_add_confirmed'),before+1,label+' counts once at common operation boundary');}
 for(const failure of ['async','sync']){metricsError=failure;await assert.doesNotReject(context().add(p));providerHost.render();}await flush();
 assert(metrics.every(r=>r.url==='/api/metrics'&&r.options.method==='POST'&&r.options.credentials==='omit'&&r.options.referrerPolicy==='no-referrer'&&r.options.cache==='no-store'&&r.options.keepalive===true));
 assert(payloads().every(validShoppingEvent),'Only exact stage payloads, never identifiers or totals');

 // Eligibility from current server-provided products, not the initial catalog or identity aliases.
 for(const exclusion of ['disabled','not-ready','load-error','admin','sandbox','not-configured','disabled-payment','conflict','cart-error','held','unknown','presale','empty','gpc','dnt','legacy-dnt','webdriver','preview','http','hidden']){
  await loaded({enabled:exclusion!=='disabled'});let ctx=context();if(exclusion==='not-ready')ctx={...ctx,ready:false};if(exclusion==='load-error')ctx={...ctx,loadError:'Unavailable'};
  if(exclusion==='admin')ctx.store.admin=true;if(exclusion==='sandbox')ctx.store.payment.state='sandbox';if(exclusion==='not-configured')ctx.store.payment.state='not_configured';if(exclusion==='disabled-payment')ctx.store.payment.enabled=false;
  if(exclusion==='conflict')ctx.store.cartConflict={id:'fixture'};if(exclusion==='cart-error')ctx.store.cartError='Review';if(exclusion==='held')ctx.store.cart.push({id:held.id,quantity:1});if(exclusion==='unknown')ctx.store.cart.push({id:-999,quantity:1});if(exclusion==='presale')ctx.store.cart[0].presaleId='fixture';if(exclusion==='empty')ctx.store.cart=[];
  if(exclusion==='gpc')navigator.globalPrivacyControl=true;if(exclusion==='dnt')navigator.doNotTrack='1';if(exclusion==='legacy-dnt')window.doNotTrack='1';if(exclusion==='webdriver')navigator.webdriver=true;if(exclusion==='preview')window.location.origin='https://preview.invalid';if(exclusion==='http')window.location.origin='http://trybiomod.com';if(exclusion==='hidden')document.visibilityState='hidden';
  helpers.measureShoppingStage(exclusion!=='disabled',ctx,'cart_add_confirmed');assert.equal(metrics.length,0,exclusion);
 }
 await loaded();await context().add(held);assert.equal(metrics.length,0,'Actual successful cart with held item is excluded');
 await loaded({store:{payment:{enabled:true,state:'sandbox'}}});await context().add(p);assert.equal(metrics.length,0,'Actual sandbox addition excluded');
 await loaded({store:{products:products.filter(x=>x.id!==p.id)}});await context().add(p);assert.equal(metrics.length,0,'Missing product in current snapshot is not inferred from initial catalog');

 // Real rendered Cart and Checkout effects: one stage per navigation, remount and StrictMode replay.
 await loaded({pathname:'/cart'});let h=harness(Cart);paint();assert.equal(count('cart_view'),1);h.render();h.replay();paint();assert.equal(count('cart_view'),1);h.unmount();h=harness(Cart);paint();assert.equal(count('cart_view'),1);
 navigate('/checkout');h.unmount();h=harness(Checkout);paint();assert.equal(count('checkout_form_view'),1);navigate('/cart');h.unmount();h=harness(Cart);paint();assert.equal(count('cart_view'),2,'Return after another actual route is another view');
 await loaded({pathname:'/checkout',store:{customer:null}});h=harness(Checkout);paint();assert.equal(count('checkout_signin_view'),1);await update({customer:{id:'isolated-owner',name:'Fixture'}});h.render();paint();assert.equal(count('checkout_form_view'),1);h.replay();paint();assert.equal(count('checkout_form_view'),1);
 await loaded({pathname:'/checkout',store:{customer:null,authReady:false}});h=harness(Checkout);paint();assert.equal(metrics.length,0,'Unavailable sign-in form is not a view');
 await loaded({pathname:'/cart'});document.visibilityState='hidden';h=harness(Cart);paint();assert.equal(metrics.length,0);document.visibilityState='visible';document.marker='/old';document.emit('visibilitychange');paint();assert.equal(metrics.length,0);document.marker='/cart';mutate();assert.equal(count('cart_view'),1);
 await loaded({pathname:'/cart'});metricsError='async';h=harness(Cart);paint();await flush();h.replay();mutate();assert.equal(count('cart_view'),1,'View failure is not retried');

 // Shared document opt-out persists in both directions between existing page and new stage collectors.
 await loaded({search:'?measurement=off'});let traffic=harness(()=>TrafficMeasurement({enabled:true,reviewedProductSlugs:[p.slug]}));paint();navigate('/cart');h=harness(Cart);paint();assert.equal(metrics.length,0);h.unmount();h=harness(Cart);paint();assert.equal(metrics.length,0);
 await loaded({pathname:'/cart',search:'?measurement=off'});h=harness(Cart);paint();navigate('/shop');traffic=harness(()=>TrafficMeasurement({enabled:true,reviewedProductSlugs:[p.slug]}));paint();assert.equal(metrics.length,0,'Stage opt-out also excludes later page views');
 await loaded({pathname:'/cart'});h=harness(Cart);window.location.search='?measurement=off';paint();navigate('/checkout');h.unmount();h=harness(Checkout);paint();assert.equal(metrics.length,0,'Late opt-out at dispatch persists');
 await loaded({pathname:'/cart'});h=harness(Cart);paint();assert.equal(count('cart_view'),1,'A fresh document has independent opt-out state');

 // Successful quote is measured only after the real component accepts its current context.
 h=await quoted();assert.equal(count('delivery_quote_confirmed'),1);assert.equal(button(h,'Continue to secure payment').props.disabled,false);
 operationOrder=[];button(h,'Continue to secure payment').props.onClick();await flush();assert.equal(count('checkout_handoff_ready'),1);assert.deepEqual(operationOrder,['checkout_handoff_ready','assign']);assert.equal(redirects.length,1);
 for(const stale of ['address','promo','cart','owner','unmount']){
  await loaded({pathname:'/checkout'});h=harness(Checkout);let resolve;deliveryImpl=()=>new Promise(done=>resolve=done);const pending=submit(h);await flush();
  if(stale==='address')form(h).props.onChange();if(stale==='promo')find(h,n=>n.type===Promo).props.onBusyChange(true);
  if(stale==='cart'){await update({cart:[{id:p.id,quantity:2}],totals:totals([{id:p.id,quantity:2}])});h.render();}
  if(stale==='owner'){await update({customer:{id:'other-isolated-owner',name:'Fixture'}});h.render();}if(stale==='unmount')h.unmount();
  resolve({quoteId:'isolated-quote',total:p.price+500,shipping:500,tax:0});await pending;assert.equal(count('delivery_quote_confirmed'),0,stale+' excludes outdated quote');
 }
 for(const result of ['reject','invalid']){await loaded({pathname:'/checkout'});h=harness(Checkout);deliveryImpl=result==='reject'?async()=>{throw Error('No quote');}:async()=>({quoteId:'',total:NaN,shipping:0,tax:0});await submit(h);assert.equal(count('delivery_quote_confirmed'),0,result);}
 for(const scenario of ['reject','invalid-url','owner','address','unmount','sandbox']){
  h=await quoted();metrics=[];redirects=[];let resolve;
  if(scenario==='reject')checkoutImpl=async()=>{throw Error('Checkout unavailable');};else if(scenario==='invalid-url')checkoutImpl=async()=>({url:'javascript:fixture'});else checkoutImpl=()=>new Promise(done=>resolve=done);
  if(scenario==='sandbox'){await update({payment:{enabled:true,state:'sandbox'}});h.render();}
  button(h,'Continue to secure payment').props.onClick();await flush();
  if(scenario==='owner'){await update({customer:{id:'other-isolated-owner',name:'Fixture'}});h.render();}if(scenario==='address')form(h).props.onChange();if(scenario==='unmount')h.unmount();
  if(resolve){resolve({url:'/api/store/pay?id=isolated-fixture'});await flush();}
  assert.equal(count('checkout_handoff_ready'),0,scenario+' does not count a valid live handoff');
  assert.equal(redirects.length,['reject','owner','unmount'].includes(scenario)?0:1,'Owner changes and unmounts discard stale handoffs; same-owner navigation remains unchanged');
 }
 await loaded({pathname:'/checkout',store:{payment:{enabled:true,state:'sandbox'}}});h=harness(Checkout);paint();await submit(h);assert.equal(metrics.length,0,'Sandbox checkout form and successful delivery quote excluded');
 assert(!helpers.validShoppingHandoff('//gateway.invalid'));assert(!helpers.validShoppingHandoff('https://gateway.invalid:8443'));assert(!helpers.validShoppingHandoff(' https://gateway.invalid'));assert(!helpers.validShoppingHandoff('/account'));assert(!helpers.validShoppingHandoff('http://gateway.invalid'));assert(!helpers.validShoppingHandoff('https://user:password@gateway.invalid'));assert(helpers.validShoppingHandoff('https://gateway.invalid/hosted'));
 hosts.forEach(h=>h.unmount());assert(SHOPPING_STAGES.length===6);
 console.log('PASS: actual StoreProvider/Cart/Checkout accepted additions, pre-refresh success, single-pack delegation, non-add exclusions, eligible live cart gates, visible per-navigation views, StrictMode/remount and shared privacy opt-out, quote staleness, owner/unmount races, valid handoff before navigation, failed/sandbox operations, strict private payload and silent failure. No live network, orders or payments.');
})().catch(e=>{console.error(e);process.exitCode=1;});
