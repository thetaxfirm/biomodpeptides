/* Actual StoreProvider: a failed first cart/account read leaves the page quiet.
 * Search renderers cannot fetch /api/ (robots.txt), so an error laid over a
 * public page at load is what they would index. Isolated fixtures; no network. */
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
 useEffect(fn,deps){const h=active,i=h.cursor++,old=h.slots[i];if(!old||deps.some((v,n)=>!Object.is(old[n],v))){h.slots[i]=deps;h.effects.push(()=>{h.cleanups[i]?.();h.cleanups[i]=fn();});}},
};
function harness(component){const h={slots:[],cleanups:[],cursor:0,effects:[],dirty:false,tree:null,
 render(){for(let n=0;n<30;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=component();for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}throw Error('render loop');},
 unmount(){this.cleanups.forEach(fn=>fn?.());this.cleanups=[];}};h.render();return h;}
const toasts=[];
const cache=new Map();
function load(relative){if(cache.has(relative))return cache.get(relative).exports;const filename=path.join(root,relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);cache.set(relative,mod);
 mod.require=id=>{
  if(id==='react')return hooks;if(id==='react/jsx-runtime')return require('react/jsx-runtime');
  if(id==='sonner')return{toast:{success(){},info(){},error:message=>toasts.push(message)},Toaster:()=>null};
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
const {StoreProvider}=load('components/store/provider.tsx');
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
let host,listeners,stateReads,stateFails;
const gestureCount=()=>['pointerdown','keydown'].reduce((n,k)=>n+(listeners.get(k)?.size||0),0);
const emit=k=>[...(listeners.get(k)||[])].forEach(fn=>fn());
const context=()=>host.tree.props.value;
function mount(){
 host?.unmount();toasts.length=0;listeners=new Map();stateReads=0;
 global.document={visibilityState:'visible',referrer:'',body:{},querySelector:()=>null,
  addEventListener:(k,fn)=>{if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener:(k,fn)=>listeners.get(k)?.delete(fn)};
 global.window={location:{origin:'https://trybiomod.com',pathname:'/testing',search:''},requestAnimationFrame:()=>0,cancelAnimationFrame(){}};
 Object.defineProperty(global,'navigator',{value:{globalPrivacyControl:false,doNotTrack:null,webdriver:false},configurable:true});
 global.MutationObserver=class{observe(){}disconnect(){}};
 global.fetch=url=>{
  assert(url.startsWith('/api/store/'),'Live/unapproved fetch blocked: '+url);const action=url.slice('/api/store/'.length);
  // A renderer that honours robots.txt refuses both reads outright.
  if(action==='auth-refresh')return Promise.reject(Error('Blocked by robots.txt'));
  assert.equal(action,'state','Only the state read is expected');stateReads++;
  if(stateFails())return Promise.reject(Error('Blocked by robots.txt'));
  return Promise.resolve({ok:true,json:async()=>({products,cart:[],cartConflict:null,cartError:'',wishlist:[],savedPacks:[],campaigns:[],customer:null,authReady:true,googleReady:false,admin:false,payment:{enabled:true,state:'live'},config:{freeShippingAt:20000},totals:null})});
 };
 host=harness(()=>StoreProvider({children:null,initialCatalog:products,shoppingMeasurementEnabled:false}));
}
(async()=>{
 // 1. The read never succeeds: nothing is announced until the visitor acts.
 stateFails=()=>true;mount();await flush();host.render();
 assert.equal(stateReads,1);assert.equal(context().ready,false);assert(context().loadError,'The failure is still recorded for cart, checkout and account pages');
 assert.deepEqual(toasts,[],'No error is laid over a page that is only being read');
 assert.equal(context().store.products.length,products.length,'The server-rendered catalog stays in place');
 assert.equal(gestureCount(),2,'One retry waits for the first pointer or key action');
 emit('pointerdown');assert.equal(gestureCount(),0,'The retry is armed once');await flush();host.render();
 assert.equal(stateReads,2);assert.equal(toasts.length,1,'A second failure after a real action is announced once');assert.match(toasts[0],/Saved cart/);
 emit('keydown');await flush();assert.equal(stateReads,2);assert.equal(toasts.length,1);
 // 2. The retry on the first action succeeds: the visitor never sees an error.
 let failing=true;stateFails=()=>failing;mount();await flush();host.render();assert.deepEqual(toasts,[]);assert.equal(gestureCount(),2);
 failing=false;emit('keydown');await flush();host.render();
 assert.equal(stateReads,2);assert.equal(context().ready,true);assert.equal(context().loadError,'');assert.deepEqual(toasts,[]);
 // 3. A first read that succeeds arms nothing.
 stateFails=()=>false;mount();await flush();host.render();assert.equal(context().ready,true);assert.equal(gestureCount(),0);assert.deepEqual(toasts,[]);
 // 4. Leaving the page before any action removes the pending retry.
 stateFails=()=>true;mount();await flush();assert.equal(gestureCount(),2);host.unmount();assert.equal(gestureCount(),0);host=null;
 console.log('PASS: actual StoreProvider keeps a failed first read quiet, retries once on the first visitor action, announces only a repeated failure, and cleans up. No network.');
})().catch(error=>{console.error(error);process.exit(1);});
