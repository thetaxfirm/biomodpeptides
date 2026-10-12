/* Actual stateless COA admin UI. Synthetic configuration/status fixtures only.
 * No network, account, customer, PDF contents or mail/provider calls. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=process.env.BIOMOD_COA_UI_TEST_ROOT||path.resolve(__dirname,'..');
const projectRequire=Module.createRequire(path.join(root,'package.json'));
const ts=projectRequire('typescript'),React=projectRequire('react'),{renderToStaticMarkup}=projectRequire('react-dom/server');
global.fetch=()=>{throw Error('Live I/O forbidden');};
const filename=path.join(root,'components/store/coa-automation.tsx'),mod=new Module(filename,module);
mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
mod.require=id=>{if(id==='react/jsx-runtime')return projectRequire(id);if(id.endsWith('.module.css'))return{};throw Error('Unexpected runtime dependency: '+id);};
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const {CoaAutomation}=mod.exports;
const status=(value,extra={})=>({status:value,reason:'Synthetic status explanation.',acceptedAt:null,canProcess:value==='ready'||value==='queued',productName:'Fixture research material',strength:'10 mg',lot:'QA-LOT',reportId:'QA-REPORT',...extra});
const report={config:{enabled:true,replyTo:'reply@example.invalid',notifyTo:'notify@example.invalid'},mailConfigured:true,sender:'sender@example.invalid',requests:{
 'ready-request':{coa:status('ready'),alert:null},'queued-request':{coa:status('queued'),alert:null},
 'sending-request':{coa:status('sending',{canProcess:true}),alert:null},
 'accepted-request':{coa:status('accepted',{canProcess:true,acceptedAt:Date.parse('2026-10-11T09:00:00Z')}),alert:status('accepted')},
 'review-request':{coa:status('manual_review',{canProcess:true}),alert:null},
 'duplicate-request':{coa:status('duplicate',{canProcess:true}),alert:null},
 'unmatched-request':{coa:status('ready',{reportId:''}),alert:null},
 'ineligible-request':{coa:status('ready',{canProcess:false}),alert:null},
 'unassessed-request':{coa:null,alert:null},'alert-only-request':{coa:null,alert:status('queued')},
}};
let drafts=0,saves=[],sends=[];
const requestContext=[{id:'queued-request',kind:'contact',created:Date.parse('2026-10-11T08:00:00Z'),data:{name:'Fixture Queue',email:'queue@example.invalid',subject:'COA for queued original'}},{id:'ready-request',kind:'contact',created:Date.parse('2026-10-11T07:00:00Z'),data:{name:'<script>Fixture Ready</script>',subject:'Original <b>COA</b>'}},{id:'alert-only-request',kind:'affiliate',data:{email:'partner@example.invalid'}}];
const props={report,requests:requestContext,busy:false,dirty:false,refreshing:false,onDraft:()=>drafts++,onSave:event=>saves.push(event),onProcess:id=>sends.push(id)};
function nodes(t,out=[]){if(Array.isArray(t))t.forEach(x=>nodes(x,out));else if(t&&typeof t==='object'&&t.props){out.push(t);nodes(t.props.children,out);}return out;}
function text(t){if(t==null||typeof t==='boolean')return'';if(Array.isArray(t))return t.map(text).join(' ');return typeof t==='object'?text(t.props?.children):String(t);}
const render=p=>renderToStaticMarkup(React.createElement(CoaAutomation,p));
const sendButtons=p=>nodes(CoaAutomation(p)).filter(n=>n.type==='button'&&text(n)==='Send original COA');
const form=p=>nodes(CoaAutomation(p)).find(n=>n.type==='form');
const before=JSON.stringify(report),html=render(props);
assert.match(html,/COA email automation/);assert.match(html,/Automation is <strong>enabled/);
for(const address of ['reply@example.invalid','notify@example.invalid','sender@example.invalid'])assert(html.includes(address));
for(const label of ['Ready to send','Queued','Sending','Accepted by mail provider','Review needed','Duplicate request'])assert(html.includes(label));
assert.match(html,/does not confirm inbox delivery/);assert.match(html,/Request review status remains separate/);
assert(html.includes('2026-10-11T09:00:00.000Z'));assert(html.includes('QA-REPORT'));assert(html.includes('QA-LOT'));
assert(!html.includes('unassess'),'Unassessed ordinary requests are not outbox records');
assert(html.includes('partner@example.invalid'));assert(html.includes('Partner application'));assert(html.includes('2026-10-11T08:00:00.000Z'));assert(html.includes('older requests do not trigger notifications'));
const requestCards=nodes(CoaAutomation(props)).filter(n=>n.type==='article');
const alertOnly=render({...props,report:{...report,requests:{'alert-only-request':report.requests['alert-only-request']}}});
assert(alertOnly.includes('Request notification'));assert(!alertOnly.includes('Original COA'));assert(!alertOnly.includes('Not queued'));assert(!alertOnly.includes('No COA email needed'));assert(!alertOnly.includes('Send original COA'));
assert(text(requestCards.find(n=>n.key==='ready-request')).includes('<script>Fixture Ready</script>'));assert(!text(requestCards.find(n=>n.key==='ready-request')).includes('Fixture Queue'));
assert(text(requestCards.find(n=>n.key==='queued-request')).includes('Fixture Queue'));assert(text(requestCards.find(n=>n.key==='queued-request')).includes('COA for queued original'));
assert(!html.includes('<script>'));assert(!html.includes('<b>COA'));assert(html.includes('&lt;script&gt;Fixture Ready&lt;/script&gt;'));
assert.equal(sendButtons(props).length,2);sendButtons(props).forEach(button=>button.props.onClick());assert.deepEqual(sends,['ready-request','queued-request']);
assert.equal(JSON.stringify(report),before,'Rendering never mutates report data');
for(const restriction of [{busy:true},{dirty:true},{refreshing:true}]){
 const p={...props,...restriction},buttons=sendButtons(p);assert.equal(buttons.length,2);assert(buttons.every(n=>n.props.disabled));
 const count=sends.length;buttons.forEach(n=>n.props.onClick());assert.equal(sends.length,count,'Disabled handlers do not submit a send');
}
for(const adjusted of [{...report,config:{...report.config,enabled:false}},{...report,mailConfigured:false}])assert.equal(sendButtons({...props,report:adjusted}).length,0);
const unavailable=render({...props,report:null});assert.match(unavailable,/details are unavailable/);assert(!unavailable.includes('<form'));assert(!unavailable.includes('Send original COA'));
const disabledHtml=render({...props,report:{...report,config:{enabled:false,replyTo:'',notifyTo:null},mailConfigured:false,sender:'',requests:{}}});
assert.match(disabledHtml,/Automation is <strong>disabled/);assert.match(disabledHtml,/Email sending is not configured/);assert.match(disabledHtml,/No COA automation records/);assert(!disabledHtml.includes('notify@example.invalid'));
const currentForm=form(props),event={prevented:0,preventDefault(){this.prevented++;},currentTarget:{}};
currentForm.props.onChangeCapture();assert.equal(drafts,1);
currentForm.props.onSubmit(event);assert.equal(event.prevented,1);assert.equal(saves.length,1);assert.equal(saves[0],event);
for(const restriction of [{busy:true},{refreshing:true}]){form({...props,...restriction}).props.onSubmit(event);assert.equal(saves.length,1);}
const inputs=nodes(CoaAutomation(props)).filter(n=>n.type==='input');
assert.equal(inputs.find(n=>n.props.name==='enabled').props.defaultChecked,true);
assert.equal(inputs.find(n=>n.props.name==='replyTo').props.type,'email');assert.equal(inputs.find(n=>n.props.name==='replyTo').props.required,true);
assert.equal(inputs.find(n=>n.props.name==='notifyTo').props.defaultValue,'notify@example.invalid');
assert(inputs.every(n=>n.props.disabled===false));assert(nodes(CoaAutomation({...props,busy:true})).filter(n=>n.type==='input').every(n=>n.props.disabled));
const hidden='PRIVATE_FIXTURE_MUST_NOT_RENDER';
const sanitized=render({...props,report:{...report,privateRegistryKey:hidden,requests:{private:{coa:{...status('ready'),pdfBytes:hidden,privateKey:hidden,recipient:hidden},alert:null}}}});
assert(!sanitized.includes(hidden));assert(!html.includes('href='),'UI never exposes private PDF URLs or downloads');
const reasonCopy=render({...props,report:{...report,requests:{review:{coa:status('manual_review',{reason:'no_exact_original'}),alert:null},unknown:{coa:status('manual_review',{reason:hidden}),alert:null}}}});
assert(reasonCopy.includes('No approved original matches'));assert(!reasonCopy.includes('no_exact_original'));assert(!reasonCopy.includes(hidden),'Unexpected internal reasons are never reflected verbatim');
const duplicateRelation=render({...props,report:{...report,requests:{duplicate:{coa:status('duplicate',{reason:'same_original_already_queued_accepted_or_under_review',duplicateOfRequestId:'queued-request',relatedStatus:'accepted',acceptedAt:Date.parse('2026-10-11T09:00:00Z')}),alert:null}}}});
assert(duplicateRelation.includes('Earlier request: Fixture Queue'));assert(duplicateRelation.includes('Earlier message accepted'));assert(duplicateRelation.includes('queued, accepted or under review'));assert(!duplicateRelation.includes('Send original COA'));
const duplicateReview=render({...props,report:{...report,requests:{duplicate:{coa:status('duplicate',{duplicateOfRequestId:'queued-request',relatedStatus:'manual_review',acceptedAt:Date.parse('2026-10-11T09:00:00Z')}),alert:null}}}});
assert(!duplicateReview.includes('Earlier message accepted'));assert(!duplicateReview.includes('<time'),'Acceptance time only belongs to an actually accepted related message');
const malformed=render({...props,report:{...report,requests:{unknown:{coa:status('unexpected',{canProcess:true}),alert:null},badDate:{coa:status('accepted',{acceptedAt:NaN}),alert:null}}}});
assert(malformed.includes('Status unavailable'));assert(!malformed.includes('Invalid Date'));assert(!malformed.includes('Send original COA'));
console.log('PASS: actual COA admin UI states/configuration, strict eligible-original send gates, accepted-not-delivered copy, unavailable/disabled behavior, dirty/busy/read guards, delegated form callbacks, and no private source payload rendering. No live I/O.');
