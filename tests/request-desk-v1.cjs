/* Actual reply desk component and hooks over conspicuous synthetic fixtures.
 * No network, production records, status API, mail client or email providers. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),projectRequire=Module.createRequire(path.join(root,'package.json'));
const ts=projectRequire('typescript'),React=projectRequire('react'),{renderToStaticMarkup}=projectRequire('react-dom/server');
let active=null;
const hooks={...React,
 useState(initial){if(!active)return React.useState(initial);const host=active,index=host.cursor++;if(!(index in host.slots))host.slots[index]=typeof initial==='function'?initial():initial;return[host.slots[index],value=>{const next=typeof value==='function'?value(host.slots[index]):value;if(next!==host.slots[index]){host.changed=true;host.writes++;}host.slots[index]=next;}];},
 useRef(initial){if(!active)return React.useRef(initial);const host=active,index=host.cursor++;if(!(index in host.slots))host.slots[index]={current:initial};return host.slots[index];},
 useEffect(effect,deps){if(!active)return React.useEffect(effect,deps);const host=active,index=host.cursor++,prior=host.slots[index];if(!prior||deps.some((value,i)=>value!==prior.deps[i])){host.slots[index]={deps,cleanup:prior?.cleanup};host.effects.push(()=>{host.slots[index].cleanup?.();host.slots[index].cleanup=effect();});}}
};
const issuesLib=(()=>{const f=path.join(root,'lib/request-issues.ts'),m=new Module(f,module);m.filename=f;m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,f);return m.exports;})();
const filename=path.join(root,'components/store/request-inbox.tsx'),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{if(id==='@/lib/request-issues')return issuesLib;if(id==='react')return hooks;if(id==='react/jsx-runtime')return projectRequire(id);if(id.endsWith('.module.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};throw Error('Unexpected dependency: '+id);};
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {RequestInbox}=mod.exports;
global.fetch=()=>{throw Error('Live I/O forbidden');};
function nodes(tree,out=[]){if(Array.isArray(tree))tree.forEach(item=>nodes(item,out));else if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(Array.isArray(tree))return tree.map(text).join(' ').replace(/\s+/g,' ').trim();return typeof tree==='object'?text(tree.props?.children):String(tree);}
function mount(props){const host={props,slots:[],cursor:0,tree:null,effects:[],changed:false,writes:0,render(){let iterations=0;do{assert(++iterations<10,'Render settles');this.cursor=0;this.effects=[];this.changed=false;active=this;try{this.tree=RequestInbox(this.props);}finally{active=null;}this.effects.forEach(effect=>effect());}while(this.changed);return this.tree;},unmount(){this.slots.forEach(slot=>slot?.cleanup?.());}};host.render();return host;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const render=props=>renderToStaticMarkup(React.createElement(RequestInbox,props));
const controls=(tree,label)=>nodes(tree).filter(node=>node.type==='button'&&text(node)===label);
const button=(tree,label)=>{const found=controls(tree,label)[0];assert(found,'Expected button '+label);return found;};
const cards=host=>nodes(host.tree).filter(node=>node.type==='article');
const ids=host=>cards(host).map(node=>node.key);
const card=(host,id)=>{const found=cards(host).find(node=>node.key===id);assert(found,'Expected request '+id);return found;};
function filter(host,label){const node=nodes(host.tree).find(node=>node.type==='button'&&text(node).startsWith(label+' '));assert(node,label);node.props.onClick();host.render();}
function query(host,value){nodes(host.tree).find(node=>node.type==='input'&&node.props.type==='search').props.onChange({target:{value}});host.render();}
const request=(id,status='new',kind='contact',data={})=>({id,kind,status,created:Date.parse('2026-10-11T08:00:00Z'),data:{name:'Fixture '+id,email:id+'@example.invalid',subject:'Question '+id,message:'Synthetic request body only',...data}});
const status=(value,extra={})=>({status:value,reason:'fixture',acceptedAt:null,canProcess:false,productName:'Fixture material',strength:'10 mg',lot:'QA-LOT',reportId:'QA-ORIGINAL',...extra});
const requests=[request('accepted'),request('duplicate'),request('review'),request('ordinary'),request('partner','resolved','affiliate',{website:'https://example.invalid/partner'}),request('vendor','spam','contact',{message:'Supplier catalog offer'}),request('progress','in_progress'),request('stock','reviewed','stock')];
const automation={config:{enabled:true,replyTo:'owner@example.invalid',notifyTo:'owner@example.invalid'},mailConfigured:true,sender:'sender@example.invalid',requests:{accepted:{coa:status('accepted',{canProcess:true}),alert:null},duplicate:{coa:status('duplicate',{canProcess:true,relatedStatus:'accepted'}),alert:null},review:{coa:status('manual_review',{canProcess:true}),alert:null},ordinary:{coa:null,alert:status('accepted')}}};
function reply(id,extra={}){return {id:'job-'+id,requestId:id,revision:1,status:'queued',mode:'ai',sender:'research@biomodpeptides.com',recipient:id+'@example.invalid',subject:'Re: Question '+id,body:'',preparedBy:'synthetic-staff@example.invalid',updated:Date.parse('2026-10-14T08:00:00Z'),coa:{state:'not_requested',reason:'No original COA requested.'},history:[],...extra};}
const field=(host,name)=>{const node=nodes(host.tree).find(n=>n.type==='textarea'&&n.props.name===name);assert(node,'Expected '+name);return node;};
const type=(host,name,value)=>{field(host,name).props.onChange({target:{value}});host.render();};
const flush=async host=>{for(let i=0;i<4;i++)await Promise.resolve();host.render();};
const openRow=(host,id)=>{nodes(host.tree).find(n=>n.type==='button'&&n.props['aria-controls']==='request-reply-'+id).props.onClick();host.render();};
const select=(host,label)=>nodes(host.tree).find(n=>n.type==='label'&&text(n).startsWith(label)).props.children[1];
const options={team:[{email:'logan@example.invalid',name:'Logan',role:'manager'}],links:[{label:'Fixture material 10 mg · lot QA-LOT',url:'https://trybiomod.com/testing/QA-LOT?product=1'}],coas:[{sha256:'a'.repeat(64),productName:'Fixture material',strength:'10 mg',form:'vial',lot:'QA-LOT',reportId:'QA-ORIGINAL',current:true}],codes:[{code:'BM10',percentOff:10}],rules:[{id:'00000000-0000-4000-8000-000000000001',rule:'Sign off as Ash'}],learning:{recent:4,unchanged:3},bridgeSeen:null};
async function main(){
 const day=86400000,now=Date.now();
 const reqs=[request('new-old','new'),request('new-young','new'),request('answered','in_progress'),request('closed','resolved'),request('junk','spam'),request('came-back','resolved')];
 reqs[0].created=now-3*day;reqs[1].created=now-3600000;
 const out=(id,at)=>({id:'out-'+id,direction:'outgoing',body:'Our reply',created:at});
 const replies={answered:reply('answered',{status:'sent',history:[{id:'original:answered',direction:'incoming',body:'Q',created:0},out('answered',now-day)]}),
  'came-back':reply('came-back',{status:'sent',history:[{id:'o',direction:'incoming',body:'Q',created:0},out('came-back',now-2*day),{id:'in',direction:'incoming',body:'One more question',created:now-day}]})};
 let preparations=[],changes=[];
 const props={requests:reqs,requestReplies:replies,busy:false,dirty:false,refreshing:false,canSend:true,onStatus:(r,s)=>changes.push([r.id,s]),onPrepareReply:async input=>{preparations.push(input);return reply(input.id,{revision:(input.expectedRevision||0)+1,mode:input.mode,body:input.body||'',status:'queued',approvedAt:input.send?now:undefined});},onLoadOptions:async()=>options,onSaveRule:async input=>{preparations.push({rule:input});return options;}};
 let host=mount(props);await flush(host);
 // To reply: oldest first; a customer reply after a resolved thread comes back; answered threads wait.
 const rowIds=()=>nodes(host.tree).filter(n=>n.type==='article').map(n=>n.key);
 assert.deepEqual(rowIds(),['new-old','came-back','new-young']);
 assert(text(host.tree).includes('waiting 3 days'),'Waiting time is spelled out');assert(text(host.tree).includes('then they wrote again'));
 filter(host,'Replied & archive');assert.deepEqual(rowIds().sort(),['answered','closed'],'Replied and archived requests share the Archive');
 openRow(host,'answered');assert(text(host.tree).includes('Activity ('));assert(text(host.tree).includes('Received from the website'));openRow(host,'answered');
 filter(host,'Spam');assert.deepEqual(rowIds(),['junk']);
 filter(host,'Needs reply');query(host,'NEW-YOUNG@EXAMPLE');assert.deepEqual(rowIds(),['new-young']);query(host,'');
 assert(text(host.tree).includes('3 of the last 4'),'Learning progress is visible');
 // Opening a conversation never sends; it shows the thread, pickers and an owner Send.
 openRow(host,'new-old');assert.equal(preparations.length,0);
 assert(text(host.tree).includes('Synthetic request body only'));assert(text(host.tree).includes('research@biomodpeptides.com'));
 assert.equal(field(host,'replyBody').props.maxLength,12000);
 const send=()=>nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Send');assert(send(),'Owner sees Send');assert.equal(send().props.disabled,true,'Empty reply cannot be sent');
 // Codes insert into the draft; the COA picker stages a chosen original.
 type(host,'replyBody','Hi there, use');select(host,'Insert code').props.onChange({target:{value:'BM10'}});host.render();
 assert.equal(field(host,'replyBody').props.value,'Hi there, use code BM10 (10% off at checkout)');
 type(host,'replyBody','');select(host,'Insert COA link').props.onChange({target:{value:'https://trybiomod.com/testing/QA-LOT?product=1'}});host.render();assert.equal(field(host,'replyBody').props.value,'COA for Fixture material 10 mg · lot QA-LOT: https://trybiomod.com/testing/QA-LOT?product=1');
 type(host,'replyBody','Hi there, use code BM10 (10% off at checkout)');
 select(host,'Attach COA').props.onChange({target:{value:'a'.repeat(64)}});host.render();assert(text(host.tree).includes('Will attach when you save or send'));
 // AI rewrite carries the current draft and the dictated instruction; remember saves a rule first.
 type(host,'replyInstruction','um make it friendlier');
 nodes(host.tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});host.render();
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Rewrite').props.onClick();await flush(host);
 assert.deepEqual(preparations[0],{rule:{rule:'um make it friendlier'}});
 assert.deepEqual(preparations[1],{id:'new-old',mode:'ai',body:'Hi there, use code BM10 (10% off at checkout)',instruction:'um make it friendlier',expectedRevision:null,coaSha256:'a'.repeat(64)});
 assert(text(host.tree).includes('AI is writing'));assert.equal(field(host,'replyBody').props.readOnly,true);
 type(host,'replyBody','ignored while writing');assert.equal(field(host,'replyBody').props.value,'Hi there, use code BM10 (10% off at checkout)');
 // The finished AI draft replaces the text, with undo back to what was there.
 host.props.requestReplies={...replies,'new-old':reply('new-old',{revision:1,status:'ready',body:'Hello! Use code BM10 for 10% off.',updated:Date.parse('2026-10-15T08:00:00Z')})};host.render();
 assert.equal(field(host,'replyBody').props.value,'Hello! Use code BM10 for 10% off.');
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Undo AI change').props.onClick();host.render();assert.equal(field(host,'replyBody').props.value,'Hi there, use code BM10 (10% off at checkout)');
 // Send is one click and one request, marked as an owner send of exactly this text.
 send().props.onClick();send().props.onClick();await flush(host);
 const sends=preparations.filter(p=>p.send);assert.equal(sends.length,1,'Double click sends once');
 assert.deepEqual(sends[0],{id:'new-old',mode:'staff',body:'Hi there, use code BM10 (10% off at checkout)',instruction:'',expectedRevision:1,coaSha256:'a'.repeat(64),send:true});
 assert(text(host.tree).includes('Queued to send'));
 // Staff without send rights only save drafts.
 host=mount({...props,canSend:false});await flush(host);openRow(host,'new-young');
 assert(!nodes(host.tree).some(n=>n.type==='button'&&text(n)==='Send'));assert(text(host.tree).includes('Ash sends replies'));
 // Failed preparation is plain English and keeps the request in To reply.
 host=mount({...props,requestReplies:{'new-young':reply('new-young',{status:'needs_review',reason:'bridge_preparation_failed'})}});await flush(host);openRow(host,'new-young');
 assert(text(host.tree).includes('The AI could not finish this draft. Nothing was sent.'));assert(!text(host.tree).includes('bridge_preparation_failed'));
 // Status actions, and no live I/O anywhere.
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Archive').props.onClick();assert.deepEqual(changes.at(-1),['new-young','resolved']);
 // Delete asks first, moves to Deleted (not All), and Restore brings it back. Forward goes only to a chosen team member.
 const fwd=[];host=mount({...props,requests:[...reqs,request('gone','deleted')],requestReplies:{},onForward:async input=>{fwd.push(input);return {id:'f1',to:input.to,by:'owner@example.invalid',note:input.note,status:'accepted',created:now};}});
 await flush(host);
 filter(host,'All');assert(!rowIds().includes('gone'),'Deleted requests leave All');filter(host,'Deleted');assert.deepEqual(rowIds(),['gone']);
 openRow(host,'gone');nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Restore').props.onClick();assert.deepEqual(changes.at(-1),['gone','new']);
 filter(host,'Needs reply');openRow(host,'new-old');
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Delete').props.onClick();host.render();
 const before=changes.length;assert(text(host.tree).includes('It moves to Deleted'));assert.equal(changes.length,before,'Delete asks before acting');
 nodes(host.tree).filter(n=>n.type==='button'&&text(n)==='Delete').at(-1).props.onClick();assert.deepEqual(changes.at(-1),['new-old','deleted']);
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Forward').props.onClick();host.render();
 const sel=nodes(host.tree).find(n=>n.type==='select'&&nodes(n).some(o=>o.type==='option'&&text(o).includes('team member')));
 assert(text(sel).includes('logan@example.invalid'));sel.props.onChange({target:{value:'logan@example.invalid'}});host.render();
 field(host,'forwardNote').props.onChange({target:{value:'Please check the order'}});host.render();
 nodes(host.tree).filter(n=>n.type==='button'&&text(n)==='Forward').at(-1).props.onClick();await flush(host);
 assert.deepEqual(fwd,[{id:'new-old',to:'logan@example.invalid',note:'Please check the order'}]);assert(text(host.tree).includes('Forwarded to logan@example.invalid'));

 // A refreshed unresolved forward is not described as forwarded in the actual component.
 const savedDocument=global.document,savedSetTimeout=global.setTimeout,savedClearTimeout=global.clearTimeout,ticks=[];
 global.document={visibilityState:'visible'};global.setTimeout=fn=>{ticks.push(fn);return{unref(){}}};global.clearTimeout=()=>{};
 try {
  host=mount({...props,requests:[reqs[0]],requestReplies:{},onRefreshReplies:async()=>({replies:{},forwards:{'new-old':[{id:'unknown-forward',to:'logan@example.invalid',by:'owner@example.invalid',note:'',status:'unknown',created:now+1}]}})});
  await ticks.shift()();await flush(host);openRow(host,'new-old');await flush(host);
  assert(text(host.tree).includes('Forward status unconfirmed to logan@example.invalid'));
  assert(!text(host.tree).includes('Forwarded to logan@example.invalid'),'An unknown send is never shown as a successful forward');
  host.unmount();
 } finally {global.document=savedDocument;global.setTimeout=savedSetTimeout;global.clearTimeout=savedClearTimeout;}

 // Order conversation: internal order notes stay staff-only; tagging the case saves issue and resolutions.
 const savedIssues=[];const orderReq=request('from-order','new','contact',{subject:'Your BioMod order #ABC',message:'Order #ABC. INTERNAL items list.',origin:'order',startedBy:'owner@example.invalid'});
 host=mount({...props,requests:[orderReq],requestReplies:{},onSaveIssue:async input=>{savedIssues.push(input);return {issue:input.issue,resolutions:input.resolutions,note:input.note,updated:now,updatedBy:'owner@example.invalid'};}});await flush(host);
 openRow(host,'from-order');assert(text(host.tree).includes('Order behind this conversation (only you see this)'));
 assert(!nodes(host.tree).some(n=>n.type==='li'&&n.props['data-direction']==='incoming'),'Internal order context is not shown as a customer message');
 assert(text(host.tree).includes('Conversation started from the order by owner@example.invalid'));
 const issueSelect=nodes(host.tree).find(n=>n.type==='select'&&nodes(n).some(o=>o.type==='option'&&text(o)==='Item not in stock yet'));issueSelect.props.onChange({target:{value:'out_of_stock'}});await flush(host);
 assert.deepEqual(savedIssues.at(-1),{id:'from-order',issue:'out_of_stock',resolutions:[],note:''});
 nodes(host.tree).find(n=>n.type==='label'&&text(n)==='Refunded').props.children[0].props.onChange({target:{checked:true}});await flush(host);
 assert.deepEqual(savedIssues.at(-1).resolutions,['refund']);
 // Win-back templates on the side: Use fills the draft (with undo), Tailor asks the AI to fit it to this customer.
 const tplCalls=[];host=mount({...props,requests:[orderReq],requestReplies:{},onLoadTemplates:async id=>{tplCalls.push(id);return [{id:'help',label:'Need a hand?',why:'Service first.',body:'Hi Synthetic, need a hand?'}];}});await flush(host);
 openRow(host,'from-order');await flush(host);await flush(host);assert.deepEqual(tplCalls,['from-order']);assert(text(host.tree).includes('Win-back emails'));
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Use').props.onClick();host.render();assert.equal(field(host,'replyBody').props.value,'Hi Synthetic, need a hand?');
 const before2=preparations.length;nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Tailor').props.onClick();await flush(host);
 assert.equal(preparations.length,before2+1);assert.equal(preparations.at(-1).mode,'ai');assert.match(preparations.at(-1).instruction,/^Tailor this email/);assert.equal(preparations.at(-1).body,'Hi Synthetic, need a hand?');
 // Reply status at a glance: Mark as replied moves it out of Needs reply with who/how; pitches stay out of Needs reply; selection follows the tab.
 const pitch=request('pitch','new','contact',{subject:'High quality peptides and SARMs',message:'We are a leading manufacturer with competitive price.'});
 const marked=[];host=mount({...props,requests:[request('phone','new'),pitch],requestReplies:{},onMarkReplied:async input=>{marked.push(input);return {at:now,source:'manual',account:'owner@example.invalid',body:input.note||'Replied outside email (phone or text).',preview:false};}});await flush(host);
 assert.deepEqual(rowIds(),['phone'],'A sales pitch is kept out of Needs reply');filter(host,'Sales pitches');assert.deepEqual(rowIds(),['pitch']);
 openRow(host,'pitch');assert(text(host.tree).includes('reads like a supplier or vendor pitch'));
 filter(host,'Needs reply');assert(text(host.tree).includes('Pick a request on the left'),'Switching tabs closes a conversation from another tab');
 openRow(host,'phone');assert(text(host.tree).includes('Needs reply'));
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Mark as replied').props.onClick();host.render();
 nodes(host.tree).find(n=>n.type==='input'&&n.props.placeholder?.startsWith('e.g. Called')).props.onChange({target:{value:'Called him'}});host.render();
 nodes(host.tree).filter(n=>n.type==='button'&&text(n)==='Mark as replied').at(-1).props.onClick();await flush(host);
 assert.deepEqual(marked,[{id:'phone',note:'Called him'}]);assert.deepEqual(rowIds(),[],'Marked request leaves Needs reply');
 filter(host,'Replied & archive');assert.deepEqual(rowIds(),['phone']);assert(text(host.tree).includes('Replied'));assert(text(host.tree).includes('by phone or text (logged by owner@example.invalid)'));
 // One customer, one row: same email in any letter case groups; opening it shows every message; a reply to one answers the earlier ones.
 const a1=request('alb-1','new','contact',{name:'Albert A',email:'Albert@Example.invalid',subject:'Cart',message:'Cart will not load'});a1.created=now-6*day;
 const a2=request('alb-2','new','contact',{name:'Albert Alvarez',email:'albert@example.invalid',subject:'COA request',message:'Need the COA'});a2.created=now-4*day;
 host=mount({...props,requests:[a1,a2],requestReplies:{}});await flush(host);
 assert.equal(nodes(host.tree).filter(n=>n.type==='article').length,1,'Two requests from one person are one row');assert(text(host.tree).includes('2 requests'));
 openRow(host,'alb-2');assert(text(host.tree).includes('Cart will not load'));assert(text(host.tree).includes('Need the COA'));assert(text(host.tree).includes('One reply answers all of them'));
 host=mount({...props,requests:[a1,a2],requestReplies:{'alb-2':reply('alb-2',{status:'sent',history:[{id:'o2',direction:'incoming',body:'Need the COA',created:a2.created},{id:'s2',direction:'outgoing',body:'Here it is',created:now-day}]})}});await flush(host);
 assert.equal(nodes(host.tree).filter(n=>n.type==='article').length,0,'Replying to the newer request clears the older one too');
 for(const email of ['a@example.invalid\r\nBcc:x@example.invalid','a@example.invalid,b@example.invalid']){const h=mount({...props,requests:[request('bad','new','contact',{email})],requestReplies:{}});openRow(h,'bad');assert(text(h.tree).includes('no way to reply'));assert(!nodes(h.tree).some(n=>n.type==='textarea'));}
 const escaped=render({...props,requests:[request('escape','new','contact',{name:'<script>Fixture</script>',message:'<b>x</b>'})],requestReplies:{}});assert(!escaped.includes('<script>'));assert(!escaped.includes('<b>x'));

 // Actual inbox polling with a deterministic browser clock: no real timer, network or send.
 const savedBrowser={document:global.document,window:global.window,setTimeout:global.setTimeout,clearTimeout:global.clearTimeout};
 const scheduled=new Map(),listeners={document:new Map(),window:new Map()};let sequence=0;
 const events=surface=>({addEventListener:(name,fn)=>{if(!listeners[surface].has(name))listeners[surface].set(name,new Set());listeners[surface].get(name).add(fn);},removeEventListener:(name,fn)=>listeners[surface].get(name)?.delete(fn)});
 global.document={visibilityState:'visible',...events('document')};global.window={...events('window')};
 global.setTimeout=(fn,delay)=>{const id=++sequence;scheduled.set(id,{fn,delay});return id;};global.clearTimeout=id=>scheduled.delete(id);
 const pulse=(surface,name)=>{for(const fn of [...(listeners[surface].get(name)||[])])fn();};
 const nextTick=()=>{const entry=scheduled.entries().next().value;assert(entry,'Expected a scheduled inbox refresh');const[id,job]=entry;scheduled.delete(id);return job.fn();};
 const currentDelay=()=>scheduled.values().next().value?.delay;
 let liveHost=null,readCalls=[],sideEffects=0;
 const readonlyProps={...props,onLoadOptions:undefined,requests:[],requestReplies:{},onStatus:()=>{sideEffects++;throw Error('Polling must never change a request');},onPrepareReply:async()=>{sideEffects++;throw Error('Polling must never prepare or send a reply');}};
 try {
  const incoming=request('incoming');let response={requests:[incoming],replies:{incoming:reply('incoming',{status:'ready',body:'Saved draft',revision:1})}};
  let fail=false,gate=null;
  const refresh=async(list,focus)=>{readCalls.push({ids:list,focus});if(fail)throw Error('Synthetic refresh unavailable');return gate?gate.promise:response;};
  liveHost=mount({...readonlyProps,onRefreshReplies:refresh});
  assert.equal(ids(liveHost).length,0);assert.equal(currentDelay(),2500);
  await nextTick();await flush(liveHost);
  assert.deepEqual(readCalls,[{ids:[],focus:null}],'An empty inbox still checks for new requests');assert.deepEqual(ids(liveHost),['incoming']);assert.equal(currentDelay(),30000);
  openRow(liveHost,'incoming');assert.equal(field(liveHost,'replyBody').props.value,'Saved draft');
  type(liveHost,'replyBody','My unsaved customer reply');type(liveHost,'replyInstruction','Keep this instruction');
  response={requests:[incoming,request('arrived-later')],replies:{incoming:reply('incoming',{status:'ready',body:'Newer server draft',revision:2})}};
  await nextTick();await flush(liveHost);
  assert.deepEqual(ids(liveHost),['incoming','arrived-later']);assert.equal(field(liveHost,'replyBody').props.value,'My unsaved customer reply');assert.equal(field(liveHost,'replyInstruction').props.value,'Keep this instruction');
  assert(text(liveHost.tree).includes('Requests checked '),'Successful read timestamp is visible');
  fail=true;await nextTick();await flush(liveHost);assert(text(liveHost.tree).includes('Could not refresh requests. Showing the last loaded information; retrying automatically.'));assert.deepEqual(ids(liveHost),['incoming','arrived-later']);assert.equal(field(liveHost,'replyBody').props.value,'My unsaved customer reply');
  fail=false;await nextTick();await flush(liveHost);assert(!text(liveHost.tree).includes('Could not refresh requests.'));assert.equal(field(liveHost,'replyBody').props.value,'My unsaved customer reply');
  // Hidden browser tabs do not poll; focus/visibility resumption refreshes once, with one request in flight.
  global.document.visibilityState='hidden';const beforeHidden=readCalls.length;await nextTick();await flush(liveHost);assert.equal(readCalls.length,beforeHidden);
  pulse('window','focus');await flush(liveHost);assert.equal(readCalls.length,beforeHidden,'Focus while hidden does not poll');
  global.document.visibilityState='visible';gate=deferred();pulse('document','visibilitychange');pulse('window','focus');await flush(liveHost);assert.equal(readCalls.length,beforeHidden+1,'Focus and visibility events share a single in-flight read');assert.equal(scheduled.size,0);
  gate.resolve(response);gate=null;await flush(liveHost);assert.equal(scheduled.size,1);
  // Leaving Requests pauses its retained component. Coming back resumes without losing the draft.
  liveHost.props={...liveHost.props,activeTab:false};liveHost.render();assert.equal(scheduled.size,0);const inactiveReads=readCalls.length;
  pulse('document','visibilitychange');pulse('window','focus');await flush(liveHost);assert.equal(readCalls.length,inactiveReads);
  liveHost.props={...liveHost.props,activeTab:true};liveHost.render();await nextTick();await flush(liveHost);assert.equal(readCalls.length,inactiveReads+1);assert.equal(field(liveHost,'replyBody').props.value,'My unsaved customer reply');
  liveHost.unmount();liveHost=null;assert.equal(scheduled.size,0);

  // A linked supplier or deleted request opens after a fresh snapshot loads it, even outside the initial list.
  for(const state of ['pitch','deleted','older']){
   const linked=request('linked-'+state,state==='deleted'?'deleted':'new','contact',state==='pitch'?{subject:'Wholesale peptide offer',message:'We are a peptide manufacturer. Contact us for a wholesale price list.'}:{});
   linked.created=now-40*day;
   const recent=request('recent-'+state),other=request('other-'+state);
   readCalls=[];let fresh={requests:[recent,linked],replies:{[linked.id]:reply(linked.id,{status:'ready',body:'Exact linked draft'})}};
   liveHost=mount({...readonlyProps,requests:[recent],focusId:linked.id+'|email',onRefreshReplies:async(list,focus)=>{readCalls.push({ids:list,focus});return fresh;}});
   assert(!nodes(liveHost.tree).some(n=>n.type==='textarea'),'Unknown linked request is not guessed');
   await nextTick();await flush(liveHost);
   assert.equal(readCalls[0].focus,linked.id,'The exact older link is passed to the read endpoint');
   assert(nodes(liveHost.tree).some(n=>n.props.id==='request-reply-'+linked.id),'The exact linked conversation is open');
   if(state==='deleted'){assert(text(liveHost.tree).includes('This request is deleted. Restore it to reply.'));assert(!nodes(liveHost.tree).some(n=>n.type==='textarea'));}
   else assert.equal(field(liveHost,'replyBody').props.value,'Exact linked draft');
   const pressed=nodes(liveHost.tree).find(n=>n.type==='button'&&n.props['aria-pressed']===true);assert(text(pressed).startsWith(state==='deleted'?'Deleted ':'All '));
   if(state!=='deleted')type(liveHost,'replyBody','Unsaved exact-link reply');
   filter(liveHost,'Needs reply');query(liveHost,recent.id);
   fresh={requests:[recent,linked,other],replies:{[linked.id]:reply(linked.id,{status:'ready',body:'Later server draft',revision:2})}};
   await nextTick();await flush(liveHost);
   assert.deepEqual(ids(liveHost),[recent.id],'A later refresh does not reconsume a link or reset the chosen search/filter');
   assert.equal(nodes(liveHost.tree).find(n=>n.type==='input'&&n.props.type==='search').props.value,recent.id);
   filter(liveHost,state==='deleted'?'Deleted':'All');query(liveHost,'');
   if(!nodes(liveHost.tree).some(n=>n.props.id==='request-reply-'+linked.id))openRow(liveHost,linked.id);
   if(state!=='deleted')assert.equal(field(liveHost,'replyBody').props.value,'Unsaved exact-link reply');
   else assert(text(liveHost.tree).includes('This request is deleted. Restore it to reply.'));
   liveHost.unmount();liveHost=null;assert.equal(scheduled.size,0);
  }
  // A read started against an older prop snapshot cannot overwrite a parent's new snapshot.
  const old=request('old-base'),fresh=request('new-base'),late=deferred();
  liveHost=mount({...readonlyProps,requests:[old],onRefreshReplies:()=>late.promise});const oldFlight=nextTick();
  liveHost.props={...liveHost.props,requests:[fresh]};liveHost.render();assert.deepEqual(ids(liveHost),['new-base']);
  late.resolve({requests:[request('stale-from-old-read')],replies:{}});await oldFlight;await flush(liveHost);assert.deepEqual(ids(liveHost),['new-base']);assert(!text(liveHost.tree).includes('stale-from-old-read'));assert.equal(scheduled.size,1,'Only the new prop scope retains a timer');
  liveHost.unmount();liveHost=null;
  // Both successful and failed late reads are inert after unmount, with listeners and timers removed.
  for(const rejects of [false,true]){
   const lateRead=deferred();liveHost=mount({...readonlyProps,requests:[old],onRefreshReplies:()=>lateRead.promise});const pendingRead=nextTick();liveHost.unmount();const writes=liveHost.writes;
   if(rejects)lateRead.reject(Error('Detached failure'));else lateRead.resolve({requests:[request('detached')],replies:{}});
   await pendingRead;for(let i=0;i<4;i++)await Promise.resolve();assert.equal(liveHost.writes,writes);assert.equal(scheduled.size,0);liveHost=null;
  }
  for(const surface of Object.values(listeners))for(const handlers of surface.values())assert.equal(handlers.size,0,'Polling event handlers are removed on unmount');
  assert.equal(sideEffects,0,'Polling, deep-link navigation and refresh recovery never send or mutate requests');
 } finally {
  liveHost?.unmount();global.document=savedBrowser.document;global.window=savedBrowser.window;global.setTimeout=savedBrowser.setTimeout;global.clearTimeout=savedBrowser.clearTimeout;
 }
 console.log('PASS: reply desk queue order (oldest unanswered first, customer replies resurface), waiting/done/spam views, learning progress, code insert, COA pick, AI rewrite with draft+instruction+remembered rule, undo, single owner Send, staff draft-only, plain failure text, unsafe addresses blocked. Isolated fixtures, no I/O.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
