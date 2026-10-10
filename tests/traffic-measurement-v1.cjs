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
const shared=load('lib/traffic-metrics.ts');
const helpers=load('lib/traffic-navigation.ts');
let pathname='/',search='',storeState,props,requests,frames,frameId,observers;
function fresh(options={}) {
  pathname=options.pathname||'/';search=options.search||'';requests=[];frames=new Map();frameId=0;observers=new Set();
  storeState={ready:true,loadError:'',store:{admin:false},...options.storeState};
  props={enabled:true,reviewedProductSlugs:['reviewed-vial'],...options.props};
  const listeners=new Map();
  const doc={visibilityState:'visible',referrer:'https://www.google.com/search?q=private-query',body:{},marker:pathname,
    querySelector(selector){assert.equal(selector,'main[data-traffic-path]');return this.marker===null?null:{getAttribute:key=>{assert.equal(key,'data-traffic-path');return this.marker;}};},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},emit(name){for(const fn of [...(listeners.get(name)||[])])fn();},
  };
  Object.defineProperty(doc,'cookie',{get(){throw Error('Collector must not read cookies');},set(){throw Error('Collector must not write cookies');}});
  global.document=doc;
  global.window={location:{origin:'https://trybiomod.com',pathname,search},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)};
  Object.defineProperty(window,'localStorage',{get(){throw Error('Collector must not use storage');}});
  Object.defineProperty(window,'sessionStorage',{get(){throw Error('Collector must not use storage');}});
  Object.defineProperty(global,'navigator',{configurable:true,value:{globalPrivacyControl:false,doNotTrack:null,webdriver:false}});
  global.MutationObserver=class { constructor(fn){this.fn=fn;} observe(){observers.add(this);} disconnect(){observers.delete(this);} };
  global.fetch=(url,options)=>{requests.push({url,options});return Promise.resolve({status:204,ok:true});};
}
function paint() {const current=[...frames.values()];frames.clear();for(const fn of current)fn();}
function mutate(){for(const observer of [...observers])observer.fn();}
function navigate(host,next,query=''){pathname=next;search=query;window.location.pathname=next;window.location.search=query;document.marker=next;host.render();paint();}
const {TrafficMeasurement}=load('components/store/traffic-measurement.tsx',{'next/navigation':{usePathname:()=>pathname,useSearchParams:()=>new URLSearchParams(search)},'@/lib/traffic-metrics':shared,'@/lib/traffic-navigation':helpers,'./provider':{useStore:()=>storeState}});
const mount=()=>harness(()=>TrafficMeasurement(props));
const payloads=()=>requests.map(request=>JSON.parse(request.options.body));
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

