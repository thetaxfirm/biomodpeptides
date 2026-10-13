/* Actual request inbox component and hooks over conspicuous synthetic fixtures.
 * No network, production records, status API, mail client or email providers. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),projectRequire=Module.createRequire(path.join(root,'package.json'));
const ts=projectRequire('typescript'),React=projectRequire('react'),{renderToStaticMarkup}=projectRequire('react-dom/server');
let active=null;
const hooks={...React,
 useState(initial){if(!active)return React.useState(initial);const host=active,index=host.cursor++;if(!(index in host.slots))host.slots[index]=typeof initial==='function'?initial():initial;return[host.slots[index],value=>{const next=typeof value==='function'?value(host.slots[index]):value;if(next!==host.slots[index])host.changed=true;host.slots[index]=next;}];},
 useRef(initial){if(!active)return React.useRef(initial);const host=active,index=host.cursor++;if(!(index in host.slots))host.slots[index]={current:initial};return host.slots[index];},
 useEffect(effect,deps){if(!active)return React.useEffect(effect,deps);const host=active,index=host.cursor++,prior=host.slots[index];if(!prior||deps.some((value,i)=>value!==prior.deps[i])){host.slots[index]={deps,cleanup:prior?.cleanup};host.effects.push(()=>{host.slots[index].cleanup?.();host.slots[index].cleanup=effect();});}}
};
const filename=path.join(root,'components/store/request-inbox.tsx'),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{if(id==='react')return hooks;if(id==='react/jsx-runtime')return projectRequire(id);if(id.endsWith('.module.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};throw Error('Unexpected dependency: '+id);};
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {RequestInbox}=mod.exports;
global.fetch=()=>{throw Error('Live I/O forbidden');};
function nodes(tree,out=[]){if(Array.isArray(tree))tree.forEach(item=>nodes(item,out));else if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(Array.isArray(tree))return tree.map(text).join(' ').replace(/\s+/g,' ').trim();return typeof tree==='object'?text(tree.props?.children):String(tree);}
function mount(props){const host={props,slots:[],cursor:0,tree:null,effects:[],changed:false,render(){let iterations=0;do{assert(++iterations<10,'Render settles');this.cursor=0;this.effects=[];this.changed=false;active=this;try{this.tree=RequestInbox(this.props);}finally{active=null;}this.effects.forEach(effect=>effect());}while(this.changed);return this.tree;},unmount(){this.slots.forEach(slot=>slot?.cleanup?.());}};host.render();return host;}
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
async function main(){
let changes=[],preparations=[];
const props={requests,automation,busy:false,dirty:false,refreshing:false,onStatus:(original,next)=>changes.push({original,next}),requestReplies:{},onPrepareReply:async input=>{preparations.push(input);return reply(input.id,{mode:input.mode,body:input.body||'',revision:(input.expectedRevision||0)+1});}};
const before=JSON.stringify({requests,automation});
let host=mount(props);
assert.deepEqual(ids(host),['accepted','duplicate','review','ordinary','progress','stock']);
assert(text(host.tree).includes('6 shown from 8 loaded requests'));
assert.equal(nodes(host.tree).find(node=>node.type==='button'&&text(node)==='Needs attention 6').props['aria-pressed'],true);
filter(host,'All');assert.equal(cards(host).length,8);
filter(host,'Resolved');assert.deepEqual(ids(host),['partner']);
filter(host,'Spam');assert.deepEqual(ids(host),['vendor']);assert(text(host.tree).includes('Spam is kept here and can be reopened.'));
filter(host,'All');query(host,'  FIXTURE ACCEPTED  ');assert.deepEqual(ids(host),['accepted']);
query(host,'DUPLICATE@EXAMPLE.INVALID');assert.deepEqual(ids(host),['duplicate']);
query(host,'question REVIEW');assert.deepEqual(ids(host),['review']);
query(host,'supplier catalog');assert.deepEqual(ids(host),['vendor']);
filter(host,'Needs attention');assert.equal(cards(host).length,0);assert(text(host.tree).includes('No requests match this view.'));
query(host,'');assert.equal(cards(host).length,6);assert.equal(changes.length,0);assert.equal(preparations.length,0,'Rendering and browsing never classify or send');
assert(text(card(host,'accepted')).includes('Inbox delivery is not confirmed; do not resend.'));
assert(text(card(host,'duplicate')).includes('No resend is needed; inbox delivery is not confirmed.'));
assert(text(card(host,'review')).includes('needs a manual review'));
assert(!text(card(host,'ordinary')).includes('COA email'));assert(!text(card(host,'ordinary')).includes('No COA'));
assert(text(card(host,'ordinary')).includes('That alert is not a reply to the customer.'));
assert.equal(controls(host.tree,'Send matched original COA').length,0,'Accepted/duplicate/review cannot resend even with contradictory canProcess=true');
for(const [label,next] of [['Start review','in_progress'],['Mark resolved','resolved'],['Move to spam','spam']]){button(card(host,'accepted'),label).props.onClick();assert.equal(changes.at(-1).original,requests[0]);assert.equal(changes.at(-1).next,next);}
assert.equal(controls(card(host,'progress'),'Start review').length,0);assert.equal(controls(card(host,'progress'),'Mark resolved').length,1);
filter(host,'Resolved');button(card(host,'partner'),'Reopen request').props.onClick();assert.equal(changes.at(-1).original,requests[4]);assert.equal(changes.at(-1).next,'new');
assert(text(host.tree).includes('Review the application before agreeing to terms or assigning a code.'));
filter(host,'Spam');button(card(host,'vendor'),'Reopen request').props.onClick();assert.equal(changes.at(-1).original,requests[5]);assert.equal(changes.at(-1).next,'new');assert.equal(controls(host.tree,'Move to spam').length,0);
assert.equal(preparations.length,0,'Status changes never delegate email processing');assert.equal(JSON.stringify({requests,automation}),before);

// Even a historically eligible COA no longer exposes a direct-send bypass.
const legacyRequests=['ready','queued','sending','no-report','unmatched'].map(id=>request(id));
const legacyReport={...automation,requests:Object.fromEntries(legacyRequests.map(r=>[r.id,{coa:status(r.id,{canProcess:true}),alert:null}]))};
host=mount({...props,requests:legacyRequests,automation:legacyReport});
assert.equal(controls(host.tree,'Send matched original COA').length,0);
assert(!nodes(host.tree).some(node=>node.type==='a'&&node.props.href?.startsWith('mailto:')));
assert.equal(preparations.length,0);
for(const flag of ['busy','dirty','refreshing']){
 host=mount({...props,[flag]:true});const actions=nodes(host.tree).filter(node=>node.type==='button'&&['Start review','Mark resolved','Move to spam'].includes(text(node)));
 assert(actions.length>0);assert(actions.every(node=>node.props.disabled));const count=changes.length;actions.forEach(node=>node.props.onClick());assert.equal(changes.length,count);
 if(flag==='dirty')assert(text(host.tree).includes('Save or discard your unsaved admin edits'));
}
assert(render({...props,requests:[]}).includes('No customer requests yet.'));

// Real component draft actions: no mail client, no send callback and no mutation on open.
const ordinary=request('reply');host=mount({...props,requests:[ordinary]});
const open=()=>{button(card(host,'reply'),'Prepare reply').props.onClick();host.render();};
const field=name=>{const node=nodes(host.tree).find(n=>n.type==='textarea'&&n.props.name===name);assert(node,'Expected '+name);return node;};
const type=(name,value)=>{field(name).props.onChange({target:{value}});host.render();};
const flush=async()=>{await Promise.resolve();await Promise.resolve();host.render();};
open();assert(text(host.tree).includes('research@biomodpeptides.com'));assert(text(host.tree).includes('No attachment is confirmed yet.'));
assert(text(host.tree).includes('Original customer message'));assert(text(host.tree).includes('Synthetic request body only'));
assert.equal(field('replyBody').props.maxLength,12000);assert.equal(field('replyInstruction').props.maxLength,2000);
assert.equal(preparations.length,0,'Opening a draft does not queue or send');
button(host.tree,'Save reply for Ash’s review').props.onClick();await flush();assert.equal(preparations.length,0);assert(text(host.tree).includes('Write a reply'));
type('replyBody','Synthetic staff reply, not sent.');type('replyInstruction','Use only the verified facts.');
button(host.tree,'Close editor').props.onClick();host.render();open();assert.equal(field('replyBody').props.value,'Synthetic staff reply, not sent.');
filter(host,'Resolved');assert.equal(cards(host).length,0);filter(host,'All');assert.equal(field('replyBody').props.value,'Synthetic staff reply, not sent.','Filtering preserves the open local draft');
let resolvePreparation;host.props.onPrepareReply=input=>{preparations.push(input);return new Promise(resolve=>{resolvePreparation=resolve;});};host.render();
const save=button(host.tree,'Save reply for Ash’s review');save.props.onClick();save.props.onClick();host.render();
assert.equal(preparations.length,1,'Synchronous in-flight guard rejects double clicks before rendering');
assert.deepEqual(preparations[0],{id:'reply',mode:'staff',body:'Synthetic staff reply, not sent.',instruction:'Use only the verified facts.',expectedRevision:null});
assert.equal(field('replyBody').props.disabled,true);assert.equal(button(host.tree,'Preparing…').props.disabled,true);
type('replyBody','Must not replace pending text');assert.equal(field('replyBody').props.value,'Synthetic staff reply, not sent.');
const queued=reply('reply',{body:'Synthetic staff reply, not sent.',mode:'staff'});resolvePreparation(queued);await flush();
assert.equal(button(card(host,'reply'),'Preparing reply').props['aria-expanded'],true);assert(text(host.tree).includes('Saving a draft does not send email.'));assert.equal(field('replyBody').props.value,queued.body);
const ready=reply('reply',{body:'Reviewed synthetic draft',status:'ready',updated:queued.updated+1,readyId:'synthetic-ready',coa:{state:'matched',reason:'Exact synthetic product/strength/lot original matched.',productName:'Synthetic material',strength:'10mg',lot:'QA-LOT',reportId:'QA-ORIGINAL',filename:'synthetic-original.pdf'}});
host.props.requestReplies={reply:ready};host.render();assert.equal(field('replyBody').props.value,ready.body,'Clean draft receives completed preparation on refresh');
assert(text(host.tree).includes('Exact original matched for review'));assert(text(host.tree).includes('QA-LOT'));assert(text(host.tree).includes('synthetic-original.pdf'));assert(text(host.tree).includes('checked again before sending'));
assert.equal(button(card(host,'reply'),'Ready to send').props['aria-expanded'],true);

// Failed saves and concurrent revisions preserve staff writing and require an explicit choice.
type('replyBody','Local text to preserve');type('replyInstruction','Keep this instruction');
host.props.onPrepareReply=async input=>{preparations.push(input);throw Error('Revision changed. Refresh administration.');};host.render();
button(host.tree,'Save reply for Ash’s review').props.onClick();await flush();assert.equal(field('replyBody').props.value,'Local text to preserve');assert.equal(field('replyInstruction').props.value,'Keep this instruction');assert(text(host.tree).includes('Revision changed'));assert(text(host.tree).includes('Your draft text has been kept.'));
const newer=reply('reply',{revision:2,status:'ready',body:'Other staff draft',updated:ready.updated+2});host.props.requestReplies={reply:newer};host.render();
assert.equal(field('replyBody').props.value,'Local text to preserve');assert(text(host.tree).includes('A newer reply exists'));assert(text(host.tree).includes('Other staff draft'));
assert.equal(button(host.tree,'Save reply for Ash’s review').props.disabled,true);const countBeforeConflict=preparations.length;button(host.tree,'Save reply for Ash’s review').props.onClick();await flush();assert.equal(preparations.length,countBeforeConflict);
button(host.tree,'Keep my text for a new revision').props.onClick();host.render();assert.equal(field('replyBody').props.value,'Local text to preserve');assert(!text(host.tree).includes('A newer reply exists'));
host.props.onPrepareReply=async input=>{preparations.push(input);return reply('reply',{revision:3,mode:input.mode,body:input.body,updated:newer.updated+1});};host.render();
button(host.tree,'Ask AI to draft').props.onClick();await flush();assert.equal(preparations.at(-1).expectedRevision,2);assert.equal(preparations.at(-1).mode,'ai');assert.equal(preparations.at(-1).instruction,'Keep this instruction');
type('replyBody','Another local draft');host.props.requestReplies={reply:reply('reply',{revision:4,body:'Newest staff reply',updated:newer.updated+2})};host.render();
button(host.tree,'Replace my text with latest draft').props.onClick();host.render();assert.equal(field('replyBody').props.value,'Newest staff reply');
for(const flag of ['busy','dirty','refreshing']){
 host.props[flag]=true;host.render();const calls=preparations.length;type('replyBody','Blocked edit');button(host.tree,'Ask AI to draft').props.onClick();button(host.tree,'Save reply for Ash’s review').props.onClick();await flush();assert.equal(field('replyBody').props.value,'Newest staff reply');assert.equal(preparations.length,calls);host.props[flag]=false;host.render();
}
const sending=reply('reply',{revision:4,status:'sending',body:'Newest staff reply',updated:newer.updated+3});host.props.requestReplies={reply:sending};host.render();
assert(text(host.tree).includes('Sending approved reply from Jarvis'));assert.equal(field('replyBody').props.disabled,true);type('replyBody','Blocked during send');assert.equal(field('replyBody').props.value,'Newest staff reply');const sendingCount=preparations.length;button(host.tree,'Ask AI to draft').props.onClick();await flush();assert.equal(preparations.length,sendingCount);
host.props.requestReplies={reply:reply('reply',{revision:4,status:'sent',body:'Newest staff reply',updated:newer.updated+4,coa:{state:'already_sent',reason:'Earlier provider acceptance recorded; do not resend the original.'},history:[{id:'synthetic-outgoing',direction:'outgoing',body:'Newest staff reply',created:newer.updated+4}]})};host.render();
assert(text(host.tree).includes('Accepted by mail provider'));assert(text(host.tree).includes('Provider acceptance does not confirm inbox delivery'));assert(text(host.tree).includes('Earlier COA delivery recorded'));assert(text(host.tree).includes('Conversation history'));assert.equal(field('replyBody').props.disabled,false,'Follow-up draft is possible after provider acceptance');

// Failed preparation is actionable and never looks ready to send; raw bridge codes stay off the UI.
for (const state of ['queued','preparing','needs_review']) {
 const failureHost=mount({...props,requests:[ordinary],requestReplies:{reply:reply('reply',{status:state,reason:state==='needs_review'?'bridge_preparation_failed':undefined})}});
 assert.equal(controls(failureHost.tree,'Ready to send').length,0,'Only a ready reply gets a ready action');
 button(failureHost.tree,state==='needs_review'?'Prepare reply':'Preparing reply').props.onClick();failureHost.render();
 if(state==='needs_review') {
  assert(text(failureHost.tree).includes('Jarvis could not finish preparing this reply.'));
  assert(text(failureHost.tree).includes('This attempt did not send a customer email.'));
  assert(text(failureHost.tree).includes('choose Ask AI to draft again, or write a reply and save it for review.'));
  assert(!text(failureHost.tree).includes('bridge_preparation_failed'));
  assert.equal(controls(failureHost.tree,'Ask AI to draft').length,1);
 }
}

// A late response from this save cannot erase a draft when someone else has saved again.
host=mount({...props,requests:[ordinary],requestReplies:{reply:reply('reply',{status:'ready',body:'Initial shared draft'})}});
button(host.tree,'Ready to send').props.onClick();host.render();type('replyBody','My in-flight draft');type('replyInstruction','My in-flight instruction');
let resolveLate;host.props.onPrepareReply=input=>new Promise(resolve=>{resolveLate=resolve;});host.render();
button(host.tree,'Save reply for Ash’s review').props.onClick();host.render();
host.props.requestReplies={reply:reply('reply',{revision:3,status:'ready',body:'Newer shared reply'})};host.render();
resolveLate(reply('reply',{revision:2,status:'queued',body:'My in-flight draft'}));await flush();
assert.equal(field('replyBody').props.value,'My in-flight draft');assert.equal(field('replyInstruction').props.value,'My in-flight instruction');assert(text(host.tree).includes('A newer reply exists'));assert(text(host.tree).includes('Newer shared reply'));assert.equal(button(host.tree,'Save reply for Ash’s review').props.disabled,true);

// Invalid addresses cannot prepare drafts; profile links and original text stay safe.
for(const email of ['a@example.invalid\r\nBcc:other@example.invalid','a@example.invalid?bcc=other@example.invalid','a@example.invalid&bcc=other@example.invalid','a@example.invalid%0d%0aBcc:other@example.invalid','a@example.invalid,other@example.invalid','Name <a@example.invalid>','a@example.invalid;other@example.invalid','no-email','x'.repeat(255)+'@example.invalid']){
 const invalid=mount({...props,requests:[request('invalid','new','contact',{email})]});assert.equal(button(invalid.tree,'Prepare reply').props.disabled,true);assert(text(invalid.tree).includes('No usable email address'));
}
for(const website of ['javascript:alert(1)','data:text/html,<script>x</script>','https://user:pass@example.invalid/','file:///tmp/private','not-a-url']){const html=render({...props,requests:[request('bad-site','new','affiliate',{website})]});assert(!html.includes('View applicant'));}
for(const website of ['https://example.invalid/profile?q=a&b=c','http://example.invalid/profile']){const html=render({...props,requests:[request('good-site','new','affiliate',{website})]});assert(html.includes('target="_blank"'));assert(html.includes('rel="noopener noreferrer"'));assert(html.includes('View applicant'));}
const escaped=render({...props,requests:[request('escape','new','contact',{name:'<script>Fixture</script>',subject:'<img src=x onerror=alert(1)>',message:'<b>Original message</b>',metadata:{value:'<script>nested</script>'},website:'javascript:alert(1)'})]});
assert(!escaped.includes('<script>'));assert(!escaped.includes('<img'));assert(!escaped.includes('<b>Original'));assert(escaped.includes('&lt;script&gt;Fixture&lt;/script&gt;'));assert(escaped.includes('&lt;script&gt;nested&lt;/script&gt;'));
assert(!escaped.includes('dangerouslySetInnerHTML'));assert(!nodes(host.tree).some(node=>node.type==='form'),'Inbox has no direct-send form');
assert.equal(JSON.stringify({requests,automation}),before,'Request and historical COA data are preserved');
console.log('PASS: actual RequestInbox filters/status, draft-only AI/staff preparation, fixed sender, original context, strict COA state, duplicate-click/loading guards, optimistic revision conflicts, text preservation across refresh/filter/close/failure, sending lock, truthful provider state, safe links and escaped content. Synthetic fixtures only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
