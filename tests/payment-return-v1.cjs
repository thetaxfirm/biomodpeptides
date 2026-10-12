/* Actual PaymentReturn with isolated hooks and provider fixtures only.
 * No network, credentials, customer data, orders, or payments are accessed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
let active;
const hooks = {
  ...React,
  useState(initial) {
    const host=active,i=host.cursor++;
    if(!(i in host.slots))host.slots[i]=typeof initial==='function'?initial():initial;
    return [host.slots[i],value=>{const next=typeof value==='function'?value(host.slots[i]):value;if(!Object.is(next,host.slots[i])){host.slots[i]=next;host.dirty=true;host.writes++;}}];
  },
  useRef(initial) {const host=active,i=host.cursor++;if(!(i in host.slots))host.slots[i]={current:initial};return host.slots[i];},
  useEffect(fn,deps) {
    const host=active,i=host.cursor++,previous=host.slots[i];
    if(!previous||deps.some((v,n)=>!Object.is(previous.deps[n],v))) {
      const effect={deps,cleanup:null};host.slots[i]=effect;
      host.effects.push(()=>{previous?.cleanup?.();effect.cleanup=fn();});
    }
  },
};
function harness(component) {
  const host={slots:[],cursor:0,effects:[],dirty:false,writes:0,tree:null,render(){
    for(let n=0;n<20;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=component();for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}
    throw Error('render loop');
  },unmount(){for(const slot of this.slots)slot?.cleanup?.();}};
  host.render();return host;
}
function nodes(tree,out=[]) {if(Array.isArray(tree)){tree.forEach(x=>nodes(x,out));return out;}if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
function text(tree) {if(tree==null||typeof tree==='boolean')return '';if(Array.isArray(tree))return tree.map(text).join(' ').replace(/\s+/g,' ').trim();if(typeof tree!=='object')return String(tree);return text(tree.props?.children);}
const find=(host,predicate)=>{const node=nodes(host.tree).find(predicate);assert(node,'expected node is present');return node;};
const buttons=host=>nodes(host.tree).filter(node=>node.type==='button');
const button=(host,label)=>find(host,node=>node.type==='button'&&text(node)===label);
const records=host=>nodes(host.tree).filter(node=>node.type==='article');
const alert=host=>text(find(host,node=>node.props.role==='alert'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async host=>{for(let i=0;i<8;i++)await Promise.resolve();host?.render();};
const noop=()=>null;
let state,apiImpl,refreshImpl,apiCalls,refreshCalls,reports;
const everyCall=[];
const provider={
  useStore:()=>({...state,refresh:()=>{refreshCalls++;return refreshImpl();}}),
  api:async(action,body)=>{
    assert(['account','reconcile'].includes(action),'PaymentReturn must never create, resume or open a payment');
    if(action==='reconcile')assert.deepEqual(Object.keys(body),['id']);
    const call={action,body};apiCalls.push(call);everyCall.push(call);return apiImpl(action,body);
  },
  report:error=>reports.push(error),
};
function loadShippingPure(relative) {
  const filename=path.join(root,relative),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(root);
  m.require=id=>{if(id==='./shipping-options')return loadShippingPure('lib/shipping-options.ts');throw Error('Unexpected pure shipping dependency '+id);};
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);return m.exports;
}
const filename=path.join(root,'components/store/account.tsx');
const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{
 if(id==='@/lib/shipping-terms')return loadShippingPure('lib/shipping-terms.ts');
 if(id==='@/lib/preorders'||id==='./preorder-notice'){const m={exports:{}};const filename=require('node:path').join(root,id==='@/lib/preorders'?'lib/preorders.ts':'components/store/preorder-notice.tsx');new Function('exports','require',require('typescript').transpileModule(require('node:fs').readFileSync(filename,'utf8'),{compilerOptions:{module:1,target:9,jsx:4}}).outputText)(m.exports,require);return m.exports;}
 if(id==='@/lib/fulfillment'){const m={exports:{}};new Function('exports',require('typescript').transpileModule(require('node:fs').readFileSync(require('node:path').join(root,'lib/fulfillment.ts'),'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(m.exports);return m.exports;}
  if(id==='react')return hooks;if(id==='react/jsx-runtime')return require('react/jsx-runtime');
  if(id==='./provider')return provider;
  if(id==='@/lib/catalog')return {money:c=>'$'+(c/100).toFixed(2),compound:p=>p.name};
  if(id==='./promo-code')return {PromoCode:noop};if(id==='./product-image')return {ProductImage:noop};
  if(id==='@/lib/auth-return')return {authLink:()=>'',safeAuthReturn:value=>value};
  if(id==='lucide-react')return new Proxy({}, {get:()=>noop});
  if(id==='sonner')return {toast:{success:noop,info:noop}};
  if(id==='./catalog')return {ProductCard:noop};
  if(id==='./primitives')return {Field:noop,Check:noop,Blank:noop,Choice:noop,formData:form=>form.fields};
  throw Error('Unexpected dependency '+id);
};
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {PaymentReturn,AuthPage}=mod.exports;
global.fetch=()=>{throw Error('Network forbidden in isolated test');};
function reset(overrides={}) {
  state={store:{customer:{id:'fixture-owner-a'},authReady:true},ready:true,loadError:'',...overrides};
  apiCalls=[];refreshCalls=0;reports=[];
  apiImpl=async()=>{throw Error('Unexpected provider call');};
  refreshImpl=async()=>{throw Error('Unexpected refresh');};
}
const order=(status='pending',id='00000001-0000-4000-8000-000000000001')=>({id,status,total:10000});
(async()=>{
  // Provider loading, persistent failure, synchronous guarded retry and signed-out return destination.
  reset({ready:false,store:{customer:null,authReady:true}});
  let host=harness(PaymentReturn);
  assert(text(host.tree).includes('Loading secure account access'));assert.equal(apiCalls.length,0);
  state.loadError='Account and cart access could not load. Please retry.';host.render();
  assert.equal(alert(host),state.loadError);
  let pending=deferred();refreshImpl=()=>pending.promise;
  const retry=button(host,'Retry account access').props.onClick;
  const attempt=retry();await retry();assert.equal(refreshCalls,1);host.render();
  assert(button(host,'Retrying…').props.disabled);
  pending.reject(Error('Fixture auth outage'));await attempt;host.render();
  assert.equal(reports.length,1);assert.equal(button(host,'Retry account access').props.disabled,false);
  refreshImpl=async()=>{state.ready=true;state.loadError='';};
  await button(host,'Retry account access').props.onClick();host.render();
  assert.equal(host.tree.type,AuthPage);assert.equal(host.tree.props.returnTo,'/payment/return');
  assert.equal(apiCalls.length,0);host.unmount();

  // All returned account statuses remain visible. Explicit verification is single-flight,
  // including another order clicked before React renders. A failed refresh preserves paid.
  reset();
  const initial=[order(),order('review','00000002-0000-4000-8000-000000000002'),order('paid','00000003-0000-4000-8000-000000000003'),order('labeling','00000004-0000-4000-8000-000000000004'),order('shipped','00000005-0000-4000-8000-000000000005'),order('delivered','00000006-0000-4000-8000-000000000006')];
  const firstLoad=deferred(),verification=deferred(),reload=deferred();let accountCount=0;
  apiImpl=(action)=>action==='reconcile'?verification.promise:(++accountCount===1?firstLoad.promise:reload.promise);
  host=harness(PaymentReturn);assert(text(host.tree).includes('Loading your orders'));assert.equal(apiCalls.length,1);
  firstLoad.resolve({orders:structuredClone(initial)});await flush(host);
  assert.equal(records(host).length,6,'Paid and fulfillment records are retained');
  for(const label of ['Payment confirmed','Preparing shipment','Marked dispatched by store; carrier acceptance unconfirmed','Marked delivered by store; carrier delivery unconfirmed','Payment requires review','Payment confirmation pending'])assert(text(host.tree).includes(label));
  assert.equal(buttons(host).length,2);assert.equal(apiCalls.filter(c=>c.action==='reconcile').length,0,'No automatic payment reconciliation');
  const verify=buttons(host)[0].props.onClick,other=buttons(host)[1].props.onClick;
  const verifying=verify();await verify();await other();assert.equal(apiCalls.filter(c=>c.action==='reconcile').length,1);host.render();
  assert(buttons(host).every(b=>b.props.disabled));assert(text(host.tree).includes('Verifying payment…'));
  verification.resolve({status:'paid'});await flush(host);
  assert(text(records(host)[0]).includes('Payment confirmed'),'Authoritative status is visible before refreshed orders arrive');
  assert(!text(records(host)[0]).includes('pending'));assert(buttons(host).every(b=>b.props.disabled));
  reload.reject(Error('Fixture refresh outage'));await verifying;host.render();
  assert(text(records(host)[0]).includes('Payment confirmed'));assert.match(alert(host),/last verified status is still shown/i);
  assert.equal(button(host,'Retry order list').props.disabled,false);
  const recover=deferred();apiImpl=()=>recover.promise;
  const retryList=button(host,'Retry order list').props.onClick;retryList();retryList();host.render();
  assert.equal(apiCalls.filter(c=>c.action==='account').length,3);assert(button(host,'Refreshing orders…').props.disabled);
  recover.resolve({orders:initial.map((item,n)=>n===0?{...item,status:'paid'}:item)});await flush(host);
  assert(!nodes(host.tree).some(n=>n.props.role==='alert'));assert(text(records(host)[0]).includes('Payment confirmed'));host.unmount();

  // Pending/review stay pending/review; confirmed fulfillment states do not offer another verify.
  for(const [status,label] of [['pending','Payment confirmation pending'],['review','Payment requires review'],['paid','Payment confirmed'],['labeling','Preparing shipment'],['shipped','Marked dispatched by store; carrier acceptance unconfirmed'],['delivered','Marked delivered by store; carrier delivery unconfirmed']]) {
    reset();let calls=0;
    apiImpl=async action=>action==='reconcile'?{status}:{orders:[order(++calls===1?'awaiting_payment':status)]};
    host=harness(PaymentReturn);await flush(host);
    await button(host,'Verify payment').props.onClick();await flush(host);
    assert(text(records(host)[0]).includes(label));assert.equal(apiCalls.filter(c=>c.action==='account').length,2);
    assert.equal(buttons(host).length,['pending','review'].includes(status)?1:0);host.unmount();
  }

  // Failed or malformed verification never changes the last status or claims a charge failed.
  for(const result of [Error('Fixture provider outage'),{status:'unknown'}]) {
    reset();apiImpl=async action=>{if(action==='account')return {orders:[order()]};if(result instanceof Error)throw result;return result;};
    host=harness(PaymentReturn);await flush(host);await button(host,'Verify payment').props.onClick();await flush(host);
    assert(text(records(host)[0]).includes('Payment confirmation pending'));assert.match(alert(host),/could not be verified/);
    assert(!text(host.tree).includes('Payment unsuccessful'));assert.equal(apiCalls.filter(c=>c.action==='account').length,1);
    assert.equal(button(host,'Verify payment').props.disabled,false);host.unmount();
  }

  // Initial failure has a durable retry and is never presented as an empty account.
  reset();apiImpl=async()=>{throw Error('Fixture account outage');};host=harness(PaymentReturn);await flush(host);
  assert.match(alert(host),/orders could not load/);assert(!text(host.tree).includes('No orders were found'));
  apiImpl=async()=>({orders:[]});button(host,'Retry order list').props.onClick();await flush(host);
  assert(text(host.tree).includes('No orders were found for this signed-in account'));assert(!nodes(host.tree).some(n=>n.props.role==='alert'));host.unmount();

  // A late account result must never leak an earlier account's orders after authentication changes.
  reset();const oldLoad=deferred(),newLoad=deferred();let loads=0;
  apiImpl=()=>++loads===1?oldLoad.promise:newLoad.promise;
  host=harness(PaymentReturn);
  state.store.customer={id:'fixture-owner-b'};host.render();assert.equal(records(host).length,0);
  newLoad.resolve({orders:[order('paid','bbbbbbbb-0000-4000-8000-000000000002')]});await flush(host);
  oldLoad.resolve({orders:[order('pending','aaaaaaaa-0000-4000-8000-000000000001')]});await flush(host);
  assert(text(host.tree).includes('bbbbbbbb'));assert(!text(host.tree).includes('aaaaaaaa'));host.unmount();

  // A stale verification cannot overwrite a new customer's order or release their in-flight guard.
  reset();const oldVerify=deferred(),newVerify=deferred();let verificationCount=0;
  apiImpl=async action=>action==='account'?{orders:[order('pending',state.store.customer.id==='fixture-owner-a'?'aaaaaaaa-0000-4000-8000-000000000001':'bbbbbbbb-0000-4000-8000-000000000002')]}:(++verificationCount===1?oldVerify.promise:newVerify.promise);
  host=harness(PaymentReturn);await flush(host);const oldAttempt=button(host,'Verify payment').props.onClick();
  state.store.customer={id:'fixture-owner-b'};host.render();await flush(host);
  const newClick=button(host,'Verify payment').props.onClick,newAttempt=newClick();host.render();
  oldVerify.resolve({status:'paid'});await oldAttempt;await flush(host);
  assert(text(host.tree).includes('bbbbbbbb'));assert(!text(host.tree).includes('aaaaaaaa'));assert(!text(host.tree).includes('Payment confirmed'));
  await newClick();assert.equal(verificationCount,2,'Stale finally does not release the new request guard');
  newVerify.reject(Error('Fixture new-owner outage'));await newAttempt;await flush(host);assert.match(alert(host),/could not be verified/);host.unmount();

  // Switching accounts while a post-verification list refresh is outstanding ignores that list.
  reset();const staleRefresh=deferred();let reads=0;
  apiImpl=async action=>{if(action==='reconcile')return {status:'paid'};reads++;return reads===2?staleRefresh.promise:{orders:[order('pending',reads===1?'aaaaaaaa-0000-4000-8000-000000000001':'bbbbbbbb-0000-4000-8000-000000000002')]};};
  host=harness(PaymentReturn);await flush(host);const refreshing=button(host,'Verify payment').props.onClick();await flush(host);
  assert(text(host.tree).includes('Payment confirmed'));
  state.store.customer={id:'fixture-owner-b'};host.render();await flush(host);
  staleRefresh.resolve({orders:[order('paid','aaaaaaaa-0000-4000-8000-000000000001')]});await refreshing;await flush(host);
  assert(text(host.tree).includes('bbbbbbbb'));assert(!text(host.tree).includes('aaaaaaaa'));host.unmount();

  // Unmount cancellation also prevents state writes from late initial loads or verification.
  for(const stage of ['load','verify']) {
    reset();const late=deferred();apiImpl=async action=>action==='account'&&stage==='verify'?{orders:[order()]}:late.promise;
    host=harness(PaymentReturn);if(stage==='verify'){await flush(host);button(host,'Verify payment').props.onClick();host.render();}
    host.unmount();const writes=host.writes;late.resolve(stage==='load'?{orders:[order()]}:{status:'paid'});await flush();
    assert.equal(host.writes,writes,'Unmounted component ignores late results');
  }
  assert(everyCall.every(c=>['account','reconcile'].includes(c.action)));
  console.log('PASS: actual PaymentReturn authenticated loading/retry/empty states; sign-in return; paid/fulfillment visibility; explicit single-flight verification; paid result retained on refresh failure; pending/review and unknown/error safety; owner-change and unmount races. Only isolated account/reconcile fixtures, no network or payments.');
})().catch(error=>{console.error(error);process.exitCode=1;});