(async()=>{
  assert.equal(helpers.trafficPageGroup('/',[]),'home');
  for(const route of ['/shop','/softgels','/multi-pack','/presales'])assert.equal(helpers.trafficPageGroup(route,[]),'catalog');
  assert.equal(helpers.trafficPageGroup('/product/reviewed-vial',['reviewed-vial']),'product');
  for(const route of ['/product/unreviewed','/product/reviewed-vial/','/product/reviewed-vial%2F','/product/reviewed-vial/extra','/testing/private-lot','/404','/unknown','/admin','/account/profile','/cart','/checkout','/login','/register','/forgot-password','/reset-password','/api/metrics','/payment/return','/preview','/about-biomod','/coa','/__proto__'])assert.equal(helpers.trafficPageGroup(route,['reviewed-vial']),null,route);
  const groups=new Set(['/','/shop','/product/reviewed-vial','/testing','/faq','/about','/locations','/contact','/privacy-policy'].map(route=>helpers.trafficPageGroup(route,['reviewed-vial'])));
  assert.deepEqual([...groups].sort(),[...shared.TRAFFIC_PAGE_GROUPS].sort());
  // Explicit host/subdomain matching never mistakes an arbitrary substring for a referrer category.
  for(const [url,expected] of [
    ['https://www.google.com/search?q=hidden','search'],['https://www.google.co.uk/','search'],['https://gemini.google.com/app','ai'],['https://chatgpt.com/c/private-thread','ai'],['https://chat.openai.com/','ai'],['https://www.perplexity.ai/','ai'],['https://m.facebook.com/x','social'],['https://t.co/private','social'],['https://trybiomod.com/shop?private=x','internal'],
    ['https://google.com.evil.example/','external_other'],['https://notgoogle.com/','external_other'],['https://chatgpt.com.evil.example/','external_other'],['https://example.com/google.com','external_other'],['https://trybiomod.com.evil.example/','external_other'],['','direct_or_unavailable'],['not a URL','direct_or_unavailable'],['javascript:alert(1)','direct_or_unavailable'],['https://user:pass@google.com/','direct_or_unavailable']])assert.equal(helpers.trafficSourceGroup(url,shared.TRAFFIC_ORIGIN),expected,url);

  fresh({storeState:{ready:false}});let host=mount();paint();assert.equal(requests.length,0,'Wait for store readiness before identifying administrators');
  storeState.ready=true;document.marker='/old-page';host.render();paint();assert.equal(requests.length,0,'A stale route is not a completed page view');
  document.marker='/';mutate();paint();assert.equal(requests.length,1);assert.deepEqual(payloads()[0],{event:'page_view',pageGroup:'home',sourceGroup:'search'});
  assert.equal(requests[0].url,'/api/metrics');assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.referrerPolicy,'no-referrer');assert.equal(requests[0].options.cache,'no-store');assert.equal(requests[0].options.method,'POST');
  assert.deepEqual(requests[0].options.headers,{'Content-Type':'application/json'});assert(shared.validTrafficEvent(payloads()[0]));assert(!requests[0].options.body.includes('private-query'));
  host.render();paint();window.location.hash='#home-vials';host.render();paint();navigate(host,'/','?q=do-not-send');host.render();paint();assert.equal(requests.length,1,'Rerenders, query and hash-only navigation do not duplicate a view');
  host.unmount();host=mount();paint();assert.equal(requests.length,1,'Remount/StrictMode shares document-scoped deduplication');
  navigate(host,'/shop');assert.deepEqual(payloads()[1],{event:'page_view',pageGroup:'catalog',sourceGroup:'internal'});
  navigate(host,'/admin');assert.equal(requests.length,2);navigate(host,'/product/reviewed-vial');assert.equal(requests.length,3);assert.equal(payloads()[2].sourceGroup,'internal');
  navigate(host,'/product/not-reviewed');assert.equal(requests.length,3);navigate(host,'/');assert.equal(requests.length,4,'Returning to an earlier page after real navigation is a new view');host.unmount();

  fresh({pathname:'/admin'});host=mount();paint();navigate(host,'/shop');assert.equal(payloads()[0].sourceGroup,'internal','An initial private route never re-credits its initial external referrer on later public navigation');host.unmount();
  fresh();document.visibilityState='hidden';host=mount();paint();assert.equal(requests.length,0);navigate(host,'/shop');navigate(host,'/about');assert.equal(requests.length,0);document.visibilityState='visible';document.emit('visibilitychange');paint();assert.deepEqual(payloads(),[{event:'page_view',pageGroup:'about',sourceGroup:'internal'}]);document.emit('visibilitychange');paint();assert.equal(requests.length,1);host.unmount();
  fresh();document.marker=null;host=mount();paint();assert.equal(requests.length,0,'Errors, not-found, loading shells and absent success marker are excluded');document.marker='/';mutate();paint();assert.equal(requests.length,1);host.unmount();
  fresh();host=mount();window.location.pathname='/uncommitted';paint();assert.equal(requests.length,0,'URL/committed-route mismatch is not counted');host.unmount();
  fresh();global.fetch=(url,options)=>{requests.push({url,options});return Promise.reject(Error('Isolated offline fixture'));};host=mount();paint();await flush();host.render();document.emit('visibilitychange');mutate();paint();assert.equal(requests.length,1,'Failed delivery is never retried');host.unmount();host=mount();paint();assert.equal(requests.length,1);host.unmount();

  for(const exclusion of ['disabled','admin','gpc','dnt','legacy-dnt','webdriver','load-error','preview','http','www']){
    fresh();if(exclusion==='disabled')props.enabled=false;if(exclusion==='admin')storeState.store.admin=true;if(exclusion==='gpc')navigator.globalPrivacyControl=true;if(exclusion==='dnt')navigator.doNotTrack='1';if(exclusion==='legacy-dnt')window.doNotTrack='1';if(exclusion==='webdriver')navigator.webdriver=true;if(exclusion==='load-error')storeState.loadError='Store unavailable';if(exclusion==='preview')window.location.origin='https://preview.workers.dev';if(exclusion==='http')window.location.origin='http://trybiomod.com';if(exclusion==='www')window.location.origin='https://www.trybiomod.com';host=mount();paint();assert.equal(requests.length,0,exclusion);host.unmount();
  }
  fresh({search:'?measurement=off&utm_source=do-not-send'});host=mount();paint();navigate(host,'/shop');host.unmount();host=mount();paint();assert.equal(requests.length,0,'QA opt-out persists across route changes and remounts in this document without storage');host.unmount();
  fresh();host=mount();window.location.search='?measurement=off';paint();assert.equal(requests.length,0,'Late query-only opt-out is checked again at dispatch');navigate(host,'/about');assert.equal(requests.length,0);host.unmount();
  fresh();host=mount();navigator.globalPrivacyControl=true;paint();assert.equal(requests.length,0,'GPC checked again immediately before dispatch');host.unmount();

  // Actual protected dashboard: fetch failures and missing history remain unavailable, never fabricated zero counts.
  const table=Object.fromEntries(['Table','TableHeader','TableBody','TableRow','TableHead','TableCell'].map(name=>[name,name]));
  const {TrafficDiagnostics}=load('components/store/traffic-diagnostics.tsx',{'@/components/ui/table':table,'./traffic-diagnostics.module.css':{}});
  const day={date:'2026-10-09',events:5,capReached:false,byPageGroup:[{pageGroup:'home',events:5}],bySourceGroup:[{sourceGroup:'search',events:5}]};
  const report={asOf:'2026-10-10T12:00:00Z',status:'available',configuration:{enabled:true,reason:'enabled',startedAt:'2026-10-08T12:00:00Z'},window:{requestedDays:7,timeZone:'UTC',start:'2026-10-08',endExclusive:'2026-10-10',retainedFrom:'2026-07-13'},completedDays:[day],activationDayPartial:{...day,date:'2026-10-08',events:3},partialToday:{...day,date:'2026-10-10',events:2},totals:{events:5,byPageGroup:day.byPageGroup,bySourceGroup:day.bySourceGroup},cap:{dailyLimit:50000,daysReached:[]},cleanup:{lastAttemptAt:'2026-10-10T12:00:00Z',lastSuccessAt:'2026-10-10T12:00:00Z',lastFailureAt:null,status:'ok',retentionDays:90},limitations:['Opted-out and blocked-script visits are excluded.']};
  let response=report;requests=[];global.fetch=(url,options)=>{requests.push({url,options});return Promise.resolve({ok:true,json:async()=>response});};
  host=harness(TrafficDiagnostics);assert(text(host.tree).includes('Loading traffic diagnostics'));await flush();host.render();
  assert.equal(requests[0].url,'/api/metrics/report?days=7');assert.equal(requests[0].options.credentials,'same-origin');assert.equal(requests[0].options.method,'GET');
  assert(text(host.tree).includes('5 accepted page-view events'));assert(!text(host.tree).includes('10 accepted page-view events'),'Partial days are not rolled into period total');assert(text(host.tree).includes('Coverage is shorter'));assert(text(host.tree).includes('2026-10-03 through 2026-10-09'));assert(text(host.tree).includes('Partial days, excluded from period totals'));
  const change=find(host,node=>node.type==='select').props.onChange;response={...report,window:{...report.window,requestedDays:30}};change({target:{value:'30'}});host.render();assert(!text(host.tree).includes('5 accepted page-view events'),'Old reporting window is not shown during a refresh');await flush();host.render();assert.equal(requests.at(-1).url,'/api/metrics/report?days=30');host.unmount();
  response={...report,window:{...report.window,start:'2026-10-10'},configuration:{enabled:false,reason:'flag_disabled',startedAt:null},completedDays:[],activationDayPartial:null,partialToday:null,totals:{events:null,byPageGroup:[],bySourceGroup:[]}};host=harness(TrafficDiagnostics);await flush();host.render();assert(text(host.tree).includes('Collection: Disabled'));assert(text(host.tree).includes('No complete measured UTC days'));assert(text(host.tree).includes('2026-10-03 through 2026-10-09'),'Requested dates remain ordered even when clipped coverage begins today');assert(!text(host.tree).includes('0 accepted page-view events'));host.unmount();
  global.fetch=async()=>({ok:false,status:503,json:async()=>({error:'Unavailable'})});host=harness(TrafficDiagnostics);await flush();host.render();assert(text(host.tree).includes('Totals are unavailable'));assert(!text(host.tree).includes('accepted page-view events across'));assert(nodes(host.tree).some(node=>node.props.role==='alert'));host.unmount();
  global.fetch=async()=>({ok:true,json:async()=>({...report,status:'unavailable',totals:{events:null,byPageGroup:[],bySourceGroup:[]},cleanup:{...report.cleanup,status:'failed',lastSuccessAt:null}})});host=harness(TrafficDiagnostics);await flush();host.render();assert(text(host.tree).includes('Traffic data is unavailable'));assert(text(host.tree).includes('Limit status is unavailable'));assert(!text(host.tree).includes('No reported measured day has reached')); assert(text(host.tree).includes('Retention cleanup needs attention'));assert(!text(host.tree).includes('5 accepted page-view events'));host.unmount();
  console.log('PASS: actual collector readiness, successful-route markers, visible completed navigation, strict coarse payload, omitted credentials/referrer, all opt-outs, privacy checks, private/error/unreviewed-route exclusion, remount/query/hash deduplication, internal later navigation and no retry; actual dashboard complete UTC periods, partial-day separation, unavailable/disabled/cleanup states and protected GET. Isolated fixtures only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
