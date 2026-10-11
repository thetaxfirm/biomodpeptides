/* Actual collector/dashboard hooks and pure navigation helpers, with isolated browser and
 * report fixtures. No production requests, cookies, storage, orders or injected metrics. */
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
  useState(initial) { const host=active,i=host.cursor++;if(!(i in host.slots))host.slots[i]=typeof initial==='function'?initial():initial;return [host.slots[i],value=>{const next=typeof value==='function'?value(host.slots[i]):value;if(!Object.is(next,host.slots[i])){host.slots[i]=next;host.dirty=true;}}]; },
  useEffect(fn,deps) { const host=active,i=host.cursor++,previous=host.slots[i];if(!previous||deps.some((v,n)=>!Object.is(previous[n],v))){host.slots[i]=deps;host.effects.push(()=>{host.cleanups[i]?.();host.cleanups[i]=fn();});} },
};
function harness(component) {
  const host={slots:[],cleanups:[],cursor:0,effects:[],dirty:false,tree:null,render(){for(let n=0;n<20;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=component();for(const fn of this.effects)fn();if(!this.dirty)return this.tree;}throw Error('render loop');},unmount(){for(const fn of this.cleanups)fn?.();}};
  host.render();return host;
}
function load(relative,dependencies={}) {
  const filename=path.join(root,relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
  mod.require=id=>{if(Object.prototype.hasOwnProperty.call(dependencies,id))return dependencies[id];if(id==='react')return hooks;if(id==='react/jsx-runtime')return require('react/jsx-runtime');throw Error('Unexpected import '+id);};
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);return mod.exports;
}
function nodes(tree,out=[]) {if(Array.isArray(tree)){tree.forEach(x=>nodes(x,out));return out;}if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
function text(tree) {if(tree==null||typeof tree==='boolean')return '';if(Array.isArray(tree))return tree.map(text).join(' ').replace(/\s+/g,' ').trim();if(typeof tree!=='object')return String(tree);return text(tree.props?.children);}
const find=(host,predicate)=>{const node=nodes(host.tree).find(predicate);assert(node,'expected node is present');return node;};

const {ShoppingDiagnostics}=load('components/store/shopping-diagnostics.tsx',{
  '@/components/ui/table':Object.fromEntries(['Table','TableHeader','TableBody','TableRow','TableHead','TableCell'].map(name=>[name,name])),
  './traffic-diagnostics.module.css':{},
});
const stages=['cart_add_confirmed','cart_view','checkout_signin_view','checkout_form_view','delivery_quote_confirmed','checkout_handoff_ready'];
const day={date:'2026-10-09',events:21,capReached:false,byStage:stages.map((stage,i)=>({stage,events:i+1}))};
const report={asOf:'2026-10-10T12:00:00Z',status:'available',configuration:{enabled:true,reason:'enabled',startedAt:'2026-10-08T12:00:00Z'},window:{requestedDays:7,timeZone:'UTC',start:'2026-10-08',endExclusive:'2026-10-10',retainedFrom:'2026-07-13'},completedDays:[day],activationDayPartial:{...day,date:'2026-10-08',events:3},partialToday:{...day,date:'2026-10-10',events:2},totals:{events:21,byStage:day.byStage},cap:{dailyLimit:50000,daysReached:[]},cleanup:{lastAttemptAt:'2026-10-10T12:00:00Z',lastSuccessAt:'2026-10-10T12:00:00Z',lastFailureAt:null,status:'ok',retentionDays:90},limitations:['View stages and confirmed actions are independent counts.']};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
let requests=[],response=report;
const originalFetch=global.fetch;
(async()=>{
 try{
  global.fetch=(url,options)=>{assert.equal(url.startsWith('/api/metrics/shopping-report?days='),true);requests.push({url,options});return Promise.resolve({ok:true,json:async()=>response});};
  let host=harness(ShoppingDiagnostics);assert(text(host.tree).includes('Loading shopping-stage diagnostics'));await flush();host.render();
  assert.equal(requests[0].url,'/api/metrics/shopping-report?days=7');assert.equal(requests[0].options.credentials,'same-origin');assert.equal(requests[0].options.method,'GET');
  assert(text(host.tree).includes('Shopping collection: Enabled'));assert(text(host.tree).includes('2026-10-03 through 2026-10-09'));assert(text(host.tree).includes('Coverage is shorter'));
  for(const name of ['Cart additions confirmed','Cart views','Checkout sign-in screens','Checkout forms shown','Delivery quotes confirmed','Payment handoffs ready'])assert(text(host.tree).includes(name));
  assert(text(host.tree).includes('not payment confirmation'));assert(text(host.tree).includes('not linked to individual shoppers'));assert(text(host.tree).includes('Partial days, excluded from period totals'));
  assert(!text(host.tree).includes('%'));assert(!text(host.tree).includes('sales made'));assert(text(host.tree).includes('not proof of no activity'));
  for(const period of ['30','90']){
    response={...report,window:{...report.window,requestedDays:Number(period)}};find(host,node=>node.type==='select').props.onChange({target:{value:period}});host.render();
    assert(!text(host.tree).includes('Cart additions confirmed'),'Previous window is cleared before reloading');await flush();host.render();assert.equal(requests.at(-1).url,'/api/metrics/shopping-report?days='+period);
  }
  host.unmount();assert.equal(requests.at(-1).options.signal.aborted,true);
  response={...report,configuration:{enabled:false,reason:'flag_disabled',startedAt:report.configuration.startedAt}};host=harness(ShoppingDiagnostics);await flush();host.render();assert(text(host.tree).includes('Shopping collection: Disabled'));assert(text(host.tree).includes('Cart additions confirmed'),'Paused collection retains measured history');host.unmount();
  response={...report,completedDays:[],totals:{events:null,byStage:[]},activationDayPartial:null};host=harness(ShoppingDiagnostics);await flush();host.render();assert(text(host.tree).includes('No complete measured UTC days'));assert(!nodes(host.tree).some(node=>node.type==='p'&&text(node).startsWith('0 complete days')));host.unmount();
  response={...report,status:'unavailable',configuration:{enabled:false,reason:'start_missing_or_invalid',startedAt:null},completedDays:[],totals:{events:null,byStage:[]},activationDayPartial:null,partialToday:null,cleanup:{...report.cleanup,status:'failed'}};
  host=harness(ShoppingDiagnostics);await flush();host.render();assert(text(host.tree).includes('Shopping-stage data is unavailable'));assert(text(host.tree).includes('Limit status is unavailable'));assert(text(host.tree).includes('Retention cleanup needs attention'));assert(!text(host.tree).includes('Cart additions confirmed'));host.unmount();
  let failed=true;response=report;global.fetch=(url,options)=>{requests.push({url,options});return Promise.resolve(failed?{ok:false,status:503}:{ok:true,json:async()=>response});};
  host=harness(ShoppingDiagnostics);await flush();host.render();assert(text(host.tree).includes('Totals are unavailable'));assert(nodes(host.tree).some(node=>node.props.role==='alert'));
  failed=false;find(host,node=>node.type==='button'&&text(node).includes('Refresh shopping stages')).props.onClick();host.render();assert(text(host.tree).includes('Loading shopping-stage diagnostics'));await flush();host.render();assert(text(host.tree).includes('Cart additions confirmed'));host.unmount();
  // Late responses cannot overwrite a newly selected period or an unmounted component.
  let resolveOld;global.fetch=()=>new Promise(resolve=>{resolveOld=resolve;});host=harness(ShoppingDiagnostics);
  global.fetch=async()=>({ok:true,json:async()=>({...report,window:{...report.window,requestedDays:30}})});
  find(host,node=>node.type==='select').props.onChange({target:{value:'30'}});host.render();await flush();host.render();
  resolveOld({ok:true,json:async()=>({...report,configuration:{...report.configuration,enabled:false}})});await flush();host.render();assert(text(host.tree).includes('Shopping collection: Enabled'));assert(!text(host.tree).includes('Shopping collection: Disabled'));host.unmount();
  console.log('PASS: actual shopping dashboard protected GET, six exact event meanings, separate UTC periods/partial days, independent stages without conversion ratios, unavailable/paused/cleanup-error states, refresh recovery and late-response guards. Isolated fixtures only.');
 }finally{global.fetch=originalFetch;}
})().catch(error=>{console.error(error);process.exitCode=1;});
