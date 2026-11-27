// Actual full-history queue SQL and guarded work updates against isolated migrated SQLite. No providers or records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),root=path.resolve(__dirname,'..'),cache={};
global.fetch=async()=>{throw Error('External calls forbidden');};
function load(file){if(cache[file])return cache[file].exports;const m=new Module(path.join(root,file),module);cache[file]=m;m.filename=path.join(root,file);m.require=id=>id.startsWith('./')?load(path.join(path.dirname(file),id+'.ts')):require(id);m._compile(ts.transpileModule(fs.readFileSync(m.filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,m.filename);return m.exports;}
const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',f),'utf8'));
const stmt=(q,args=[])=>({bind:(...a)=>stmt(q,a),first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({meta:sql.prepare(q).run(...args)})});const db={prepare:stmt,batch:async ss=>{sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const seed=(n,status='new',data={})=>sql.prepare('INSERT INTO requests(id,kind,status,data,created) VALUES(?,?,?,?,?)').run(id(n),'contact',status,JSON.stringify({name:'Fixture '+n,email:'fixture@example.invalid',message:'Synthetic question',...data}),n);
const message=(n,direction,created,body='Synthetic message')=>sql.prepare('INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,sender,recipient) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id(n),direction,body,created,crypto.randomUUID(),'fixture@example.invalid','staff@example.invalid');
(async()=>{
 const {requestQueue}=load('lib/admin-request-queue.ts'),{saveRequestWork}=load('lib/admin-request-work.ts');
 for(let n=1;n<=251;n++)seed(n,n===1?'new':'resolved');
 let page=await requestQueue(db,{queue:'todo'});assert.equal(page.total,1);assert.equal(page.requests[0].id,id(1),'oldest unanswered request remains visible past 200 newer records');assert.equal(page.counts.done,250);
 page=await requestQueue(db,{queue:'all'});assert.equal(page.requests.length,50);assert(page.hasMore);const p2=await requestQueue(db,{queue:'all',offset:50});assert.equal(p2.requests.length,50);assert(!page.requests.some(r=>p2.requests.some(s=>s.id===r.id)));
 page=await requestQueue(db,{queue:'all',query:'Fixture 1'});assert.equal(page.total,111,'search covers the complete DB');
 message(1,'incoming',300,'Historical followup word-x');page=await requestQueue(db,{queue:'all',query:'word-x'});assert.equal(page.total,1,'search includes message history');
 seed(252,'deleted');page=await requestQueue(db,{queue:'todo',focusId:id(252)});assert.equal(page.requests.length,2);assert(!page.pageIds.includes(id(252)));assert.equal(page.requests.find(r=>r.id===id(252)).status,'deleted');
 seed(253,'new',{message:'We offer SEO services and increase your website traffic'});page=await requestQueue(db,{queue:'todo'});assert(page.pageIds.includes(id(253)),'heuristics never silently hide an unanswered message');
 const actor={email:'staff@example.invalid'},input={id:id(253),expectedVersion:0,assignee:actor.email,nextAction:'Review vendor terms',dueAt:1,resolution:'',triage:'vendor'};
 let work=await saveRequestWork(db,actor,input,[actor.email],1000);assert.equal(work.version,1);
 page=await requestQueue(db,{queue:'pitch'});assert(page.pageIds.includes(id(253)));assert.equal(page.requests[0].work.nextAction,input.nextAction);
 await assert.rejects(saveRequestWork(db,actor,input,[actor.email],1001),/teammate/);await assert.rejects(saveRequestWork(db,actor,{...input,expectedVersion:1,assignee:'unknown@example.invalid'},[actor.email]),/active team/);
 work=await saveRequestWork(db,actor,{...input,expectedVersion:1,triage:'customer'},[actor.email],1002);assert.equal(work.version,2);
 sql.prepare('INSERT INTO request_issues(request_id,issue,updated,updated_by) VALUES(?,?,?,?)').run(id(253),'vendor',1,actor.email);
 page=await requestQueue(db,{queue:'todo',assignee:actor.email,overdue:true});assert.equal(page.total,1,'manual customer correction overrides legacy vendor tag');assert.equal(page.requests[0].id,id(253));
 sql.prepare('UPDATE request_issues SET issue=? WHERE request_id=?').run('owner_review',id(253));
 await saveRequestWork(db,actor,{...input,expectedVersion:2,triage:'vendor'},[actor.email],1003);page=await requestQueue(db,{queue:'todo'});assert(page.pageIds.includes(id(253)),'vendor classification cannot hide owner review');
 seed(254);message(254,'outgoing',500);page=await requestQueue(db,{queue:'done'});assert(page.pageIds.includes(id(254)));message(254,'incoming',600);page=await requestQueue(db,{queue:'todo'});assert(page.pageIds.includes(id(254)),'new customer reply returns to queue');
 seed(255,'new',{origin:'order'});page=await requestQueue(db,{queue:'followup'});assert(page.pageIds.includes(id(255)));
 seed(256);sql.prepare('UPDATE requests SET data=? WHERE id=?').run('null',id(256));page=await requestQueue(db,{queue:'all',focusId:id(256)});assert.deepEqual(page.requests.find(r=>r.id===id(256)).data,{});
 const events=sql.prepare("SELECT actor,changes,summary FROM change_events WHERE entity_id=? AND action='request.work'").all(id(253));assert.equal(events.length,3);assert(events.every(e=>e.actor===actor.email));assert(events.every(e=>!JSON.stringify(e).includes('Review vendor terms')),'audit excludes note contents');
 console.log('PASS: complete request queues/counts/search/messages/pages/focus, exact conversation reply transitions, correction-friendly triage, guarded assignment/work saves and private audit metadata.');
})().catch(e=>{console.error(e);process.exitCode=1});
