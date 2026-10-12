/* Actual Account with isolated hooks and provider fixtures only.
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
    for(let n=0;n<20;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=component();this.beforeEffects=this.tree;for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}
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
function Field(){} function Check(){} function Blank(){}
let state,apiImpl,refreshImpl,apiCalls,refreshCalls,reports,allowProfileFixture=false;
const everyCall=[];
const provider={
  useStore:()=>({...state,refresh:()=>{refreshCalls++;return refreshImpl();}}),
  api:async(action,body)=>{
    assert(action==='account'||(allowProfileFixture&&action==='profile'),'Only GET account and an explicit isolated profile-action fixture are permitted');
    if(action==='account')assert.equal(body,undefined,'Account retry is a GET with no payload');
    const call={action,body};apiCalls.push(call);everyCall.push(call);return apiImpl(action,body);
  },
  report:error=>reports.push(error),
};
const authReturnFilename=path.join(root,'lib/auth-return.ts');
const authReturnModule=new Module(authReturnFilename,module);
authReturnModule._compile(ts.transpileModule(fs.readFileSync(authReturnFilename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,authReturnFilename);
const {authLink}=authReturnModule.exports;
const filename=path.join(root,'components/store/account.tsx');
const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{
 if(id==='@/lib/fulfillment'){const m={exports:{}};new Function('exports',require('typescript').transpileModule(require('node:fs').readFileSync(require('node:path').join(root,'lib/fulfillment.ts'),'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(m.exports);return m.exports;}
  if(id==='react')return hooks;if(id==='react/jsx-runtime')return require('react/jsx-runtime');
  if(id==='./provider')return provider;
  if(id==='@/lib/catalog')return {money:c=>'$'+(c/100).toFixed(2),compound:p=>p.name};
  if(id==='./promo-code')return {PromoCode:noop};if(id==='./product-image')return {ProductImage:noop};
  if(id==='@/lib/auth-return')return authReturnModule.exports;
  if(id==='lucide-react')return new Proxy({}, {get:()=>noop});
  if(id==='sonner')return {toast:{success:noop,info:noop}};
  if(id==='./catalog')return {ProductCard:noop};
  if(id==='./primitives')return {Field,Check,Blank,Choice:noop,formData:form=>form.fields};
  throw Error('Unexpected dependency '+id);
};
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {Account,AuthPage}=mod.exports;
global.fetch=()=>{throw Error('Network forbidden in isolated test');};
const makeAccount=(label='Owner A',id='aaaaaaaa-fixture')=>({
  orders:[{id,status:'paid',total:10000,data:{items:[]}}],
  addresses:[{id:'fixture-address',name:label,line1:'Isolated fixture',city:'Example',state:'NV',zip:'00000'}],
  rewards:[],requests:[],profile:{name:label,phone:'',company:'',research_accepted:true},
});
function reset(overrides={}) {
  state={store:{customer:{id:'fixture-owner-a',email:'a@example.invalid',name:'Owner A'},authReady:true,wishlist:[],products:[],config:{rewardsEnabled:false},cartConflict:null},ready:true,loadError:'',...overrides};
  apiCalls=[];refreshCalls=0;reports=[];allowProfileFixture=false;
  apiImpl=async()=>{throw Error('Unexpected provider call');};refreshImpl=async()=>{throw Error('Unexpected refresh');};
}
const mount=(section='orders')=>harness(()=>Account({section}));
const profileName=host=>find(host,n=>n.type===Field&&n.props.name==='name').props.defaultValue;
const submitProfile=host=>find(host,n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:{fields:{name:'Updated fixture'}}});
(async()=>{
  // Initial provider failure must not masquerade as an empty account or wishlist.
  for(const section of ['orders','wishlist']) {
    reset({ready:false,store:{customer:null,authReady:true,wishlist:[],products:[],config:{}}});
    let host=mount(section);assert(text(host.tree).includes('Loading your account'));assert.equal(apiCalls.length,0);
    state.loadError='Account and cart access could not load. Please retry.';host.render();assert.equal(alert(host),state.loadError);
    const pending=deferred();refreshImpl=()=>pending.promise;
    const click=button(host,'Retry account access').props.onClick,attempt=click();await click();assert.equal(refreshCalls,1);host.render();assert(button(host,'Retrying…').props.disabled);
    pending.reject(Error('Isolated store outage'));await attempt;host.render();assert.equal(button(host,'Retry account access').props.disabled,false);assert.equal(reports.length,1);assert.equal(apiCalls.length,0);
    refreshImpl=async()=>{state.ready=true;state.loadError='';};await button(host,'Retry account access').props.onClick();host.render();
    if(section==='orders'){assert.equal(host.tree.type,AuthPage);assert.equal(host.tree.props.returnTo,'/account/orders');}
    else assert(text(host.tree).includes('Your Wishlist'),'Anonymous wishlist behavior is retained after successful readiness');
    host.unmount();
  }
  // Account read failure persists; retry is single-flight and never repeats mutations.
  reset();apiImpl=async()=>{throw Error('Isolated read failure');};let host=mount();await flush(host);
  assert.match(alert(host),/account details could not load/);assert(!text(host.tree).includes('Loading account details'));assert.equal(records(host).length,0);
  const second=deferred();apiImpl=()=>second.promise;const retry=button(host,'Retry account details').props.onClick;retry();retry();host.render();
  assert.equal(apiCalls.length,2);assert(button(host,'Refreshing account details…').props.disabled);assert.match(alert(host),/could not load/);
  second.reject(Error('Another read failure'));await flush(host);assert.equal(button(host,'Retry account details').props.disabled,false);
  apiImpl=async()=>makeAccount();button(host,'Retry account details').props.onClick();await flush(host);
  assert.equal(records(host).length,1);assert(text(host.tree).includes('aaaaaaaa'));assert(!nodes(host.tree).some(n=>n.props.role==='alert'));assert.equal(refreshCalls,0);
  assert(apiCalls.every(c=>c.action==='account'&&c.body===undefined));host.unmount();

  // Malformed successful responses are read errors, never a render crash or false empty state.
  reset();apiImpl=async()=>({orders:[]});host=mount();await flush(host);assert.match(alert(host),/could not load/);assert.equal(records(host).length,0);host.unmount();

  // Store recovery transitions into an account GET only after current ownership is ready.
  reset({ready:false,loadError:'Store unavailable'});host=mount();assert.equal(apiCalls.length,0);
  refreshImpl=async()=>{state.ready=true;state.loadError='';};apiImpl=async()=>makeAccount();await button(host,'Retry account access').props.onClick();await flush(host);await flush(host);
  assert.equal(records(host).length,1);assert.equal(refreshCalls,1);assert.equal(apiCalls.length,1);host.unmount();

  // A new owner never sees the old owner's already-loaded records, even before effects run.
  reset();apiImpl=async()=>makeAccount();host=mount();await flush(host);assert(text(host.tree).includes('aaaaaaaa'));
  const newRead=deferred();apiImpl=()=>newRead.promise;state.store.customer={id:'fixture-owner-b',email:'b@example.invalid',name:'Owner B'};host.render();
  assert(!text(host.beforeEffects).includes('aaaaaaaa'));assert.equal(records(host).length,0);
  newRead.resolve(makeAccount('Owner B','bbbbbbbb-fixture'));await flush(host);assert(text(host.tree).includes('bbbbbbbb'));assert(!text(host.tree).includes('aaaaaaaa'));host.unmount();

  // Late reads from a previous owner cannot overwrite the current read or release its retry guard.
  reset();const oldRead=deferred(),currentRead=deferred();let reads=0;apiImpl=()=>++reads===1?oldRead.promise:currentRead.promise;host=mount();
  state.store.customer={id:'fixture-owner-b',email:'b@example.invalid',name:'Owner B'};host.render();
  oldRead.resolve(makeAccount());await flush(host);assert.equal(records(host).length,0);assert(text(host.tree).includes('Loading account details'));
  currentRead.reject(Error('B read failed'));await flush(host);assert.match(alert(host),/could not load/);
  const retryB=deferred();apiImpl=()=>retryB.promise;const clickB=button(host,'Retry account details').props.onClick;clickB();clickB();assert.equal(apiCalls.length,3);
  retryB.resolve(makeAccount('Owner B','bbbbbbbb-fixture'));await flush(host);assert(text(host.tree).includes('bbbbbbbb'));assert(!text(host.tree).includes('aaaaaaaa'));host.unmount();

  // Signing out during a read removes all private account data and ignores its response.
  reset();const signedOutRead=deferred();apiImpl=()=>signedOutRead.promise;host=mount();state.store.customer=null;host.render();assert.equal(host.tree.type,AuthPage);
  const before=host.writes;signedOutRead.resolve(makeAccount());await flush();assert.equal(host.writes,before);host.unmount();

  // Existing profile-save action is left intact. Only its follow-up GET fails; known data stays visible.
  reset();apiImpl=async()=>makeAccount();host=mount('profile');await flush(host);assert.equal(profileName(host),'Owner A');
  allowProfileFixture=true;apiImpl=async action=>{if(action==='profile')return{message:'Fixture profile saved'};throw Error('Follow-up read unavailable');};
  await submitProfile(host);await flush(host);assert.equal(profileName(host),'Owner A');assert.match(alert(host),/last loaded information is still shown/);
  assert.equal(apiCalls.filter(c=>c.action==='profile').length,1);
  apiImpl=async action=>{assert.equal(action,'account');return makeAccount('Updated fixture');};button(host,'Retry account details').props.onClick();await flush(host);
  assert.equal(profileName(host),'Updated fixture');assert.equal(apiCalls.filter(c=>c.action==='profile').length,1,'Retry never repeats profile save');host.unmount();

  // A successful action can start a fresher read while a retry waits; older data cannot win afterward.
  reset();apiImpl=async()=>makeAccount();host=mount('profile');await flush(host);allowProfileFixture=true;
  apiImpl=async action=>{if(action==='profile')return{};throw Error('Known-data refresh failure');};await submitProfile(host);await flush(host);
  const staleRetry=deferred(),actionRefresh=deferred();let accountReads=0;apiImpl=action=>action==='profile'?Promise.resolve({}):++accountReads===1?staleRetry.promise:actionRefresh.promise;
  button(host,'Retry account details').props.onClick();host.render();const saving=submitProfile(host);await flush(host);assert.equal(accountReads,2);
  actionRefresh.resolve(makeAccount('Newest snapshot'));await saving;await flush(host);assert.equal(profileName(host),'Newest snapshot');
  staleRetry.resolve(makeAccount('Old retry snapshot'));await flush(host);assert.equal(profileName(host),'Newest snapshot');host.unmount();

  // A background store refresh failure keeps account data and has its own read-only retry.
  reset();apiImpl=async()=>makeAccount();host=mount();await flush(host);state.loadError='Store read failed';host.render();
  assert(text(host.tree).includes('aaaaaaaa'));assert.match(alert(host),/Account access could not refresh/);const readCount=apiCalls.length;
  refreshImpl=async()=>{state.loadError='';};await button(host,'Retry account access').props.onClick();host.render();assert.equal(apiCalls.length,readCount);assert(text(host.tree).includes('aaaaaaaa'));assert(!nodes(host.tree).some(n=>n.props.role==='alert'));host.unmount();

  // Read completions after unmount never update state.
  for(const result of ['resolve','reject']){reset();const pending=deferred();apiImpl=()=>pending.promise;host=mount();host.unmount();const writes=host.writes;
    result==='resolve'?pending.resolve(makeAccount()):pending.reject(Error('Late read error'));await flush();assert.equal(host.writes,writes);}

  // Captured action continuations do not restart account reads after unmount or A -> B -> A.
  for(const transition of ['unmount','round-trip']){
    reset();apiImpl=async()=>makeAccount();host=mount('profile');await flush(host);allowProfileFixture=true;const action=deferred();apiImpl=name=>name==='profile'?action.promise:Promise.resolve(makeAccount('Current tenure'));
    const pending=submitProfile(host);await flush(host);
    if(transition==='unmount')host.unmount();else{state.store.customer={id:'fixture-owner-b',email:'b@example.invalid',name:'Owner B'};host.render();await flush(host);state.store.customer={id:'fixture-owner-a',email:'a@example.invalid',name:'Owner A'};host.render();await flush(host);}
    const accountCount=apiCalls.filter(c=>c.action==='account').length;action.resolve({message:'Fixture action finished'});await pending;await flush();
    assert.equal(apiCalls.filter(c=>c.action==='account').length,accountCount,transition+' rejects old captured reload');if(transition!=='unmount')host.unmount();
  }
  // Management navigation appears only for a signed-in administrator. Account data remains their own.
  for(const section of ['', 'orders', 'affiliate']) {
    reset();state.store.admin=true;apiImpl=async()=>makeAccount();host=mount(section);
    const notice=find(host,n=>n.type==='section'&&n.props['aria-labelledby']==='account-store-management');
    assert.match(text(notice),/account below shows your own purchases/);
    const flat=nodes(host.tree);assert(flat.indexOf(notice)<flat.indexOf(find(host,n=>n.props.className==='account-body')),'Management destinations are visible before ordinary account details, including while loading');
    for(const [href,label] of [['/admin?tab=orders','Store orders'],['/admin?tab=promos','Affiliate & promo codes']]) {
      assert(nodes(notice).some(n=>n.type==='a'&&n.props.href===href&&text(n)===label));
      const nav=find(host,n=>n.type==='aside');assert(nodes(nav).some(n=>n.type==='a'&&n.props.href===href&&text(n)===label));
    }
    await flush(host);
    assert.equal(text(find(host,n=>n.type==='aside')).includes('My purchases'),true);
    if(section==='orders') {assert.equal(text(find(host,n=>n.type==='h2'&&text(n)==='My purchases')),'My purchases');assert.equal(records(host).length,1);assert(text(host.tree).includes('aaaaaaaa'));}
    if(section==='')assert.equal(text(find(host,n=>n.type==='a'&&n.props.href==='/account/orders'&&nodes(n).some(child=>child.type==='strong'))),'1 My purchases');
    if(section==='affiliate')assert(text(host.tree).includes('Applications are reviewed before program access is granted.'),'Personal affiliate application behavior is retained');
    assert(apiCalls.every(c=>c.action==='account'&&c.body===undefined),'Management links never fetch store-wide data');
    state.store.admin=false;host.render();assert(!nodes(host.tree).some(n=>n.type==='a'&&n.props.href?.startsWith('/admin')),'Removing admin status removes every management link immediately');
    assert(!text(host.tree).includes('Store management'));assert(!text(host.tree).includes('My purchases'));
    assert(nodes(host.tree).some(n=>n.type==='a'&&n.props.href==='/account/orders'&&text(n)==='Orders'),'Ordinary customer Orders navigation is unchanged');
    if(section==='orders')assert(nodes(host.tree).some(n=>n.type==='h2'&&text(n)==='Orders'));
    if(section==='')assert(text(host.tree).includes('Manage your orders, addresses, saved products, and research account.'));
    host.unmount();
  }
  reset();state.store.customer=null;state.store.admin=true;host=mount();assert.equal(host.tree.type,AuthPage);assert(!nodes(host.tree).some(n=>n.props.href?.startsWith('/admin')));host.unmount();

  // Actual AuthPage recognizes safe admin deep links without weakening return-destination validation.
  for(const destination of ['/admin','/admin?tab=orders','/admin?tab=promos','#invalid','/administrator','https://evil.example/admin?tab=promos','//evil.example/admin']) {
    reset();const isAdmin=destination.startsWith('/admin')&&destination!=='/administrator';
    host=harness(()=>AuthPage({returnTo:destination}));
    assert(nodes(host.tree).some(n=>n.type==='a'&&n.props.href===authLink('forgot-password',destination)&&text(n)===(isAdmin?'Set or reset your admin password':'Forgot password?')));
    assert(nodes(host.tree).some(n=>n.type==='a'&&n.props.href===authLink('register',destination)));
    host.unmount();host=harness(()=>AuthPage({mode:'forgot-password',returnTo:destination}));
    assert.equal(text(find(host,n=>n.type==='h1')),isAdmin?'Set your admin password':'Reset your password');
    assert.equal(text(host.tree).includes('Access is limited to approved administrator addresses.'),isAdmin);
    assert(nodes(host.tree).some(n=>n.type==='a'&&n.props.href===authLink('login',destination)&&text(n)==='Back to sign in'));
    assert.equal(apiCalls.length,0,'Rendering destinations never submits auth or account actions');host.unmount();
  }
  assert(everyCall.every(c=>c.action==='account'||c.action==='profile'),'No cart, payment, email or order mutation calls');
  console.log('PASS: actual Account initial store failure/recovery; durable account-read errors and single-flight GET retries; malformed data; owner changes, sign-out, stale reads and unmount; known-data refresh failure; preserved action reloads with latest-read wins; stale action reload exclusion; admin-only management navigation and safe auth deep-link wording. Isolated account/profile fixtures only, no live network or commerce calls.');
})().catch(error=>{console.error(error);process.exitCode=1;});
