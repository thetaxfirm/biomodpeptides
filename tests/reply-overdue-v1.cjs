// Daily "customers waiting" digest on real SQLite with a mocked mail provider. No real email, synthetic records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('Live I/O forbidden');};
const {overdueCustomers,runOverdueDigest}=require('../lib/reply-overdue.ts');
(async()=>{
 const sql=new DatabaseSync(':memory:');for(const n of fs.readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',n),'utf8'));
 const db={prepare(q){const st=(v=[])=>({bind:(...n)=>st(n),first:async()=>sql.prepare(q).get(...v)||null,all:async()=>({results:sql.prepare(q).all(...v)}),run:async()=>({meta:sql.prepare(q).run(...v)})});return st();}};
 const env={DB:db,RESEND_API_KEY:'synthetic',STORE_ADMIN_EMAILS:'owner@example.invalid'};
 const now=Date.parse('2026-10-14T17:00:00Z'),day=86400000;
 const add=(data,created,status='new')=>{const id=randomUUID();sql.prepare("INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,NULL,'contact',?,?,?)").run(id,JSON.stringify(data),status,created);return id;};
 add({name:'Albert A',email:'Albert@Example.invalid',subject:'Cart',message:'Cart broken'},now-6*day);add({name:'Albert Alvarez',email:'albert@example.invalid',subject:'COA',message:'Need COA'},now-4*day);
 add({name:'Fresh',email:'fresh@example.invalid',subject:'Hi',message:'New today'},now-3600000);
 add({name:'Vendor',email:'vendor@example.invalid',subject:'High quality peptides',message:'We are a leading manufacturer'},now-5*day);
 const answered=add({name:'Answered',email:'done@example.invalid',subject:'Q',message:'q'},now-3*day);
 sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,sender,recipient) VALUES('m',?,'outgoing','a',?,'p','contact@trybiomod.com','done@example.invalid')").run(answered,now-2*day);
 const phoned=add({name:'Phoned',email:'phone@example.invalid',subject:'Q',message:'q'},now-3*day);
 sql.prepare("INSERT INTO request_external_replies(id,request_id,source,account,sent_at,body,recorded_by,created) VALUES('e',?,'manual','owner@example.invalid',?,'Called','owner@example.invalid',?)").run(phoned,now-2*day,now);
 add({name:'Closed',email:'closed@example.invalid',subject:'Q',message:'q'},now-3*day,'resolved');
 const orderDraft=add({name:'Store Followup',email:'followup@example.invalid',origin:'order',subject:'Saved order',message:'Internal order context'},now-8*day);
 const orderReply=add({name:'Replying Customer',email:'return@example.invalid',origin:'order',subject:'Saved order',message:'Internal order context'},now-8*day);
 const incoming=(id,request,at)=>sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,sender,recipient) VALUES(?,?,'incoming','Synthetic customer message',?,'fixture','return@example.invalid','contact@trybiomod.com')").run(id,request,at);
 incoming('recent-customer-message',orderReply,now-3600000);
 const waiting=await overdueCustomers(env,now);
 assert.deepEqual(waiting.map(w=>[w.email,w.count]),[['albert@example.invalid',2]],'Only real customers with no reply, grouped by email');
 assert(!waiting.some(w=>['followup@example.invalid','return@example.invalid'].includes(w.email)),'internal conversation and recent actual reply do not create overdue urgency');
 const later=await overdueCustomers(env,now+2*day);
 const actualWait=later.find(w=>w.email==='return@example.invalid');
 assert(actualWait);assert.equal(actualWait.since,now-3600000,'wait clock begins at the customer reply, not the internal creation');
 assert(!later.some(w=>w.email==='followup@example.invalid'),'unsent internal draft never becomes a waiting customer');
 const sent=[];const fake=async(url,init)=>{sent.push(JSON.parse(init.body));return {ok:true,json:async()=>({id:'x'})};};
 assert.equal((await runOverdueDigest(env,Date.parse('2026-10-14T13:00:00Z'),{fetch:fake})).reason,'too_early','Not before 8 am Pacific');
 const r=await runOverdueDigest(env,now,{fetch:fake});assert.equal(r.sent,true);assert.equal(sent.length,1);
 assert.deepEqual(sent[0].to,['owner@example.invalid']);assert.match(sent[0].subject,/1 customer is waiting/);assert.match(sent[0].text,/Albert A \(albert@example.invalid\): Cart \(\+1 more\), waiting 6 days/);assert.match(sent[0].text,/admin\?tab=requests/);
 assert.equal((await runOverdueDigest(env,now+3600000,{fetch:fake})).reason,'already_today');assert.equal(sent.length,1,'Once a day');
 // A new follow-up must not inherit urgency from a request already answered.
 const earlier=add({name:'Clock reset',email:'reset@example.invalid',subject:'Older question',message:'Old'},now-10*day);
 sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,sender,recipient) VALUES('reset-answer',?,'outgoing','Synthetic answer',?,'reset-answer','contact@trybiomod.com',' RESET@EXAMPLE.INVALID ')").run(earlier,now-2*day);
 add({name:'Clock reset',email:'reset@example.invalid',subject:'New follow-up',message:'New question'},now-3600000);
 assert(!(await overdueCustomers(env,now)).some(w=>w.email==='reset@example.invalid'),'Old answered row cannot make a recent question overdue');
 const resetWait=(await overdueCustomers(env,now+2*day)).find(w=>w.email==='reset@example.invalid');assert(resetWait);assert.equal(resetWait.since,now-3600000);assert.equal(resetWait.subject,'New follow-up');assert.equal(resetWait.count,1,'Only unanswered requests count');
 // A reply or phone note recorded on a closed sibling still answers the same customer's earlier question.
 const stillOpen=add({name:'Sibling answered',email:'sibling@example.invalid',subject:'Question',message:'Question'},now-5*day);
 const closedSibling=add({name:'Sibling answered',email:' SIBLING@EXAMPLE.INVALID ',subject:'Related question',message:'Related'},now-4*day,'resolved');
 sql.prepare("INSERT INTO request_external_replies(id,request_id,source,account,sent_at,body,recorded_by,created) VALUES('closed-sibling-note',?,'manual','owner@example.invalid',?,'Synthetic call note','owner@example.invalid',?)").run(closedSibling,now-3*day,now);
 assert(!(await overdueCustomers(env,now)).some(w=>w.email==='sibling@example.invalid'),'Closed-sibling contact is considered without merging other customers');
 // The sent conversation remains resolved in storage when mailbox follow-ups arrive; real unanswered replies still surface.
 const repliedAgain=add({name:'Wrote again',email:'return@example.invalid',origin:'order',subject:'A real later question',message:'Internal context'},now-8*day,'resolved');
 sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,sender,recipient) VALUES('closed-answer',?,'outgoing','Synthetic answer',?,'closed-answer','contact@trybiomod.com','return@example.invalid')").run(repliedAgain,now-4*day);
 incoming('closed-customer-followup',repliedAgain,now-2*day);
 const reopenedWait=(await overdueCustomers(env,now)).find(w=>w.email==='return@example.invalid');assert(reopenedWait);assert.equal(reopenedWait.since,now-2*day,'A true follow-up after an answer remains actionable even if the storage status is resolved');
 const archivedWithoutAnswer=add({name:'Archived without reply',email:'archived@example.invalid',subject:'Archived',message:'Old'},now-8*day,'resolved');incoming('archived-incoming',archivedWithoutAnswer,now-2*day);assert(!(await overdueCustomers(env,now)).some(w=>w.email==='archived@example.invalid'),'An explicit closure with no earlier answer stays closed');
 // A message addressed elsewhere is not evidence that this customer was answered.
 const untouched=add({name:'Unanswered',email:'untouched@example.invalid',subject:'Still unanswered',message:'Question'},now-3*day);
 sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,sender,recipient) VALUES('wrong-recipient-answer',?,'outgoing','Synthetic unrelated message',?,'wrong-recipient-answer','contact@trybiomod.com','elsewhere@example.invalid')").run(untouched,now-2*day);
 assert((await overdueCustomers(env,now)).some(w=>w.email==='untouched@example.invalid'),'Recipient identity is required for an email to clear a waiting customer');
 sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,sender,recipient) VALUES('final-answer',?,'outgoing','Synthetic final answer',?,'final-answer','contact@trybiomod.com','return@example.invalid')").run(repliedAgain,now+1);
 sql.exec("UPDATE requests SET status='resolved'");assert.equal((await runOverdueDigest(env,now+day,{fetch:fake})).reason,'nobody_waiting');assert.equal(sent.length,1,'No email when nobody waits');
 console.log('PASS: daily owner digest lists real customers waiting over a day (grouped by email; pitches, answered, phoned and closed excluded), mornings only, once a day, nothing when nobody waits. Mocked provider.');
})().catch(e=>{console.error(e);process.exitCode=1;});
