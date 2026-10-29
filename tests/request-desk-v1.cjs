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
mod.require=id=>{if(id==='@/lib/customer-context')return (()=>{const m={exports:{}};new Function('exports',require('typescript').transpileModule(require('node:fs').readFileSync(require('node:path').join(__dirname,'..','lib/customer-context.ts'),'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(m.exports);return m.exports;})();if(id==='@/lib/reply-composer'){const f=path.join(root,'lib/reply-composer.ts'),m=new Module(f,module);m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,f);return m.exports;}if(id==='@/lib/request-issues')return issuesLib;if(id==='react')return hooks;if(id==='react/jsx-runtime')return projectRequire(id);if(id.endsWith('.module.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};throw Error('Unexpected dependency: '+id);};
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {RequestInbox,replyPurchaseNotice}=mod.exports;
global.fetch=()=>{throw Error('Live I/O forbidden');};
function nodes(tree,out=[]){if(Array.isArray(tree))tree.forEach(item=>nodes(item,out));else if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(Array.isArray(tree))return tree.map(text).join(' ').replace(/\s+/g,' ').trim();return typeof tree==='object'?text(tree.props?.children):String(tree);}
const fixtureHosts=new Set();
function mount(props){const host={props,slots:[],cursor:0,tree:null,effects:[],changed:false,writes:0,render(){let iterations=0;do{assert(++iterations<10,'Render settles');this.cursor=0;this.effects=[];this.changed=false;active=this;try{this.tree=RequestInbox(this.props);}finally{active=null;}this.effects.forEach(effect=>effect());}while(this.changed);return this.tree;},unmount(){this.slots.forEach(slot=>slot?.cleanup?.());fixtureHosts.delete(this);}};fixtureHosts.add(host);host.render();return host;}
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
function reply(id,extra={}){return {id:'job-'+id,requestId:id,revision:1,status:'queued',mode:'ai',sender:'contact@trybiomod.com',recipient:id+'@example.invalid',subject:'Re: Question '+id,body:'',preparedBy:'synthetic-staff@example.invalid',updated:Date.parse('2026-10-14T08:00:00Z'),coa:{state:'not_requested',reason:'No original COA requested.'},history:[],...extra};}
const field=(host,name)=>{const node=nodes(host.tree).find(n=>n.type==='textarea'&&n.props.name===name);assert(node,'Expected '+name);return node;};
const type=(host,name,value)=>{field(host,name).props.onChange({target:{value}});host.render();};
const flush=async host=>{for(let i=0;i<4;i++)await Promise.resolve();host.render();};
const openRow=(host,id)=>{nodes(host.tree).find(n=>n.type==='button'&&n.props['aria-controls']==='request-reply-'+id).props.onClick();host.render();};
const select=(host,label)=>nodes(host.tree).find(n=>n.type==='label'&&text(n).startsWith(label)).props.children[1];
const options={team:[{email:'logan@example.invalid',name:'Logan',role:'manager'}],links:[{label:'Fixture material 10 mg · lot QA-LOT',url:'https://trybiomod.com/testing/QA-LOT?product=1'}],coas:[{sha256:'a'.repeat(64),productName:'Fixture material',strength:'10 mg',form:'vial',lot:'QA-LOT',reportId:'QA-ORIGINAL',current:true}],codes:[{code:'BM10',percentOff:10}],rules:[{id:'00000000-0000-4000-8000-000000000001',rule:'Use the customer-care signature'}],learning:{recent:4,unchanged:3},bridgeSeen:null};
async function main(){
 const day=86400000,now=Date.now();
 const reqs=[request('new-old','new'),request('new-young','new'),request('answered','resolved'),request('closed','resolved'),request('junk','spam'),request('came-back','resolved')];
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
 assert(!text(host.tree).includes("Past customers' replies are not reused as examples"),'Internal drafting policy is not frontloaded');assert(text(host.tree).includes('Issues & rules'),'Rules remain available behind their disclosure');
 // Opening a conversation never sends; it shows the thread, pickers and an owner Send.
 openRow(host,'new-old');assert.equal(preparations.length,0);
 assert(text(host.tree).includes('Synthetic request body only'));assert(text(host.tree).includes('contact@trybiomod.com'));
 assert.equal(field(host,'replyBody').props.maxLength,12000);
 const send=()=>nodes(host.tree).find(n=>n.type==='button'&&text(n).startsWith('Send email'));assert(send(),'Owner sees Send');assert.equal(send().props.disabled,true,'Empty reply cannot be sent');
 // Codes insert into the draft; the COA picker stages a chosen original.
 type(host,'replyBody','Hi there, use');select(host,'Insert code').props.onChange({target:{value:'BM10'}});host.render();
 assert.equal(field(host,'replyBody').props.value,'Hi there, use code BM10 (10% off at checkout)');
 type(host,'replyBody','');select(host,'Insert public COA link').props.onChange({target:{value:'https://trybiomod.com/testing/QA-LOT?product=1'}});host.render();assert.equal(field(host,'replyBody').props.value,'COA for Fixture material 10 mg · lot QA-LOT: https://trybiomod.com/testing/QA-LOT?product=1');
 type(host,'replyBody','Hi there, use code BM10 (10% off at checkout)');
 select(host,'Attach COA').props.onChange({target:{value:'a'.repeat(64)}});host.render();assert(text(host.tree).includes('Selected:'));
 // AI rewrite carries the current draft and optional instruction; no rule is silently saved.
 type(host,'replyInstruction','um make it friendlier');
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Apply changes').props.onClick();await flush(host);
 assert.deepEqual(preparations[0],{id:'new-old',mode:'ai',purpose:'reply',body:'Hi there, use code BM10 (10% off at checkout)',instruction:'um make it friendlier',expectedRevision:null,coaSha256:'a'.repeat(64)});
 assert(text(host.tree).includes('AI is writing'));assert.equal(field(host,'replyBody').props.readOnly,true);
 type(host,'replyBody','ignored while writing');assert.equal(field(host,'replyBody').props.value,'Hi there, use code BM10 (10% off at checkout)');
 // The finished AI draft replaces the text, with undo back to what was there.
 host.props.requestReplies={...replies,'new-old':reply('new-old',{revision:1,status:'ready',body:'Hello! Use code BM10 for 10% off.',updated:Date.parse('2026-10-15T08:00:00Z')})};host.render();
 assert.equal(field(host,'replyBody').props.value,'Hello! Use code BM10 for 10% off.');
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Undo change').props.onClick();host.render();assert.equal(field(host,'replyBody').props.value,'Hi there, use code BM10 (10% off at checkout)');
 // Send is one click and one request, marked as an owner send of exactly this text.
 send().props.onClick();send().props.onClick();await flush(host);
 const sends=preparations.filter(p=>p.send);assert.equal(sends.length,1,'Double click sends once');
 assert.deepEqual(sends[0],{id:'new-old',mode:'staff',purpose:'reply',body:'Hi there, use code BM10 (10% off at checkout)',instruction:'',expectedRevision:1,coaSha256:'a'.repeat(64),send:true});
 assert(text(host.tree).includes('Queued to send'));
 // Pending work is labelled by its actual mode across the list, editor and AI tool.
 for(const mode of ['staff','ai'])for(const pendingStatus of ['queued','preparing']){
  const workId=mode+'-'+pendingStatus,workBody=mode==='staff'?'My exact staff-written reply.':'';
  const workingHost=mount({...props,requests:[request(workId)],requestReplies:{[workId]:reply(workId,{mode,status:pendingStatus,body:workBody})}});await flush(workingHost);openRow(workingHost,workId);
  const editorLabel=nodes(workingHost.tree).find(n=>n.type==='label'&&n.props.htmlFor==='reply-body-'+workId);
  assert.match(text(card(workingHost,workId)),mode==='ai'?/AI is writing a draft/:/Saving draft/);
  assert.match(text(editorLabel),mode==='ai'?/AI is writing/:/Saving draft/);
  assert.equal(field(workingHost,'replyBody').props.placeholder,mode==='ai'?'The AI is writing…':'Saving your draft…');
  assert.equal(field(workingHost,'replyBody').props.value,workBody,'Status copy never rewrites the reply');assert.equal(field(workingHost,'replyBody').props.readOnly,true);
  assert(button(workingHost.tree,mode==='ai'?'Creating AI draft…':'Saving draft…').props.disabled);assert(button(workingHost.tree,'Save draft').props.disabled);
  assert(text(workingHost.tree).includes(mode==='ai'?'AI is writing. This usually takes under a minute.':'Saving the draft…'));
  if(mode==='staff')assert.doesNotMatch(text(workingHost.tree),/AI is writing|Creating AI draft/,'Saving staff text never claims AI is generating it');
  workingHost.unmount();
 }
 // Staff without send rights only save drafts.
 host=mount({...props,canSend:false});await flush(host);openRow(host,'new-young');
 assert(!nodes(host.tree).some(n=>n.type==='button'&&text(n).startsWith('Send email')));assert(text(host.tree).includes('An authorized sender can send from this screen'));
 // Serious cases are explicitly flagged, with an owner-only approval control and recorded reason.
 const issueSaves=[];
 host=mount({...props,requests:[reqs[0]],requestReplies:{},onSaveIssue:async input=>{issueSaves.push(input);return {...input,updated:now,updatedBy:'support@example.invalid'};}});await flush(host);openRow(host,'new-old');
 assert.equal(button(host.tree,'Mark for owner review').props.disabled,true);
 type(host,'ownerReviewReason','A payment dispute needs a decision.');button(host.tree,'Mark for owner review').props.onClick();await flush(host);
 assert.equal(issueSaves.at(-1).issue,'owner_review');assert(text(host.tree).includes('A payment dispute needs a decision.'));assert(button(host.tree,'Approve and send'));assert(!controls(host.tree,'Send').length);
 host.props.canSend=false;host.render();assert(!controls(host.tree,'Approve and send').length);assert(text(host.tree).includes('This case requires their approval.'));
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

 // Attachment validation is automatic, read-only and bound to the exact current selection.
 const checks=[],checkReq=request('check-pdf','new','contact',{subject:'COA request',labelLot:'QA-LOT'});
 const checkProps={...props,requests:[checkReq],requestReplies:{},onCheckAttachments:input=>{const gate=deferred();checks.push({input,...gate});return gate.promise;}};
 const checked=(entry,coa)=>({requestId:entry.input.id,revision:entry.input.expectedRevision,coaChoice:entry.input.coaSha256,checkedAt:now,coa});
 const validPdf={state:'matched',reason:'Original verified',productName:'Fixture material',strength:'10 mg',lot:'QA-LOT',filename:'QA-original.pdf',sha256:'a'.repeat(64)};
 host=mount(checkProps);await flush(host);openRow(host,'check-pdf');await flush(host);
 assert.equal(checks.length,1);assert(text(host.tree).includes('Checking the original PDF'));
 assert(button(host.tree,'Create AI draft').props.disabled,'Draft waits for current attachment evidence');
 type(host,'replyBody','Here is the requested report.');assert(button(host.tree,'Send email').props.disabled);
 select(host,'Attach COA').props.onChange({target:{value:'a'.repeat(64)}});await flush(host);assert.equal(checks.length,2);
 checks[0].resolve(checked(checks[0],validPdf));await flush(host);
 assert(!text(host.tree).includes('1 PDF attached'),'Old automatic result cannot validate the newly selected report');
 checks[1].resolve(checked(checks[1],{state:'needs_review',reason:'The entered lot does not match this report.'}));await flush(host);
 assert(text(host.tree).includes('No PDF attached'));assert(text(host.tree).includes('does not match'));assert(button(host.tree,'Send email').props.disabled);
 button(host.tree,'Remove selection').props.onClick();await flush(host);
 assert(!button(host.tree,'Send email').props.disabled,'Explicit no attachment permits a plain email');
 checks.at(-1).resolve(checked(checks.at(-1),{state:'not_requested',reason:'No report selected'}));await flush(host);
 select(host,'Attach COA').props.onChange({target:{value:'a'.repeat(64)}});await flush(host);
 checks.at(-1).resolve(checked(checks.at(-1),validPdf));await flush(host);
 assert(text(host.tree).includes('1 PDF attached to this draft'));assert(text(host.tree).includes('QA-original.pdf'));assert(!button(host.tree,'Send email + PDF').props.disabled);
 button(host.tree,'Remove PDFs').props.onClick();await flush(host);select(host,'Attach COA').props.onChange({target:{value:'a'.repeat(64)}});await flush(host);
 checks.at(-1).reject(Error('Synthetic offline'));await flush(host);assert(text(host.tree).includes('PDF check could not finish'));assert(button(host.tree,'Send email').props.disabled);
 button(host.tree,'Retry PDF check').props.onClick();await flush(host);checks.at(-1).resolve(checked(checks.at(-1),validPdf));await flush(host);
 assert(!button(host.tree,'Send email + PDF').props.disabled);
 // A verified form match prepares the actual email locally and repairs untouched stale mismatch copy.
 {
  const staleBody="Thanks for your COA request. The lot entered was 102300001, which doesn't match the lot format we have on file. Could you confirm the exact lot including dashes or spaces?";
  const matchedReq=request('matched-form','new','contact',{origin:'coa-link',subject:'COA request: lot 102300001 (Fixture 30mg page)',labelLot:'102300001'});
  const matchedPdf={...validPdf,productName:'Fixture 30mg',strength:'30 mg',lot:'102-30-0001',filename:'fixture-30mg-102-30-0001.pdf'};
  const fixtureChecks=[],draftCalls=[],availableOffers={...options,codes:[...options.codes,{code:'BIOMOD15',percentOff:15}]};
  const matchingProps={...props,requests:[matchedReq],requestReplies:{'matched-form':reply('matched-form',{status:'ready',body:staleBody,coa:matchedPdf,coaChoice:null})},onLoadOptions:async()=>availableOffers,onCheckAttachments:input=>{const gate=deferred();fixtureChecks.push({input,...gate});return gate.promise;},onPrepareReply:async input=>{draftCalls.push(input);throw Error('No provider or persistence in this fixture');}};
  const matchedHost=mount(matchingProps);await flush(matchedHost);openRow(matchedHost,'matched-form');await flush(matchedHost);
  assert.equal(field(matchedHost,'replyBody').props.value,staleBody,'Before PDF verification no match is assumed');
  fixtureChecks[0].resolve(checked(fixtureChecks[0],matchedPdf));await flush(matchedHost);
  const body=field(matchedHost,'replyBody').props.value;
  assert.match(body,/I've attached the laboratory report for Fixture 30mg, lot 102-30-0001/);assert(!body.includes("doesn't match"));assert(!body.includes('confirm the exact lot'));assert.equal(draftCalls.length,0,'Repair is local, with no AI call, save or send');
  assert(text(matchedHost.tree).includes('Matched-report reply prepared. Not sent.'));assert(text(matchedHost.tree).includes('fixture-30mg-102-30-0001.pdf'));
  const attachmentSection=nodes(matchedHost.tree).find(n=>n.props['aria-label']==='COA attachments');assert(nodes(matchedHost.tree).indexOf(field(matchedHost,'replyBody'))<nodes(matchedHost.tree).indexOf(attachmentSection),'Visible email comes before the exact PDF list');
  const optionalAi=nodes(matchedHost.tree).find(n=>n.type==='details'&&text(n.props.children[0])==='Edit with AI (optional)');assert(optionalAi&&!optionalAi.props.open);assert(!controls(matchedHost.tree,'Create AI draft').length,'A prepared matched reply does not ask staff to generate another one');assert(!button(matchedHost.tree,'Send email + PDF').props.disabled);
  const pdfLink=nodes(attachmentSection).find(n=>n.type==='a'&&text(n)==='View PDF');assert.equal(pdfLink.props.href,'/api/store/admin-coa-original?ref=private:'+'a'.repeat(64));
  assert(!body.includes('BIOMOD15'),'A next-purchase offer requires the staff action');button(matchedHost.tree,'Add 15% off the next purchase').props.onClick();matchedHost.render();
  const offered=field(matchedHost,'replyBody').props.value;assert.match(offered,/code BIOMOD15 for 15% off your next purchase/);assert.equal((offered.match(/BIOMOD15/g)||[]).length,1);assert(!controls(matchedHost.tree,'Add 15% off the next purchase').length,'Offer action cannot duplicate the same code');assert.equal(draftCalls.length,0);
  type(matchedHost,'replyBody',offered+'\n\nMy careful staff edit.');matchedHost.props.requestReplies={'matched-form':reply('matched-form',{revision:2,status:'ready',body:staleBody,coa:matchedPdf,coaChoice:null})};matchedHost.render();await flush(matchedHost);fixtureChecks.at(-1).resolve(checked(fixtureChecks.at(-1),matchedPdf));await flush(matchedHost);assert(field(matchedHost,'replyBody').props.value.endsWith('My careful staff edit.'),'Refreshed evidence never overwrites staff typing');matchedHost.unmount();
  // A staff-edited contradiction is retained, clearly blocked, and corrected only on an explicit click.
  const editChecks=[];const editedHost=mount({...matchingProps,onCheckAttachments:input=>{const gate=deferred();editChecks.push({input,...gate});return gate.promise;}});await flush(editedHost);openRow(editedHost,'matched-form');await flush(editedHost);
  type(editedHost,'replyBody',staleBody+' Use code BIOMOD15 for 15% off your next purchase.');editChecks[0].resolve(checked(editChecks[0],matchedPdf));await flush(editedHost);
  assert(field(editedHost,'replyBody').props.value.startsWith(staleBody),'Do not silently discard a staff-edited draft');assert(button(editedHost.tree,'Send email + PDF').props.disabled,'Contradiction disables Send even with a verified attachment');
  button(editedHost.tree,'Use the matched-report reply').props.onClick();editedHost.render();assert.match(field(editedHost,'replyBody').props.value,/laboratory report for Fixture 30mg/);assert.match(field(editedHost,'replyBody').props.value,/BIOMOD15 for 15% off/);assert(!button(editedHost.tree,'Send email + PDF').props.disabled);editedHost.unmount();
  // The original COA template must not answer a later customer question automatically.
  const followupHost=mount({...matchingProps,requestReplies:{'matched-form':reply('matched-form',{status:'needs_review',body:'',coaChoice:null,history:[{id:'original:matched-form',direction:'incoming',body:'COA form',created:now-1000},{id:'followup',direction:'incoming',body:'I have a different question about my order.',created:now}]})},onLoadOptions:async()=>options,onCheckAttachments:async input=>({requestId:input.id,revision:input.expectedRevision,coaChoice:input.coaSha256,checkedAt:now,coa:matchedPdf})});await flush(followupHost);openRow(followupHost,'matched-form');await flush(followupHost);assert.equal(field(followupHost,'replyBody').props.value,'','A later question requires its own answer');assert(!controls(followupHost.tree,'Add 15% off the next purchase').length,'No offer is invented when it is not available');followupHost.unmount();
 }
 // A new draft never inherits the PDF from the last sent message.
 host.props.requestReplies={'check-pdf':reply('check-pdf',{status:'sent',revision:2,coaChoice:'a'.repeat(64),coa:validPdf})};host.render();
 assert(!text(host.tree).includes('1 PDF attached'),'New revision invalidates previous PDF evidence');host.unmount();
 // Automatic selection failures do not trap a plain email behind an unavailable PDF check.
 const plainChecks=[];
 host=mount({...props,requests:[request('plain-pdf-error')],requestReplies:{},onCheckAttachments:input=>{const gate=deferred();plainChecks.push({input,...gate});return gate.promise;}});await flush(host);openRow(host,'plain-pdf-error');await flush(host);
 type(host,'replyBody','I can help with your question.');plainChecks[0].reject(Error('Synthetic PDF check unavailable'));await flush(host);
 assert(button(host.tree,'Send email').props.disabled,'A failed automatic check is not silently treated as no attachment');
 button(host.tree,'Reply without a PDF').props.onClick();await flush(host);
 assert.equal(plainChecks.at(-1).input.coaSha256,'','The explicit choice clears automatic attachment selection');
 assert(!button(host.tree,'Send email').props.disabled,'A plain reply does not wait for an optional PDF service');
 assert(!button(host.tree,'Apply changes').props.disabled,'Plain-email drafting also works while the no-PDF check is pending');host.unmount();
 // An unmatched automatic COA can be explicitly declined without pretending it attached.
 host=mount({...props,requests:[request('unmatched-pdf','new','contact',{subject:'COA request'})],requestReplies:{},onCheckAttachments:async input=>({...input,requestId:input.id,revision:input.expectedRevision,coaChoice:input.coaSha256,checkedAt:now,coa:{state:'needs_review',reason:'No matching report'}})});await flush(host);openRow(host,'unmatched-pdf');await flush(host);
 assert(text(host.tree).includes('No matching report'));button(host.tree,'Reply without a PDF').props.onClick();await flush(host);assert(text(host.tree).includes('No PDF attached'));host.unmount();
 // Adding another PDF retains the already verified automatic primary.
 const multiChecks=[];
 host=mount({...props,requests:[request('multi-pdf','new','contact',{subject:'COA request'})],requestReplies:{},onLoadOptions:async()=>({...options,coas:[...options.coas,{...options.coas[0],sha256:'b'.repeat(64)}]}),onCheckAttachments:input=>{const gate=deferred();multiChecks.push({input,...gate});return gate.promise;}});await flush(host);openRow(host,'multi-pdf');await flush(host);
 multiChecks.at(-1).resolve(checked(multiChecks.at(-1),validPdf));await flush(host);
 nodes(host.tree).find(n=>n.type==='select'&&n.props['aria-label']==='Attach COA PDF').props.onChange({target:{value:'b'.repeat(64)}});await flush(host);
 assert.equal(multiChecks.at(-1).input.coaSha256,'a'.repeat(64)+','+'b'.repeat(64));host.unmount();
 // Cancelling a blank AI draft at the same revision still clears its old PDF.
 const terminalChecks=[];
 host=mount({...props,requests:[request('cancel-empty','new','contact',{subject:'COA request'})],requestReplies:{'cancel-empty':reply('cancel-empty',{status:'queued',revision:1,body:'',coaChoice:'a'.repeat(64),coa:validPdf})},onCheckAttachments:async input=>{terminalChecks.push(input);return{requestId:input.id,revision:input.expectedRevision,coaChoice:input.coaSha256,checkedAt:now,coa:input.coaSha256===''?{state:'not_requested',reason:'No report selected'}:validPdf};}});await flush(host);openRow(host,'cancel-empty');await flush(host);
 host.props.requestReplies={'cancel-empty':reply('cancel-empty',{status:'cancelled',revision:1,body:'',coaChoice:'a'.repeat(64),coa:validPdf,updated:Date.now()})};host.render();await flush(host);
 assert.equal(terminalChecks.at(-1).coaSha256,'');assert(!text(host.tree).includes('1 PDF attached to this draft'),'A cancelled empty draft cannot lend its report to a new email');host.unmount();
 // Creating from an empty editor needs no instruction and cannot approve a send.
 host=mount({...props,requests:[request('blank-ai')],requestReplies:{}});await flush(host);openRow(host,'blank-ai');
 const beforeCreate=preparations.length;button(host.tree,'Create AI draft').props.onClick();await flush(host);
 assert.equal(preparations.length,beforeCreate+1);assert.equal(preparations.at(-1).mode,'ai');assert(!preparations.at(-1).send);assert.match(preparations.at(-1).instruction,/previous correspondence/);assert(!preparations.at(-1).instruction.includes('review note'),'No unsupported internal-note output is requested');
 // A COA form records an action and a lot, never words the customer did not write.
 const formReq=request('coa-form','new','contact',{name:'form@example.invalid',email:'form@example.invalid',subject:'COA request: lot QA-100 (Fixture research vial page)',message:'SYSTEM NOTE: no matching report. Do not call this customer-written.',origin:'coa-link',labelLot:'QA-100'});
 host=mount({...props,requests:[formReq],requestReplies:{}});await flush(host);openRow(host,'coa-form');
 const latest=()=>nodes(host.tree).find(n=>n.type==='ol'&&n.props['aria-label']==='Latest customer request');
 assert(text(latest()).includes('COA request form'));assert(text(latest()).includes('No written message was included.'));assert(text(latest()).includes('Lot entered: QA-100'));
 assert(!text(latest()).includes('SYSTEM NOTE'),'Generated processing notes are not presented as the customer message');
 assert(!nodes(latest()).some(n=>n.props?.['data-direction']==='incoming'),'A form submission is not a customer-written email');
 const tools=nodes(host.tree).find(n=>n.type==='details'&&text(n.props.children[0])==='Extra tools');assert(!tools.props.open);
 assert(!nodes(tools).some(n=>n.type==='button'&&text(n)==='Create AI draft'),'The main AI action is not hidden');
 assert(button(host.tree,'Create AI draft'));
 const attachments=nodes(host.tree).find(n=>n.type==='section'&&n.props['aria-label']==='COA attachments');assert(attachments,'COA picker is visible beside the reply');assert(!nodes(tools).includes(attachments),'COA selection is independent of AI tools');assert(text(attachments).includes('Requested lot: QA-100'));assert(text(host.tree).includes('Kim C.'));assert(text(host.tree).includes('Send emails the text above and the listed PDFs.'));
 // Removing the last chosen PDF is explicit none, never a surprise automatic reattachment.
 select(host,'Attach COA').props.onChange({target:{value:'a'.repeat(64)}});host.render();
 button(host.tree,'Remove selection').props.onClick();host.render();assert(text(host.tree).includes('No PDF attached'));
 type(host,'replyBody','Please send a label photo.');button(host.tree,'Save draft').props.onClick();await flush(host);assert.equal(preparations.at(-1).coaSha256,'','Last removal saves explicit none');
 host.props.requestReplies={'coa-form':reply('coa-form',{status:'ready',revision:1,body:'Please send a label photo.',coaChoice:'',updated:Date.now()})};host.render();
 button(host.tree,'Find matching report').props.onClick();host.render();assert(text(host.tree).includes('No PDF attached'));

 const internal=nodes(host.tree).find(n=>n.type==='details'&&text(n.props.children[0])==='Internal details & actions');assert(!internal.props.open);assert(text(internal).includes('SYSTEM NOTE'),'The original stored record remains available internally');
 const all=nodes(host.tree);assert(all.indexOf(latest())<all.indexOf(field(host,'replyBody')));assert(all.indexOf(internal)>all.indexOf(field(host,'replyBody')),'Optional administration follows the reply');
 type(host,'replyBody','My existing unsaved reply');const beforeQuick=preparations.length;
 button(host.tree,'Use a short request for a label photo').props.onClick();host.render();assert.match(field(host,'replyBody').props.value,/clear photo.*product name and lot number/);assert.equal(preparations.length,beforeQuick,'Quick reply fills locally; it neither saves nor sends');
 button(host.tree,'Undo change').props.onClick();host.render();assert.equal(field(host,'replyBody').props.value,'My existing unsaved reply','Quick reply replacement is reversible');
 host.props.requestReplies={'coa-form':reply('coa-form',{status:'sent',history:[{id:'original:coa-form',direction:'incoming',body:formReq.data.message,created:formReq.created},{id:'real-incoming',direction:'incoming',body:'Here is the label photo. Is this the right report?',created:now}]})};host.render();
 assert(text(latest()).includes('Here is the label photo.'));assert(text(latest()).includes('Customer message'),'A real later email remains clearly visible');
 const old=nodes(host.tree).find(n=>n.type==='details'&&text(n.props.children[0]).startsWith('Earlier messages and replies'));assert(old&&!old.props.open);assert(text(old).includes('COA request form'));
 host=mount({...props,requests:[request('typed-coa','new','contact',{subject:'COA request: lot QA-100 (Fixture page)',message:'These are the exact words I typed.'})],requestReplies:{}});await flush(host);openRow(host,'typed-coa');assert(text(latest()).includes('These are the exact words I typed.'));assert(!text(latest()).includes('No written message'),'Subject wording alone never turns customer text into a system note');
 // An automatic recovery acceptance is visible contact, never proof a question was answered.
 const unanswered=request('recovery-question','new','contact',{email:'recovery-fixture@example.invalid',origin:'coa-link',subject:'COA request: lot QA-300 (Fixture page)',labelLot:'QA-300'});unanswered.created=now-3*day;
 const recoveryContact={id:'recovery:fixture',source:'recovery',direction:'outgoing',body:'Checkout reminder accepted by provider. Delivery unconfirmed.',created:now-2*day};
 host=mount({...props,requests:[unanswered],requestReplies:{[unanswered.id]:reply(unanswered.id,{status:'ready',history:[recoveryContact]})}});await flush(host);
 assert.deepEqual(ids(host),[unanswered.id],'Recovery contact does not remove an unanswered form from Needs reply');openRow(host,unanswered.id);
 assert(text(host.tree).includes('No reply is recorded for this request.'),'Recovery contact does not count as a substantive reply');assert(text(host.tree).includes('Automatic checkout reminder'),'Recovery evidence stays visible in the timeline');assert(!text(host.tree).includes('Last recorded reply:'),'Acceptance is not mislabeled as a staff reply');
 const recoverySibling=request('recovery-sibling','new','contact',{email:'recovery-fixture@example.invalid',origin:'order'});recoverySibling.created=now-4*day;
 host=mount({...props,requests:[unanswered,recoverySibling],requestReplies:{[recoverySibling.id]:reply(recoverySibling.id,{status:'ready',history:[recoveryContact]})}});await flush(host);
 assert.deepEqual(ids(host),[unanswered.id],'A recovery reminder on another case does not answer the customer question');openRow(host,unanswered.id);assert(text(host.tree).includes('No reply is recorded for this request.'));assert(!text(host.tree).includes('Automatic checkout reminder'),'Other cases do not appear as this conversation');
 // Order conversation: internal order notes stay staff-only; tagging the case saves issue and resolutions.
 const savedIssues=[];const orderReq=request('from-order','new','contact',{subject:'Your BioMod order #ABC',message:'Order #ABC. INTERNAL items list.',origin:'order',startedBy:'owner@example.invalid'});
 host=mount({...props,requests:[orderReq],requestReplies:{},onSaveIssue:async input=>{savedIssues.push(input);return {issue:input.issue,resolutions:input.resolutions,note:input.note,updated:now,updatedBy:'owner@example.invalid'};}});await flush(host);
 filter(host,'All');openRow(host,'from-order');assert(text(host.tree).includes('Original order note (saved when opened; may be outdated)'));
 assert(!nodes(host.tree).some(n=>n.type==='li'&&n.props['data-direction']==='incoming'),'Internal order context is not shown as a customer message');
 assert(text(host.tree).includes('Conversation started from the order by owner@example.invalid'));
 const issueSelect=nodes(host.tree).find(n=>n.type==='select'&&nodes(n).some(o=>o.type==='option'&&text(o)==='Item not in stock yet'));issueSelect.props.onChange({target:{value:'out_of_stock'}});await flush(host);
 assert.deepEqual(savedIssues.at(-1),{id:'from-order',issue:'out_of_stock',resolutions:[],note:''});
 nodes(host.tree).find(n=>n.type==='label'&&text(n)==='Refunded').props.children[0].props.onChange({target:{checked:true}});await flush(host);
 assert.deepEqual(savedIssues.at(-1).resolutions,['refund']);
 // Win-back templates on the side: Use fills the draft (with undo), Tailor asks the AI to fit it to this customer.
 const tplCalls=[];host=mount({...props,requests:[orderReq],requestReplies:{},onLoadTemplates:async id=>{tplCalls.push(id);return [{id:'help',label:'Need a hand?',why:'Service first.',body:'Hi Synthetic, need a hand?'}];}});await flush(host);
 filter(host,'All');openRow(host,'from-order');await flush(host);await flush(host);assert.deepEqual(tplCalls,['from-order']);assert(text(host.tree).includes('Follow-up suggestions'));
 nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Use').props.onClick();host.render();assert.equal(field(host,'replyBody').props.value,'Hi Synthetic, need a hand?');
 const before2=preparations.length;nodes(host.tree).find(n=>n.type==='button'&&text(n)==='Apply changes').props.onClick();await flush(host);
 assert.equal(preparations.length,before2+1);assert.equal(preparations.at(-1).mode,'ai');assert.match(preparations.at(-1).instruction,/^Write a short, useful email/);assert.equal(preparations.at(-1).body,'Hi Synthetic, need a hand?');
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
 // A later verified call/text answer can close a reopened case without being mistaken for an older response.
 {
  const reopened=request('reopened-call','in_progress');reopened.created=now-3*day;
  const reopenedReply=reply('reopened-call',{status:'sent',history:[out('reopened-call',now-2*day),{id:'reopened-question',direction:'incoming',body:'Can you help with another issue?',created:now-day}]});
  const callHost=mount({...props,requests:[reopened],requestReplies:{'reopened-call':reopenedReply},onMarkReplied:async()=>({at:now,source:'manual',account:'staff@example.invalid',body:'Answered by phone.',preview:false,verified:true})});await flush(callHost);assert.deepEqual(ids(callHost),['reopened-call']);openRow(callHost,'reopened-call');
  button(callHost.tree,'Mark as replied').props.onClick();callHost.render();controls(callHost.tree,'Mark as replied').at(-1).props.onClick();await flush(callHost);assert.deepEqual(ids(callHost),[],'A fresh recorded answer closes the reopened question');callHost.unmount();
 }
 // Separate requests stay separate, even when the exact same customer sent both.
 const a1=request('alb-1','new','contact',{name:'Albert A',email:'Albert@Example.invalid',subject:'Cart',message:'Cart will not load'});a1.created=now-6*day;
 const a2=request('alb-2','new','contact',{name:'Albert Alvarez',email:'albert@example.invalid',subject:'COA request',message:'Need the COA'});a2.created=now-4*day;
 host=mount({...props,requests:[a1,a2],requestReplies:{}});await flush(host);
 assert.deepEqual(ids(host),['alb-1','alb-2'],'Unrelated customer questions have their own rows');
 openRow(host,'alb-2');const selectedConversation=nodes(host.tree).find(n=>n.props.id==='request-reply-alb-2');assert(text(selectedConversation).includes('Need the COA'));assert(!text(selectedConversation).includes('Cart will not load'),'Another case is not mixed into this thread');assert(!text(host.tree).includes('One reply answers all of them'));
 host=mount({...props,requests:[a1,{...a2,status:'resolved'}],requestReplies:{'alb-2':reply('alb-2',{status:'sent',history:[{id:'o2',direction:'incoming',body:'Need the COA',created:a2.created},{id:'s2',direction:'outgoing',body:'Here it is',created:now-day}]})}});await flush(host);
 assert.deepEqual(ids(host),['alb-1'],'Replying to the COA leaves the cart question open');
 const whileSending={...a2,status:'in_progress'};
 host=mount({...props,requests:[whileSending],requestReplies:{'alb-2':reply('alb-2',{status:'sent',history:[{id:'later-question',direction:'incoming',body:'One more question during the send',created:now-1000},{id:'accepted-after-question',direction:'outgoing',body:'Previously authorized response',created:now}]})}});await flush(host);assert.deepEqual(ids(host),['alb-2'],'New question during send remains open despite the later provider timestamp');

 // An uncertain historical send must never be offered for another send.
 {const uncertain=request('uncertain-send','new');const h=mount({...props,requests:[uncertain],requestReplies:{'uncertain-send':reply('uncertain-send',{status:'needs_review',reason:'local_sent_without_provider_receipt',body:'Previously marked sent.'})}});await flush(h);assert.deepEqual(ids(h),[]);filter(h,'Replied & archive');assert.deepEqual(ids(h),['uncertain-send']);assert(text(h.tree).includes('Check sent status'));openRow(h,'uncertain-send');assert(text(h.tree).includes('Sending is blocked.'));for(const b of nodes(h.tree).filter(n=>n.type==='button'&&/^(Send|Save draft|Apply changes)/.test(text(n))))assert(b.props.disabled,'Unverified sent outcome disables '+text(b));h.unmount();}
 // An actual later mailbox answer closes the question; a later new question reopens it.
 {const done=request('mailbox-answer','resolved');done.created=now-3*day;const h=mount({...props,requests:[done],requestReplies:{'mailbox-answer':reply('mailbox-answer',{status:'sent',history:[{id:'q',direction:'incoming',body:'Question',created:now-2*day},{id:'a',source:'mailbox',direction:'outgoing',body:'Answered from Gmail.',created:now-day}]})}});await flush(h);assert.deepEqual(ids(h),[]);filter(h,'Replied & archive');assert.deepEqual(ids(h),['mailbox-answer']);h.unmount();}
 for(const email of ['a@example.invalid\r\nBcc:x@example.invalid','a@example.invalid,b@example.invalid']){const h=mount({...props,requests:[request('bad','new','contact',{email})],requestReplies:{}});openRow(h,'bad');assert(text(h.tree).includes('no way to reply'));assert(!nodes(h.tree).some(n=>n.type==='textarea'));}
 const escaped=render({...props,requests:[request('escape','new','contact',{name:'<script>Fixture</script>',message:'<b>x</b>'})],requestReplies:{}});assert(!escaped.includes('<script>'));assert(!escaped.includes('<b>x'));

 // Purchase evidence only adds an actionable checkout warning, never a COA purchase-count wall.
 const evidence={vip:false,orders:[],purchaseHistory:{state:'available',checkedAt:now,matchedOrders:0,confirmedLivePurchases:0,testOrders:0,unclassifiedOrders:0,note:'INTERNAL PURCHASE AUDIT'},communicationHistory:{state:'available',checkedAt:now,outgoingCount:0,incomingCount:1,lastOutgoingAt:null,lastIncomingAt:now,recent:[{at:now,source:'customer_request',direction:'incoming',status:'submitted_coa_form'}],note:'INTERNAL CONTACT AUDIT'}};
 const coaEvidenceRequest=request('history-coa','new','contact',{origin:'coa-link',subject:'COA request',labelLot:'QA-LOT'});
 assert.equal(replyPurchaseNotice(coaEvidenceRequest,evidence),null);assert.equal(replyPurchaseNotice(coaEvidenceRequest,null),null);
 const followupRequest=request('history-order','new','contact',{origin:'order',orderId:'original-123'});
 assert.match(replyPurchaseNotice(followupRequest,null),/could not be confirmed/);
 const orderEvidence={...evidence,orders:[{number:'PAID0001',placed:'2026-10-25',status:'payment recorded; awaiting fulfillment',environment:'live',items:'Fixture item',total:'$10.00'}]};
 assert.match(replyPurchaseNotice(followupRequest,orderEvidence),/Another paid order is on file: #PAID0001/);
 assert.equal(replyPurchaseNotice(followupRequest,{...orderEvidence,orders:[{...orderEvidence.orders[0],environment:'test'}]}),null,'A test order cannot become a paid-customer warning');
 assert.match(replyPurchaseNotice(followupRequest,{...evidence,orders:[{...orderEvidence.orders[0],number:'ORIGINAL',status:'payment not confirmed'}]}),/Payment is not confirmed for order #ORIGINAL/);
 // Actual inbox polling with a deterministic browser clock: no real timer, network or send.
 for(const previousHost of [...fixtureHosts])previousHost.unmount();
 for(let i=0;i<4;i++)await Promise.resolve();
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
  assert(text(liveHost.tree).includes('Updated '),'Successful read timestamp is visible');assert(!text(liveHost.tree).includes('New requests refresh automatically every 30 seconds'),'Refresh status stays concise');
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

  // Connection evidence refreshes while the inbox stays open, without touching the reply.
  let optionCalls=0,optionGate=null;const optionRequest=request('heartbeat');
  const loadOptions=async()=>{optionCalls++;return optionGate?optionGate.promise:{...options,bridgeSeen:optionCalls===1?now-20*60000:Date.now()};};
  liveHost=mount({...readonlyProps,requests:[optionRequest],requestReplies:{heartbeat:reply('heartbeat',{status:'ready',body:'Server draft'})},onLoadOptions:loadOptions});await flush(liveHost);
  assert(text(liveHost.tree).includes('Jarvis stopped checking in'),'Old connection evidence is initially shown');assert.equal(currentDelay(),30000);openRow(liveHost,'heartbeat');type(liveHost,'replyBody','My unsaved reply stays here');
  optionGate=deferred();const optionRefresh=nextTick();pulse('window','focus');pulse('document','visibilitychange');assert.equal(optionCalls,2,'Timer, focus and visibility share one options read');
  optionGate.resolve({...options,bridgeSeen:Date.now()});optionGate=null;await optionRefresh;await flush(liveHost);
  assert(!text(liveHost.tree).includes('Jarvis stopped checking in'),'Fresh bridgeSeen clears the false stopped alarm');assert(!text(liveHost.tree).includes('Jarvis last checked in at'));assert.equal(field(liveHost,'replyBody').props.value,'My unsaved reply stays here');
  global.document.visibilityState='hidden';await nextTick();pulse('window','focus');await flush(liveHost);assert.equal(optionCalls,2,'Hidden tabs do not reload options');
  global.document.visibilityState='visible';pulse('document','visibilitychange');await flush(liveHost);assert.equal(optionCalls,3,'Returning to the visible inbox refreshes its connection evidence');
  liveHost.props={...liveHost.props,activeTab:false};liveHost.render();assert.equal(scheduled.size,0);pulse('window','focus');await flush(liveHost);assert.equal(optionCalls,3,'Inactive Requests does not refresh options');
  liveHost.props={...liveHost.props,activeTab:true};liveHost.render();await flush(liveHost);assert.equal(optionCalls,4);assert.equal(field(liveHost,'replyBody').props.value,'My unsaved reply stays here');
  optionGate=deferred();const detachedOptions=nextTick();liveHost.unmount();const optionWrites=liveHost.writes;optionGate.resolve({...options,bridgeSeen:Date.now()});optionGate=null;await detachedOptions;for(let i=0;i<4;i++)await Promise.resolve();assert.equal(liveHost.writes,optionWrites,'Late options never update an unmounted inbox');assert.equal(scheduled.size,0);liveHost=null;

  // Audit records remain inside the collapsed internal details, after the real reply workflow.
  liveHost=mount({...readonlyProps,requests:[coaEvidenceRequest],onRefreshReplies:async()=>({replies:{},customerContext:{requestId:coaEvidenceRequest.id,context:evidence}})});openRow(liveHost,coaEvidenceRequest.id);await nextTick();await flush(liveHost);
  const internalHistory=nodes(liveHost.tree).find(n=>n.type==='details'&&text(n.props.children[0])==='Internal details & actions');
  const records=nodes(liveHost.tree).find(n=>n.type==='details'&&text(n.props.children[0])==='Purchase and contact records');
  assert(internalHistory&&records);assert(nodes(internalHistory).includes(records));assert(!internalHistory.props.open&&!records.props.open);
  assert(!text(liveHost.tree).includes('purchases recorded in the live store'));assert(!text(liveHost.tree).includes('What was checked'));assert(!text(liveHost.tree).includes('INTERNAL PURCHASE AUDIT'));
  assert(nodes(liveHost.tree).indexOf(field(liveHost,'replyBody'))<nodes(liveHost.tree).indexOf(records),'The reply comes before diagnostic records');
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
 console.log('PASS: reply desk queue order (oldest unanswered first, customer replies resurface), waiting/done/spam views, learning progress, code insert, COA pick, AI draft creation, verified PDFs, race-safe checks, rewrite with draft+instruction, undo, single owner Send, staff draft-only, plain failure text, unsafe addresses blocked. Isolated fixtures, no I/O.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
