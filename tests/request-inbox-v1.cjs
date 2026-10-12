/* Actual request inbox component and hooks over conspicuous synthetic fixtures.
 * No network, production records, status API, mail client or email providers. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),projectRequire=Module.createRequire(path.join(root,'package.json'));
const ts=projectRequire('typescript'),React=projectRequire('react'),{renderToStaticMarkup}=projectRequire('react-dom/server');
let active=null;
const hooks={...React,useState(initial){if(!active)return React.useState(initial);const host=active,index=host.cursor++;if(!(index in host.slots))host.slots[index]=typeof initial==='function'?initial():initial;return[host.slots[index],value=>{host.slots[index]=typeof value==='function'?value(host.slots[index]):value;}];}};
const filename=path.join(root,'components/store/request-inbox.tsx'),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{if(id==='react')return hooks;if(id==='react/jsx-runtime')return projectRequire(id);if(id.endsWith('.module.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};throw Error('Unexpected dependency: '+id);};
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {RequestInbox,replyLink}=mod.exports;
global.fetch=()=>{throw Error('Live I/O forbidden');};
function nodes(tree,out=[]){if(Array.isArray(tree))tree.forEach(item=>nodes(item,out));else if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
function text(tree){if(tree==null||typeof tree==='boolean')return'';if(Array.isArray(tree))return tree.map(text).join(' ').replace(/\s+/g,' ').trim();return typeof tree==='object'?text(tree.props?.children):String(tree);}
function mount(props){const host={props,slots:[],cursor:0,tree:null,render(){this.cursor=0;active=this;try{this.tree=RequestInbox(this.props);return this.tree;}finally{active=null;}}};host.render();return host;}
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
let changes=[],sends=[];
const props={requests,automation,busy:false,dirty:false,refreshing:false,onStatus:(original,next)=>changes.push({original,next}),onProcess:id=>sends.push(id)};
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
query(host,'');assert.equal(cards(host).length,6);assert.equal(changes.length,0);assert.equal(sends.length,0,'Rendering and browsing never classify or send');
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
assert.equal(sends.length,0,'Status changes never delegate email processing');assert.equal(JSON.stringify({requests,automation}),before);

// Matched originals are the only explicit email action; controls also guard their handlers.
const sendRequests=[request('ready'),request('queued'),request('sending'),request('no-report'),request('not-eligible'),request('unmatched')];
const sendReport={...automation,requests:{ready:{coa:status('ready',{canProcess:true}),alert:null},queued:{coa:status('queued',{canProcess:true}),alert:null},sending:{coa:status('sending',{canProcess:true}),alert:null},'no-report':{coa:status('ready',{canProcess:true,reportId:'  '}),alert:null},'not-eligible':{coa:status('ready'),alert:null},unmatched:{coa:null,alert:null}}};
const sendProps={...props,requests:sendRequests,automation:sendReport};
host=mount(sendProps);assert.equal(controls(host.tree,'Send matched original COA').length,2);controls(host.tree,'Send matched original COA').forEach(node=>node.props.onClick());assert.deepEqual(sends,['ready','queued']);
for(const flag of ['busy','dirty','refreshing']){host=mount({...sendProps,[flag]:true});const actions=nodes(host.tree).filter(node=>node.type==='button'&&['Send matched original COA','Start review','Mark resolved','Move to spam'].includes(text(node)));assert(actions.length>0);assert(actions.every(node=>node.props.disabled));const original=[changes.length,sends.length];actions.forEach(node=>node.props.onClick());assert.deepEqual([changes.length,sends.length],original,'Disabled '+flag+' handlers cannot mutate');if(flag==='dirty')assert(text(host.tree).includes('Save or discard your unsaved admin edits'));}
for(const override of [{automation:null},{automation:{...sendReport,config:{...sendReport.config,enabled:false}}},{automation:{...sendReport,mailConfigured:false}}])assert.equal(controls(mount({...sendProps,...override}).tree,'Send matched original COA').length,0);
const prior=[changes.length,sends.length];for(let i=0;i<3;i++)mount(props);assert.deepEqual([changes.length,sends.length],prior);
assert(render({...props,requests:[]}).includes('No customer requests yet.'));

// Links are drafts only, never sends; email/subject input cannot add mail headers.
const normal=request('reply','new','contact',{email:'Mixed+tag@Example.invalid',subject:'A & B? title # fragment'});
const link=replyLink(normal),parsed=new URL(link);assert.equal(parsed.protocol,'mailto:');assert.equal(decodeURIComponent(parsed.pathname),'Mixed+tag@Example.invalid');assert.deepEqual([...parsed.searchParams.keys()],['subject']);assert.equal(parsed.searchParams.get('subject'),'Re: A & B? title # fragment');
for(const email of ['a@example.invalid\r\nBcc:other@example.invalid','a@example.invalid?bcc=other@example.invalid','a@example.invalid&bcc=other@example.invalid','a@example.invalid%0d%0aBcc:other@example.invalid','a@example.invalid,other@example.invalid','Name <a@example.invalid>','a@example.invalid;other@example.invalid','no-email','x'.repeat(255)+'@example.invalid'])assert.equal(replyLink(request('invalid','new','contact',{email})),null,email);
const injection=replyLink(request('subject','new','contact',{subject:'Subject\r\nBcc: someone@example.invalid?body=x&bcc=another@example.invalid'}));const injectionUrl=new URL(injection);assert.deepEqual([...injectionUrl.searchParams.keys()],['subject']);assert(!/[\r\n]/.test(injectionUrl.searchParams.get('subject')));assert(!/%0[ad]/i.test(injection));
assert.equal(new URL(replyLink(request('already','new','contact',{subject:'re: Existing'}))).searchParams.get('subject'),'re: Existing');
assert.equal(new URL(replyLink(request('long','new','contact',{subject:'x'.repeat(250)}))).searchParams.get('subject').length,204);
assert.equal(new URL(replyLink(request('affiliate','new','affiliate',{subject:''}))).searchParams.get('subject'),'Re: Your BIOMOD partner application');
assert.equal(new URL(replyLink(request('default','new','contact',{subject:''}))).searchParams.get('subject'),'Re: Your BIOMOD request');
for(const website of ['javascript:alert(1)','data:text/html,<script>x</script>','https://user:pass@example.invalid/','file:///tmp/private','not-a-url']){const html=render({...props,requests:[request('bad-site','new','affiliate',{website})]});assert(!html.includes('View applicant'));}
for(const website of ['https://example.invalid/profile?q=a&b=c','http://example.invalid/profile']){const html=render({...props,requests:[request('good-site','new','affiliate',{website})]});assert(html.includes('target="_blank"'));assert(html.includes('rel="noopener noreferrer"'));assert(html.includes('View applicant'))}
const escaped=render({...props,requests:[request('escape','new','contact',{name:'<script>Fixture</script>',subject:'<img src=x onerror=alert(1)>',message:'<b>Original message</b>',metadata:{value:'<script>nested</script>'},website:'javascript:alert(1)'})]});
assert(!escaped.includes('<script>'));assert(!escaped.includes('<img'));assert(!escaped.includes('<b>Original'));assert(escaped.includes('&lt;script&gt;Fixture&lt;/script&gt;'));assert(escaped.includes('&lt;script&gt;nested&lt;/script&gt;'));
assert(!escaped.includes('dangerouslySetInnerHTML'));assert(!nodes(mount(props).tree).some(node=>node.type==='form'),'Inbox cannot directly send mail or change a status through a form');
assert.equal(JSON.stringify({requests,automation}),before,'Requests and automation are never edited during display');
console.log('PASS: actual RequestInbox filters/search, explicit status callbacks, matched-original gates, accepted/duplicate no-resend, alert-versus-reply copy, draft/busy/read guards, safe mail/profile links, escaped saved content and no render-time mutation/send. Synthetic fixtures only.');
