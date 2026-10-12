/* Isolated real component-state tests. No network, providers, credentials or customer fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const React = require(path.join(root, 'node_modules/react'));
let active;
const calls=[];
const hooks={...React,
  useState(initial){const host=active,i=host.cursor++;if(!(i in host.slots))host.slots[i]=typeof initial==='function'?initial():initial;return [host.slots[i],value=>{const next=typeof value==='function'?value(host.slots[i]):value;if(!Object.is(next,host.slots[i])){host.slots[i]=next;host.dirty=true;}}];},
  useEffect(fn,deps){const host=active,i=host.cursor++;const old=host.slots[i];if(!old||deps.some((value,index)=>!Object.is(old.deps[index],value))){if(old?.cleanup)old.cleanup();host.slots[i]={deps};host.effects.push(()=>{host.slots[i].cleanup=fn();});}},
};
function harness(component){const host={slots:[],cursor:0,effects:[],dirty:false,tree:null,render(){for(let n=0;n<20;n++){this.cursor=0;this.effects=[];this.dirty=false;active=this;this.tree=component();for(const effect of this.effects)effect();if(!this.dirty)return this.tree;}throw Error('Render loop');},unmount(){for(const slot of this.slots)if(slot?.cleanup)slot.cleanup();}};host.render();return host;}
function children(node){return typeof node?.type==='function'?node.type(node.props):node?.props?.children;}
function text(node){if(node==null||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(text).join(' ').replace(/\s+/g,' ').trim();if(typeof node!=='object')return String(node);return text(children(node));}
function nodes(node,out=[]){if(Array.isArray(node)){node.forEach(value=>nodes(value,out));return out;}if(node?.props){out.push(node);nodes(children(node),out);}return out;}
const find=(host,predicate)=>{const result=nodes(host.tree).find(predicate);assert(result,'Expected node not found');return result;};
const button=(host,label)=>find(host,node=>node.type==='button'&&text(node)===label);
const labelInput=(host,label)=>{const parent=find(host,node=>node.type==='label'&&text(node).startsWith(label));const result=nodes(parent).find(node=>node.type==='input'||node.type==='select');assert(result);return result;};
const type=(host,label,value)=>{labelInput(host,label).props.onChange({target:{value}});host.render();};
const submit=host=>{find(host,node=>node.type==='form').props.onSubmit({preventDefault(){}});host.render();};
const click=(host,label)=>{button(host,label).props.onClick();host.render();};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const resolve=async(call,value,host)=>{call.resolve(value);await tick();host.render();};
const reject=async(call,host)=>{call.reject(Error('Isolated failure'));await tick();host.render();};
global.fetch=()=>{throw Error('Network forbidden');};
const file=path.join(root,'components/store/change-history.tsx');
const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{
 if(id==='react')return hooks;
 if(id==='react/jsx-runtime')return require(path.join(root,'node_modules/react/jsx-runtime'));
 if(id==='./provider')return {api:(action,body)=>new Promise((resolve,reject)=>calls.push({action,body,resolve,reject}))};
 throw Error('Unexpected import '+id);
};
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);
const {ChangeHistory}=mod.exports;
const date=Date.parse('2026-10-12T12:34:56Z');
const event=(id,extra={})=>({id,occurredAt:date,recordedAt:date+1000,source:'admin',actor:'Staff fixture',actorType:'staff',action:'product_update',entityType:'product',entityId:'fixture-item',summary:'Fixture price updated',status:'succeeded',changes:[{field:'priceCents',before:10000,after:8500},{field:'preorder.enabled',before:null,after:true},{field:'Shipping price (cents)',before:1000,after:500}],...extra});
const coverage=[{source:'admin',label:'Store administration',state:'active',description:'Recorded changes from setup onward.',lastSyncedAt:date},{source:'cloudflare',label:'Hosting',state:'unavailable',description:'Provider history is not connected.'}];
const report=(events,nextCursor=null)=>({events,nextCursor,coverage,timeZone:'UTC'});
(async()=>{
 let host=harness(ChangeHistory);
 assert.equal(labelInput(host,'Search changes').props.maxLength,120);assert.equal(calls.length,1);assert.equal(calls[0].body,undefined);assert.equal(calls[0].action,'admin-changes?limit=50');
 assert(text(host.tree).includes('Loading change history'));assert(!text(host.tree).includes('No recorded changes match'));
 await resolve(calls[0],report([event('first'),event('second',{actor:'',actorType:'unknown',status:'observed',changes:[],evidenceUrl:'javascript:alert(1)',evidenceRef:'fixture-commit'})],'cursor /+'),host);
 assert(text(host.tree).includes('2 recorded entries loaded'));
 assert(text(host.tree).includes('Unknown actor'));assert(text(host.tree).includes('Actor not verified'));assert(text(host.tree).includes('Observed'));
 assert(text(host.tree).includes('$100.00'));assert(text(host.tree).includes('$85.00'));assert(text(host.tree).includes('$10.00'));assert(text(host.tree).includes('$5.00'));assert(text(host.tree).includes('Not set'));assert(text(host.tree).includes('Yes'));
 assert(text(host.tree).includes('Before and after values were not supplied'));
 assert(text(host.tree).includes('Provider history is not connected.'));assert(text(host.tree).includes('Unavailable'));
 assert(!nodes(host.tree).some(node=>node.type==='a'&&node.props.href?.startsWith('javascript:')));
 assert(text(host.tree).includes('2026-10-12 12:34:56 UTC'));
 // A time-display choice does not mutate the API date range or fetch data.
 type(host,'Display times','local');assert.equal(calls.length,1);assert(text(host.tree).includes('2026-10-12 12:34:56 UTC'));
 // Appended pages preserve the earlier events and discard duplicate IDs.
 click(host,'Load older changes');assert.equal(button(host,'Loading older changes…').props.disabled,true);
 const query=new URLSearchParams(calls.at(-1).action.split('?')[1]);assert.equal(query.get('before'),'cursor /+');
 await resolve(calls.at(-1),report([event('second'),event('third',{evidenceUrl:'https://github.com/thetaxfirm/biomodpeptides/commit/fixture'})],'more'),host);
 assert(text(host.tree).includes('3 recorded entries loaded'));assert.equal(nodes(host.tree).filter(node=>node.type==='li'&&node.props.className==='change-event').length,3);
 const link=find(host,node=>node.type==='a');assert.equal(link.props.rel,'noopener noreferrer');
 click(host,'Load older changes');await reject(calls.at(-1),host);
 assert(text(host.tree).includes('Older changes could not load'));assert(text(host.tree).includes('3 recorded entries loaded'));assert(!text(host.tree).includes('No recorded changes match'));
 click(host,'Retry loading changes');await resolve(calls.at(-1),report([event('fourth')]),host);
 assert(text(host.tree).includes('4 recorded entries loaded'));assert(!nodes(host.tree).some(node=>node.type==='button'&&text(node)==='Load older changes'));
 // Draft changes require explicit submission. Invalid dates never fire a request.
 const before=calls.length;type(host,'Search changes','  discount & price  ');type(host,'Source','github');type(host,'From (UTC)','2026-10-14');type(host,'Through (UTC)','2026-10-12');assert.equal(calls.length,before);
 submit(host);assert.equal(calls.length,before);assert(text(host.tree).includes('The start date must be on or before'));
 type(host,'From (UTC)','2026-10-10');submit(host);
 assert.equal(calls.length,before+1);const filters=new URLSearchParams(calls.at(-1).action.split('?')[1]);assert.equal(filters.get('q'),'discount & price');assert.equal(filters.get('source'),'github');assert.equal(filters.get('from'),'2026-10-10');assert.equal(filters.get('to'),'2026-10-12');assert.equal(filters.has('before'),false);
 assert(!text(host.tree).includes('Fixture price updated'));const stale=calls.at(-1);
 // A newer filter load supersedes an older request even if its response arrives late.
 click(host,'Clear filters');assert.equal(labelInput(host,'Search changes').props.value,'');const fresh=calls.at(-1);
 await resolve(fresh,report([event('current',{summary:'Current response'})]),host);
 await resolve(stale,report([event('stale',{summary:'Stale response'})]),host);
 assert(text(host.tree).includes('Current response'));assert(!text(host.tree).includes('Stale response'));
 // Refresh failure remains explicit, never substituted with an empty-success view.
 click(host,'Refresh changes');await reject(calls.at(-1),host);assert(text(host.tree).includes('Change history could not load'));assert(!text(host.tree).includes('No recorded changes match'));
 click(host,'Retry loading changes');await resolve(calls.at(-1),report([]),host);
 assert(text(host.tree).includes('No recorded changes match this view'));assert(text(host.tree).includes('partial or unavailable coverage'));assert(!text(host.tree).includes('Change history could not load'));
 // Unmounted components ignore eventual provider responses.
 click(host,'Refresh changes');const afterUnmount=calls.at(-1);host.unmount();await resolve(afterUnmount,report([event('late',{summary:'Unmounted response'})]),host);assert(!text(host.tree).includes('Unmounted response'));
 console.log('PASS: change history loading, coverage gaps, before/after, unknown actor, safe evidence links, UTC/local display, submitted filters and date validation, encoded cursor pagination, duplicate suppression, retained rows on page failure, retry, stale-request and unmount guards. Isolated GET-only mocks.');
})().catch(error=>{console.error(error);process.exitCode=1;});
