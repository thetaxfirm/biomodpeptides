/* Real Cart/Checkout components, isolated hook renderer and provider fixtures.
 * No network, credentials, database, real orders, or payment calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const ts = require('typescript');
const React = require('react');
let active;
const hooks = {
  ...React,
  useState(initial) { const host=active,i=host.cursor++;if(!(i in host.slots))host.slots[i]=typeof initial==='function'?initial():initial;return [host.slots[i],value=>{const next=typeof value==='function'?value(host.slots[i]):value;if(!Object.is(next,host.slots[i])){host.slots[i]=next;host.dirty=true;}}]; },
  useRef(initial) { const host=active,i=host.cursor++;if(!(i in host.slots))host.slots[i]={current:initial};return host.slots[i]; },
  useEffect(fn,deps) { const host=active,i=host.cursor++,previous=host.slots[i];if(!previous||deps.some((v,n)=>!Object.is(previous[n],v))){host.slots[i]=deps;host.effects.push(fn);} },
};
function harness(component) {
  const host={slots:[],cursor:0,effects:[],dirty:false,tree:null,render(){for(let n=0;n<20;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=component();for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}throw Error('render loop');}};
  host.render();return host;
}
function nodes(tree,out=[]) {if(Array.isArray(tree)){tree.forEach(x=>nodes(x,out));return out;}if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
function text(tree) {if(tree==null||typeof tree==='boolean')return '';if(Array.isArray(tree))return tree.map(text).join(' ').replace(/\s+/g,' ').trim();if(typeof tree!=='object')return String(tree);return text(tree.props?.children);}
const find=(host,predicate)=>{const node=nodes(host.tree).find(predicate);assert(node,'expected node is present');return node;};
const button=(host,label)=>find(host,node=>node.type==='button'&&text(node)===label);
const noop=()=>null;
function Blank() {}
function Check() {}
let state,refreshCalls=0,saveCalls=0,apiCalls=[],reports=[],refreshImpl;
const provider={
  useStore:()=>({...state,refresh:()=>{refreshCalls++;return refreshImpl();},saveCart:async()=>{saveCalls++;throw Error('Retry must not write a cart');}}),
  api:async(action,body)=>{apiCalls.push({action,body});assert.equal(action,'delivery','Only the explicit delivery calculation fixture may call an API');return {quoteId:'isolated-quote',total:10500,shipping:500,tax:0};},
  report:error=>reports.push(error),
};
const filename=path.join(root,'components/store/account.tsx');
const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{
  if(id==='react')return hooks;if(id==='react/jsx-runtime')return require('react/jsx-runtime');
  if(id==='./provider')return provider;
  if(id==='@/lib/catalog')return {money:c=>'$'+(c/100).toFixed(2),compound:p=>p.name};
  if(id==='./promo-code')return {PromoCode:noop};if(id==='./product-image')return {ProductImage:noop};
  if(id==='@/lib/auth-return')return {authLink:()=>'',safeAuthReturn:value=>value};
  if(id==='lucide-react')return new Proxy({}, {get:()=>noop});if(id==='sonner')return {toast:{success:noop,info:noop}};
  if(id==='./catalog')return {ProductCard:noop};
  if(id==='./primitives')return {Field:noop,Check,Blank,Choice:noop,formData:form=>form.fields};
  throw Error('Unexpected dependency '+id);
};
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {Cart,Checkout}=mod.exports;
const product={id:1,name:'Isolated fixture',slug:'fixture',sizes:['10mg'],price:10000};
const makeStore=()=>({products:[product],cart:[{id:1,quantity:1}],totals:{subtotal:10000,discount:0,packDiscount:0,promoDiscount:0,total:10000,promo:null,items:[{product,quantity:1,lineTotal:10000}]},config:{freeShippingAt:20000},payment:{enabled:true,state:'live'},customer:{name:'Isolated fixture'},cartConflict:null,cartError:''});
const errorText='Account and cart access could not load. Please retry.';
(async()=>{
  for(const [component,loading,label] of [[Cart,'Loading your saved cart…','Retry cart'],[Checkout,'Loading checkout…','Retry checkout']]) {
    state={store:makeStore(),ready:false,loadError:''};refreshCalls=0;saveCalls=0;apiCalls=[];reports=[];
    const originalCart=JSON.stringify(state.store.cart);
    const host=harness(component);
    assert(text(host.tree).includes(loading));assert.equal(nodes(host.tree).filter(node=>node.props.role==='status').length,1);
    assert.equal(nodes(host.tree).filter(node=>node.type==='button').length,0,'Initial pending load does not offer overlapping refreshes');
    assert.equal(refreshCalls,0);
    state.loadError=errorText;host.render();
    assert.equal(text(find(host,node=>node.props.role==='alert')),errorText,'Failure is persistent in the page, independent of toasts');
    assert(!text(host.tree).includes(loading));assert.equal(button(host,label).props.disabled,false);
    let reject;
    refreshImpl=()=>new Promise((_,failed)=>{reject=failed;});
    const click=button(host,label).props.onClick;
    const first=click(),duplicate=click();
    await duplicate;assert.equal(refreshCalls,1,'Synchronous guard catches a second click before React rerenders');
    host.render();assert.equal(button(host,'Retrying…').props.disabled,true);
    assert.equal(text(find(host,node=>node.props.role==='alert')),errorText,'Error remains visible while retry is pending');
    await button(host,'Retrying…').props.onClick();assert.equal(refreshCalls,1);
    const offline=Error('Isolated temporary failure');reject(offline);
    await assert.doesNotReject(first,'Failed retry is handled, not an unhandled promise rejection');host.render();
    assert.equal(button(host,label).props.disabled,false);assert.equal(reports.at(-1),offline);
    assert.equal(text(find(host,node=>node.props.role==='alert')),errorText);
    let resolve;
    refreshImpl=()=>new Promise(done=>{resolve=()=>{state.ready=true;state.loadError='';done();};});
    const success=button(host,label).props.onClick();host.render();assert.equal(refreshCalls,2);
    assert.equal(button(host,'Retrying…').props.disabled,true);resolve();await success;host.render();
    assert(!text(host.tree).includes(errorText));assert(!nodes(host.tree).some(node=>node.type==='button'&&/^Retry/.test(text(node))));
    assert.equal(JSON.stringify(state.store.cart),originalCart,'Recovery keeps the saved cart intact');
    assert.equal(saveCalls,0);assert.equal(apiCalls.length,0,'Recovery never creates a quote, order or payment');
    if(component===Cart) {
      assert(text(host.tree).includes(product.name));assert(text(host.tree).includes('Items total $100.00'));
      state.loadError=errorText;host.render();assert(text(host.tree).includes(product.name));assert(!text(host.tree).includes(errorText),'Background refresh error does not replace a loaded cart');
    } else {
      const fields={name:'Isolated fixture',line1:'1 Example Street',city:'Las Vegas',state:'NV',zip:'89101',country:'US',phone:'7025550100'};
      await find(host,node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{fields}});host.render();
      assert(text(host.tree).includes('$105.00'));assert(!text(host.tree).includes('Pending address'));
      find(host,node=>node.type===Check).props.onChange(true);host.render();assert.equal(button(host,'Continue to secure payment').props.disabled,false);
      state.loadError=errorText;host.render();
      assert.equal(nodes(host.tree).filter(node=>node.type==='form').length,1,'A background refresh failure keeps the address form in place');
      assert(!text(host.tree).includes('Pending address'));assert.equal(button(host,'Continue to secure payment').props.disabled,false,'A background failure does not reset the accepted current quote');
      find(host,node=>node.type==='form').props.onChange();host.render();
      assert(text(host.tree).includes('Pending address'));assert.equal(button(host,'Continue to secure payment').props.disabled,true,'Editing address still invalidates delivery and blocks payment');
      assert.equal(apiCalls.filter(call=>call.action==='checkout').length,0);
    }
  }
  // Recovery does not bypass existing disabled-payment or cart-conflict gates.
  state={store:{...makeStore(),payment:{enabled:false,state:'not_configured'}},ready:true,loadError:''};
  assert(text(harness(Checkout).tree).includes('Checkout is not open yet.'));
  state={store:{...makeStore(),cartError:'Availability needs review'},ready:true,loadError:''};
  assert.equal(find(harness(Checkout),node=>node.type===Blank).props.title,'Your cart needs a review.');
  state={store:{...makeStore(),cartConflict:{id:'isolated-conflict',message:'Choose your cart',current:[],saved:[]}},ready:true,loadError:''};
  for(const component of [Cart,Checkout]) assert.equal(harness(component).tree.type.name,'CartChoice','Cart conflicts still require a choice before shopping or checkout');
  console.log('PASS: real Cart/Checkout initial loading, persistent errors, handled retry failure, synchronous duplicate-click guard, successful recovery without cart writes, background-error form/quote preservation, address invalidation and existing checkout gates. No network or orders.');
})().catch(error=>{console.error(error);process.exitCode=1;});
