// Forward a request to a team member on real SQLite with a mocked mail provider. No network, real records or customers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('Live I/O forbidden');};
const api=require('../lib/request-forward.ts');
(async()=>{
 const sql=new DatabaseSync(':memory:');for(const n of fs.readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',n),'utf8'));
 let failFinalPersistence=false;
 const db={prepare(q){const st=(v=[])=>({bind:(...n)=>st(n),first:async()=>sql.prepare(q).get(...v)||null,all:async()=>({results:sql.prepare(q).all(...v)}),run:async()=>{if(failFinalPersistence&&q.startsWith('UPDATE request_forwards SET status='))throw Error('Synthetic persistence failure');return {meta:sql.prepare(q).run(...v)}}});return st();}};
 const env={DB:db,RESEND_API_KEY:'synthetic-key',STORE_ADMIN_EMAILS:'owner@example.invalid'};
 sql.prepare("INSERT INTO staff(email,name,role,active,created,updated,updated_by) VALUES('logan@example.invalid','Logan','manager',1,0,0,'owner@example.invalid')").run();
 sql.prepare("INSERT INTO staff(email,name,role,active,created,updated,updated_by) VALUES('former@example.invalid','Former','support',0,0,0,'owner@example.invalid')").run();
 const id=randomUUID();sql.prepare("INSERT INTO requests(id,owner,kind,data,created) VALUES(?,NULL,'contact',?,?)").run(id,JSON.stringify({name:'Synthetic customer',email:'customer@example.invalid',subject:'Cart issue',message:'Cart will not load'}),Date.now());
 const owner={email:'owner@example.invalid',role:'owner'};const sent=[];
 const fake=async(url,init)=>{sent.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({id:randomUUID()})};};
 const team=await api.teamMembers(env);assert.deepEqual(team.map(m=>m.email),['owner@example.invalid','logan@example.invalid'],'Owners and active staff only');
 await assert.rejects(()=>api.forwardRequest(env,{requestId:id,to:'customer@example.invalid'},owner,{fetch:fake}),e=>e.status===403,'Never to a non-member');
 await assert.rejects(()=>api.forwardRequest(env,{requestId:id,to:'former@example.invalid'},owner,{fetch:fake}),e=>e.status===403,'Inactive staff are excluded');
 await assert.rejects(()=>api.forwardRequest(env,{requestId:id,to:'logan@example.invalid'},{email:'x@example.invalid',role:'fulfillment'},{fetch:fake}),e=>e.status===403);
 assert.equal(sent.length,0);
 const f=await api.forwardRequest(env,{requestId:id,to:'LOGAN@example.invalid',note:'Please check'},owner,{fetch:fake});
 assert.equal(f.status,'accepted');assert.equal(sent.length,1);assert.deepEqual(sent[0].body.to,['logan@example.invalid']);assert.equal(sent[0].body.reply_to,'owner@example.invalid');
 assert(sent[0].body.text.includes('Cart will not load'));assert(sent[0].body.text.includes('Please check'));assert(!JSON.stringify(sent).includes('"customer@example.invalid"]'),'Customer is never a recipient');
 const list=await api.forwardsFor(env,[id]);assert.equal(list[id].length,1);assert.equal(list[id][0].to,'logan@example.invalid');
 await assert.rejects(()=>api.forwardRequest(env,{requestId:id,to:'logan@example.invalid'},owner,{fetch:async()=>({ok:false,status:422,json:async()=>({})})}),e=>e.status===502);
 assert.equal((await api.forwardsFor(env,[id]))[id].at(-1).status,'failed');

 // A definite rejection permits another intended forward; accepted forwards can be sent again intentionally.
 const retry=await api.forwardRequest(env,{requestId:id,to:'logan@example.invalid'},owner,{fetch:fake});
 assert.equal(retry.status,'accepted');assert.equal(sent.length,2);
 const again=await api.forwardRequest(env,{requestId:id,to:'logan@example.invalid',note:'Intentional follow-up'},owner,{fetch:fake});
 assert.equal(again.status,'accepted');assert.equal(sent.length,3);
 // A lost provider acknowledgement must not create a second random-key send on retry.
 const lostKeys=[];
 const lost=async(url,init)=>{lostKeys.push(init.headers['Idempotency-Key']);throw Error('Synthetic response loss after provider accepted');};
 await assert.rejects(()=>api.forwardRequest(env,{requestId:id,to:'logan@example.invalid',note:'Lost acknowledgement'},owner,{fetch:lost}),e=>e.status===502&&/status unconfirmed/.test(e.message));
 assert.equal((await api.forwardsFor(env,[id]))[id].at(-1).status,'unknown');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM request_forwards WHERE request_id=? AND status='sending'").get(id).n,1,'Unknown provider result retains its durable lock');
 await assert.rejects(()=>api.forwardRequest(env,{requestId:id,to:'LOGAN@example.invalid',note:'Edited note cannot bypass the unresolved send'},owner,{fetch:lost}),e=>e.status===409&&/status unconfirmed/.test(e.message));
 assert.equal(lostKeys.length,1,'Retry is blocked before a second provider call/key');
 assert((await api.activityFor(env,[id]))[id].some(a=>a.text.startsWith('Forward status unconfirmed to')));
 // Atomic claim protects simultaneous callers, including a different staff actor.
 const raceId=randomUUID();sql.prepare("INSERT INTO requests(id,owner,kind,data,created) VALUES(?,NULL,'contact',?,?)").run(raceId,JSON.stringify({email:'customer@example.invalid',message:'Race fixture'}),Date.now());
 let release;const pending=new Promise(resolve=>{release=resolve});let started;const begins=new Promise(resolve=>{started=resolve});let raceCalls=0;
 const first=api.forwardRequest(env,{requestId:raceId,to:'logan@example.invalid'},owner,{fetch:async()=>{raceCalls++;started();return pending;}});
 await begins;
 await assert.rejects(()=>api.forwardRequest(env,{requestId:raceId,to:'logan@example.invalid'},{email:'support@example.invalid',role:'support'},{fetch:fake}),e=>e.status===409);
 assert.equal(raceCalls,1);release({ok:true,json:async()=>({id:randomUUID()})});await first;
 // Provider acceptance followed by failed persistence remains unknown and retains the durable lock.
 const persistenceId=randomUUID();sql.prepare("INSERT INTO requests(id,owner,kind,data,created) VALUES(?,NULL,'contact',?,?)").run(persistenceId,JSON.stringify({email:'customer@example.invalid',message:'Persistence fixture'}),Date.now());
 const beforePersistenceCalls=sent.length;failFinalPersistence=true;
 await assert.rejects(()=>api.forwardRequest(env,{requestId:persistenceId,to:'logan@example.invalid'},owner,{fetch:fake}),e=>e.status===502&&/status unconfirmed/.test(e.message));
 failFinalPersistence=false;
 assert.equal((await api.forwardsFor(env,[persistenceId]))[persistenceId][0].status,'unknown');
 await assert.rejects(()=>api.forwardRequest(env,{requestId:persistenceId,to:'logan@example.invalid'},owner,{fetch:fake}),e=>e.status===409);
 assert.equal(sent.length,beforePersistenceCalls+1,'A failed acceptance write cannot trigger another provider send');
 // Server errors, timeout/conflict statuses and malformed success bodies preserve the same protection.
 for(const response of [{ok:false,status:500},{ok:false,status:408},{ok:false,status:409},{ok:true,json:async()=>{throw Error('Synthetic unreadable response');}},{ok:true,json:async()=>({id:'invalid'})}]){
  const unknownId=randomUUID();sql.prepare("INSERT INTO requests(id,owner,kind,data,created) VALUES(?,NULL,'contact',?,?)").run(unknownId,JSON.stringify({email:'customer@example.invalid',message:'Unknown fixture'}),Date.now());let calls=0;
  const provider=async()=>{calls++;return response;};
  await assert.rejects(()=>api.forwardRequest(env,{requestId:unknownId,to:'logan@example.invalid'},owner,{fetch:provider}),e=>e.status===502&&/status unconfirmed/.test(e.message));
  await assert.rejects(()=>api.forwardRequest(env,{requestId:unknownId,to:'logan@example.invalid'},owner,{fetch:provider}),e=>e.status===409);
  assert.equal(calls,1);assert.equal((await api.forwardsFor(env,[unknownId]))[unknownId][0].status,'unknown');
 }

 sql.prepare("UPDATE requests SET status='deleted' WHERE id=?").run(id);
 const act=(await api.activityFor(env,[id]))[id].map(x=>x.text);assert(act.some(t=>t.startsWith('Forwarded to logan@example.invalid by owner@example.invalid')));assert(act.some(t=>t.startsWith('Forward failed')));assert(act.some(t=>t.startsWith('Deleted')),'Status changes are in the activity record');
 console.log('PASS: forwards go only to owners/active staff, reply-to is the forwarder, customer never emailed, history recorded, definite rejections retry, accepted forwards remain repeatable, ambiguous outcomes stay unknown and block duplicate/raced sends. Isolated SQLite, mocked provider.');
})().catch(e=>{console.error(e);process.exitCode=1;});
