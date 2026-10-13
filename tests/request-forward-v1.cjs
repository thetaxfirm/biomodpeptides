// Forward a request to a team member on real SQLite with a mocked mail provider. No network, real records or customers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('Live I/O forbidden');};
const api=require('../lib/request-forward.ts');
(async()=>{
 const sql=new DatabaseSync(':memory:');for(const n of fs.readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',n),'utf8'));
 const db={prepare(q){const st=(v=[])=>({bind:(...n)=>st(n),first:async()=>sql.prepare(q).get(...v)||null,all:async()=>({results:sql.prepare(q).all(...v)}),run:async()=>({meta:sql.prepare(q).run(...v)})});return st();}};
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
 await assert.rejects(()=>api.forwardRequest(env,{requestId:id,to:'logan@example.invalid'},owner,{fetch:async()=>({ok:false,json:async()=>({})})}),e=>e.status===502);
 assert.equal((await api.forwardsFor(env,[id]))[id].at(-1).status,'failed');
 console.log('PASS: forwards go only to owners/active staff, reply-to is the forwarder, customer never emailed, history recorded, failures visible. Isolated SQLite, mocked provider.');
})().catch(e=>{console.error(e);process.exitCode=1;});
