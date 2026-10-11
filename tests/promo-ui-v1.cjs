/* Isolated component-state regression harness. Fixtures only; no browser, network, credentials, or real orders. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root,'node_modules/typescript'));
const React = require(path.join(root,'node_modules/react'));
let active;
function hooks() {
  return {
    ...React,
    useState(initial) { const host=active,i=host.cursor++; if (!(i in host.slots)) host.slots[i]=typeof initial==='function'?initial():initial; return [host.slots[i], value=>{ const next=typeof value==='function'?value(host.slots[i]):value;if(!Object.is(next,host.slots[i])) {host.slots[i]=next;host.dirty=true;} }]; },
    useRef(initial) { const host=active,i=host.cursor++;if(!(i in host.slots))host.slots[i]={current:initial};return host.slots[i]; },
    useId() { const host=active,i=host.cursor++;if(!(i in host.slots))host.slots[i]='test-id-'+i;return host.slots[i]; },
    useEffect(fn,deps) { const host=active,i=host.cursor++;const previous=host.slots[i];if(!previous||deps.some((v,n)=>!Object.is(previous[n],v))){host.slots[i]=deps;host.effects.push(fn);} },
  };
}
function harness(component,props={}) {
 const host={slots:[],cursor:0,effects:[],dirty:false,tree:null,render(){for(let n=0;n<20;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=component(props);for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}throw Error('render loop');}};
 host.render();return host;
}
function nodes(tree,out=[]) {if(Array.isArray(tree)){tree.forEach(x=>nodes(x,out));return out;}if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
function text(tree) {if(tree==null||typeof tree==='boolean')return '';if(Array.isArray(tree))return tree.map(text).join(' ').replace(/\s+/g, ' ').replace(/−\s+\$/g, '−$').replace(/\s+([.,])/g, '$1').trim();if(typeof tree!=='object')return String(tree);return text(tree.props?.children);}
const find=(host,pred)=>{const result=nodes(host.tree).find(pred);assert(result,'node not found');return result;};
const button=(host,label)=>find(host,n=>n.type==='button'&&text(n)===label);
const noop=()=>null;
function PromoStub(){}
let store, apiCalls=[], apiImpl=async()=>({}), refreshImpl=async()=>{}, busyEvents=[], reports=[];
const provider={useStore:()=>({store,ready:true,refresh:()=>refreshImpl(),saveCart:async()=>{}}),api:async(action,body)=>{apiCalls.push({action,body});return apiImpl(action,body);},report:e=>reports.push(e)};
function load(file) {
 const filename=path.join(root,file);const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
 mod.require=id=>{
  if(id==='react')return hooks();if(id==='react/jsx-runtime')return require(path.join(root,'node_modules/react/jsx-runtime'));
  if(id==='./provider')return provider;if(id.endsWith('.module.css'))return new Proxy({}, {get:(_,key)=>key});
  if(id==='@/lib/catalog')return {money:c=>'$'+(c/100).toFixed(2),compound:p=>p.name};
  if(id==='./promo-code')return {PromoCode:PromoStub};if(id==='./product-image')return {ProductImage:noop};
  if(id==='@/lib/auth-return')return {authLink:()=>'',safeAuthReturn:x=>x};
  if(id==='lucide-react')return new Proxy({}, {get:()=>noop});if(id==='sonner')return {toast:{success:()=>{},info:()=>{}}};
  if(id==='./catalog')return {ProductCard:noop};if(id==='./primitives')return {Field:noop,Check:noop,Blank:noop,Choice:noop,formData:x=>x.fields};
  throw Error('Unexpected require '+id);
 };
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);return mod.exports;
}
const {PromoCode}=load('components/store/promo-code.tsx');const {Cart,Checkout}=load('components/store/account.tsx');
const product={id:1,name:'Fixture',slug:'fixture',sizes:['10mg'],price:10000};
const makeStore=()=>({totals:{subtotal:30000,packDiscount:3000,promoDiscount:2700,discount:5700,total:24300,promo:{code:'BM10',percentOff:10,savings:2700},items:[{product,quantity:3,lineTotal:27000}]},cart:[{id:1,quantity:3}],products:[product],config:{freeShippingAt:20000},payment:{enabled:true,state:'live'},customer:{name:'Fixture'},cartConflict:null,cartError:''});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 store=makeStore();let cart=harness(Cart);assert(text(cart.tree).includes('Pack savings −$30.00'));assert(text(cart.tree).includes('Promo savings −$27.00'));assert(text(cart.tree).includes('Items total $243.00'));assert(!text(cart.tree).includes('Pack savings −$57.00'));
 store={...makeStore(),totals:{...makeStore().totals,promo:null,promoDiscount:0,discount:3000,total:27000}};
 let p=harness(PromoCode,{onBusyChange:x=>busyEvents.push(x)});
 assert.equal(find(p,n=>n.type==='details').props.open,undefined);
 assert(!text(p.tree).includes('BM10'));assert(!text(p.tree).includes('BIOMOD15'));assert(!text(p.tree).includes('BMOD20'));
 let pending;apiImpl=()=>new Promise(resolve=>pending=resolve);refreshImpl=async()=>{store=makeStore();};
 find(p,n=>n.type==='input').props.onChange({target:{value:'BM10'}});p.render();find(p,n=>n.type==='form').props.onSubmit({preventDefault(){}});p.render();
 assert.equal(button(p,'Updating…').props.disabled,true);assert.equal(busyEvents.at(-1),true);
 pending({});await tick();p.render();assert.deepEqual(apiCalls.at(-1),{action:'promo',body:{code:'BM10'}});assert(text(p.tree).includes('BM10 applied. You save $27.00.'));assert.equal(busyEvents.at(-1),false);
 apiImpl=async()=>({});refreshImpl=async()=>{throw Error('network');};button(p,'Remove').props.onClick();await tick();p.render();assert.equal(apiCalls.at(-1).body.code,'');assert(text(p.tree).includes('updated totals could not load'));assert.equal(busyEvents.at(-1),true);assert.equal(button(p,'Remove').props.disabled,true);
 refreshImpl=async()=>{store={...store,totals:{...store.totals,promo:null,promoDiscount:0,total:27000}};};button(p,'Reload totals').props.onClick();await tick();p.render();assert.equal(busyEvents.at(-1),false);assert(!text(p.tree).includes('BM10 applied'));
 apiImpl=async()=>{throw Error('Promo code not recognized.');};find(p,n=>n.type==='input').props.onChange({target:{value:'wrong'}});p.render();find(p,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();p.render();assert.equal(find(p,n=>n.props.role==='alert').props.children,'Promo code not recognized.');assert.equal(busyEvents.at(-1),false);
 // An uncertain failed POST must retain the lock until authoritative totals return.
 refreshImpl=async()=>{throw Error('offline');};apiImpl=async()=>{throw Error('lost response');};
 find(p,n=>n.type==='input').props.onChange({target:{value:'BIOMOD15'}});p.render();find(p,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();p.render();assert(text(p.tree).includes('could not be confirmed'));assert.equal(busyEvents.at(-1),true);assert.equal(button(p,'Apply').props.disabled,true);
 refreshImpl=async()=>{store=makeStore();};button(p,'Reload totals').props.onClick();await tick();p.render();assert.equal(busyEvents.at(-1),false);
 store=makeStore();apiCalls=[];let checkout=harness(Checkout);let deliveryResolve;apiImpl=(action)=>action==='delivery'?new Promise(resolve=>deliveryResolve=resolve):Promise.resolve({url:'https://example.invalid'});
 let form=find(checkout,n=>n.type==='form');const deliveryPromise=form.props.onSubmit({preventDefault(){},currentTarget:{fields:{state:'CA'}}});checkout.render();
 find(checkout,n=>n.type===PromoStub).props.onBusyChange(true);checkout.render();deliveryResolve({shipping:0,tax:0,total:24300,quoteId:'old'});await deliveryPromise;checkout.render();assert(text(checkout.tree).includes('Pending address'));assert.equal(button(checkout,'Continue to secure payment').props.disabled,true);
 find(checkout,n=>n.type===PromoStub).props.onBusyChange(false);checkout.render();apiImpl=async()=>({shipping:0,tax:0,total:24300,quoteId:'fresh'});await find(checkout,n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:{fields:{state:'CA'}}});checkout.render();assert(!text(checkout.tree).includes('Pending address'));
 store={...store,totals:{...store.totals,promo:{...store.totals.promo,code:'DIFFERENT-SAME-TOTAL'}}};checkout.render();assert(text(checkout.tree).includes('Pending address'));assert.equal(button(checkout,'Continue to secure payment').props.disabled,true);
 assert.equal(apiCalls.filter(c=>c.action==='checkout').length,0);
 // Real child input events must synchronously protect captured parent handlers,
 // before either child/parent rerenders or passive effects run.
 global.fetch=()=>{throw Error('Live network forbidden');};
 const redirects=[];global.location={assign:url=>redirects.push(url)};
 const noPromo=()=>({...makeStore(),customer:{id:'owner-a',name:'Fixture'},totals:{...makeStore().totals,promo:null,promoDiscount:0,discount:3000,total:27000}});
 const child=parent=>harness(()=>PromoCode(find(parent,n=>n.type===PromoStub).props));
 const input=host=>find(host,n=>n.type==='input');
 const proceed=host=>find(host,n=>n.type==='a'&&text(n)==='Proceed to checkout');
 const type=(host,value)=>input(host).props.onChange({target:{value}});
 const address=host=>find(host,n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:{fields:{state:'CA'}}});
 const accept=host=>find(host,n=>n.props.checked===false&&text(n).startsWith('I am 21')).props.onChange(true);
 const settle=(parent,child)=>{child.render();parent.render();child.render();parent.render();};
 store=noPromo();apiCalls=[];apiImpl=async()=>({});refreshImpl=async()=>{};
 cart=harness(Cart);p=child(cart);const oldProceed=proceed(cart);let prevented=false;
 type(p,'BIOMOD15');oldProceed.props.onClick({preventDefault(){prevented=true;}});
 assert(prevented,'captured Cart click is guarded before a render');assert.equal(apiCalls.length,0);
 settle(cart,p);assert.equal(proceed(cart).props.href,undefined);assert.equal(proceed(cart).props['aria-disabled'],true);
 assert.equal(button(p,'Apply').props.disabled,false,'draft guard cannot disable its own Apply');
 assert(text(p.tree).includes('Apply your code or clear it before continuing.'));
 button(p,'Clear input').props.onClick();settle(cart,p);assert.equal(proceed(cart).props.href,'/checkout');assert.equal(apiCalls.length,0);
 type(p,'   ');settle(cart,p);assert.equal(proceed(cart).props['aria-disabled'],false);
 // Case/space-normalized existing code is not a replacement. Clearing text
 // preserves that saved code and never requests its removal.
 store={...makeStore(),customer:{id:'owner-a',name:'Fixture'}};cart.render();p.render();
 type(p,' bm10 ');settle(cart,p);assert.equal(proceed(cart).props['aria-disabled'],false);
 type(p,'BIOMOD15');settle(cart,p);assert.equal(proceed(cart).props['aria-disabled'],true);
 button(p,'Clear input').props.onClick();settle(cart,p);assert.equal(store.totals.promo.code,'BM10');assert.equal(apiCalls.length,0);
 // An applied-code change in authoritative totals is also observed, without
 // falsely treating the retained draft as a saved discount.
 type(p,'bm10');settle(cart,p);store=noPromo();cart.render();settle(cart,p);assert.equal(proceed(cart).props['aria-disabled'],true);
 // Rejected Apply + successful read leaves an unresolved draft locked. Clear
 // cannot bypass the separate uncertainty lock if that read subsequently fails.
 apiImpl=async()=>{throw Error('Promo code not recognized.');};refreshImpl=async()=>{};
 find(p,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();settle(cart,p);
 assert.equal(proceed(cart).props['aria-disabled'],true);assert.equal(button(p,'Apply').props.disabled,false);
 refreshImpl=async()=>{throw Error('offline');};find(p,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();settle(cart,p);
 button(p,'Clear input').props.onClick();settle(cart,p);assert.equal(proceed(cart).props['aria-disabled'],true);
 assert(text(p.tree).includes('could not be confirmed'));assert.equal(button(p,'Apply').props.disabled,true);
 const beforeReload=apiCalls.length;refreshImpl=async()=>{};button(p,'Reload totals').props.onClick();await tick();settle(cart,p);
 assert.equal(apiCalls.length,beforeReload,'recovery never repeats a promo POST');assert.equal(proceed(cart).props['aria-disabled'],false);
 // A read which still does not show the attempted code must retain the text
 // and draft guard; a lost response with that exact saved code may unlock it.
 type(p,'BIOMOD15');settle(cart,p);refreshImpl=async()=>{throw Error('offline');};
 find(p,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();settle(cart,p);
 refreshImpl=async()=>{};button(p,'Reload totals').props.onClick();await tick();settle(cart,p);
 assert.equal(input(p).props.value,'BIOMOD15');assert.equal(proceed(cart).props['aria-disabled'],true);
 refreshImpl=async()=>{store={...store,totals:{...store.totals,promo:{code:'BIOMOD15',percentOff:15,savings:4050},promoDiscount:4050,total:22950}};};
 find(p,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();settle(cart,p);
 assert.equal(proceed(cart).props['aria-disabled'],false,'authoritative matching saved code resolves uncertainty');
 // Normal successful Apply is one POST, clears the draft, and exposes saved
 // savings. Existing Remove remains the explicit server mutation.
 type(p,'BM10');settle(cart,p);apiCalls=[];apiImpl=async()=>({});refreshImpl=async()=>{store={...makeStore(),customer:{id:'owner-a',name:'Fixture'}};};
 find(p,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();settle(cart,p);
 assert.deepEqual(apiCalls,[{action:'promo',body:{code:'BM10'}}]);assert.equal(input(p).props.value,'');assert.equal(proceed(cart).props['aria-disabled'],false);
 assert(text(p.tree).includes('BM10 applied. You save $27.00.'));
 // Cart owner tenure rejects late callbacks, including an A -> B -> A switch.
 const oldCartPromo=find(cart,n=>n.type===PromoStub);const oldCartKey=oldCartPromo.key;
 for(const owner of ['owner-b','owner-a']){store={...store,customer:{id:owner,name:'Fixture'}};cart.render();}
 assert.notEqual(find(cart,n=>n.type===PromoStub).key,oldCartKey);
 const newCartPromo=find(cart,n=>n.type===PromoStub);newCartPromo.props.onUnappliedChange(true);newCartPromo.props.onBusyChange(true);
 oldCartPromo.props.onUnappliedChange(false);oldCartPromo.props.onBusyChange(false);cart.render();assert.equal(proceed(cart).props['aria-disabled'],true);
 newCartPromo.props.onUnappliedChange(false);cart.render();assert.equal(proceed(cart).props['aria-disabled'],true);
 newCartPromo.props.onBusyChange(false);cart.render();assert.equal(proceed(cart).props['aria-disabled'],false);
 // Delivery and payment handler guards, not merely disabled button styling.
 store=noPromo();apiCalls=[];apiImpl=async action=>action==='delivery'?{shipping:500,tax:0,total:27500,quoteId:'fresh'}:{url:'/isolated-handoff'};
 checkout=harness(Checkout);await address(checkout);checkout.render();accept(checkout);checkout.render();p=child(checkout);
 const oldPay=button(checkout,'Continue to secure payment');const oldAddress=find(checkout,n=>n.type==='form');const beforeDraft=apiCalls.length;
 assert.equal(oldPay.props.disabled,false);type(p,'BIOMOD15');
 oldPay.props.onClick();await oldAddress.props.onSubmit({preventDefault(){},currentTarget:{fields:{state:'CA'}}});await tick();
 assert.equal(apiCalls.length,beforeDraft);assert.equal(redirects.length,0);
 settle(checkout,p);assert.equal(button(checkout,'Calculate delivery and tax').props.disabled,true);assert.equal(button(p,'Apply').props.disabled,false);
 button(p,'Clear input').props.onClick();oldPay.props.onClick();await tick();assert.equal(apiCalls.length,beforeDraft,'clearing cannot revive a captured old quote handler');
 settle(checkout,p);assert.equal(button(checkout,'Calculate delivery and tax').props.disabled,false);assert.equal(button(checkout,'Continue to secure payment').props.disabled,true);
 await address(checkout);checkout.render();assert.equal(button(checkout,'Continue to secure payment').props.disabled,false);
 // Matching already-applied input leaves a valid quote usable; replacement
 // requires Apply then an explicitly recalculated, discounted quote.
 store={...store,totals:{...makeStore().totals}};checkout.render();await address(checkout);checkout.render();p.render();
 type(p,' bm10 ');settle(checkout,p);assert.equal(button(checkout,'Continue to secure payment').props.disabled,false);
 type(p,'BIOMOD15');settle(checkout,p);refreshImpl=async()=>{store={...store,totals:{...store.totals,promo:{code:'BIOMOD15',percentOff:15,savings:4050},promoDiscount:4050,total:22950}};};
 find(p,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();settle(checkout,p);
 assert.equal(button(checkout,'Continue to secure payment').props.disabled,true);
 apiImpl=async action=>action==='delivery'?{shipping:500,tax:0,total:23450,quoteId:'discounted'}:{url:'/isolated-handoff'};
 await address(checkout);checkout.render();button(checkout,'Continue to secure payment').props.onClick();await tick();
 assert.equal(apiCalls.filter(c=>c.action==='checkout').length,1);assert.equal(apiCalls.at(-1).body.expectedTotal,23450);assert.deepEqual(redirects,['/isolated-handoff']);
 // A quote already in flight cannot reappear after a draft is entered/cleared.
 store=noPromo();apiCalls=[];checkout=harness(Checkout);p=child(checkout);const staleInput=input(p);let lateQuote;
 apiImpl=()=>new Promise(resolve=>lateQuote=resolve);const lateRead=address(checkout);
 staleInput.props.onChange({target:{value:'BIOMOD15'}});p.render();button(p,'Clear input').props.onClick();settle(checkout,p);
 lateQuote({shipping:500,tax:0,total:27500,quoteId:'late'});await lateRead;checkout.render();assert(text(checkout.tree).includes('Pending address'));
 // Old Checkout child callbacks cannot release a later owner's draft/busy.
 const oldCheckoutPromo=find(checkout,n=>n.type===PromoStub);
 for(const owner of ['owner-b','owner-a']){store={...store,customer:{id:owner,name:'Fixture'}};checkout.render();}
 const newCheckoutPromo=find(checkout,n=>n.type===PromoStub);assert.notEqual(newCheckoutPromo.key,oldCheckoutPromo.key);
 newCheckoutPromo.props.onUnappliedChange(true);oldCheckoutPromo.props.onUnappliedChange(false);checkout.render();assert.equal(button(checkout,'Calculate delivery and tax').props.disabled,true);
 newCheckoutPromo.props.onUnappliedChange(false);checkout.render();assert.equal(button(checkout,'Calculate delivery and tax').props.disabled,false);
 assert.equal(apiCalls.filter(c=>c.action==='checkout').length,0);
 console.log('PASS: unapplied draft event/handler guards, normalized saved codes, explicit Clear, recovery locks, stale quotes and owner tenure; collapsed non-advertising UI; stacked total rendering; apply/remove/error refresh recovery; checkout blocks promo work, discards late quotes and invalidates equal-total code changes. No network or real orders.');
})().catch(e=>{console.error(e);process.exitCode=1;});
