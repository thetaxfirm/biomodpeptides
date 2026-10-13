// Order conversations and case tracking on real SQLite. No network, no email, synthetic records only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('Live I/O forbidden');};
const cases=require('../lib/request-cases.ts'),replies=require('../lib/request-replies.ts');
(async()=>{
 const sql=new DatabaseSync(':memory:');for(const n of fs.readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',n),'utf8'));
 const db={prepare(q){const st=(v=[])=>({_sql:q,bind:(...n)=>st(n),first:async()=>sql.prepare(q).get(...v)||null,all:async()=>({results:sql.prepare(q).all(...v)}),_execute(){const s=sql.prepare(q);if(s.columns().length){const results=s.all(...v);return {results,success:true,meta:{changes:sql.prepare('SELECT changes() n').get().n}};}return {results:[],success:true,meta:s.run(...v)};},async run(){return this._execute();}});return st();},async batch(list){sql.exec('BEGIN');try{const out=list.map(s=>s._execute());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB:db},owner={email:'owner@example.invalid',role:'owner'};
 const orderId='ord_'+randomUUID().slice(0,12);
 sql.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(orderId,'synthetic-owner','rk-'+orderId,'paid',14842,JSON.stringify({email:'buyer@example.invalid',address:{name:'Synthetic Buyer'},items:[{id:1,quantity:1,product:{name:'Fixture vial',activePreorder:{ships:'Nov'}}}]}),Date.now(),Date.now());
 await assert.rejects(()=>cases.startOrderConversation(env,orderId,{email:'f@example.invalid',role:'fulfillment'}),e=>e.status===403);
 const first=await cases.startOrderConversation(env,orderId,owner);assert.equal(first.created,true);
 const again=await cases.startOrderConversation(env,orderId,owner);assert.equal(again.requestId,first.requestId,'One conversation per order');assert.equal(again.created,false);
 const row=sql.prepare('SELECT * FROM requests WHERE id=?').get(first.requestId);const data=JSON.parse(row.data);
 assert.equal(data.email,'buyer@example.invalid');assert.equal(data.origin,'order');assert.match(data.message,/1 × Fixture vial \(preorder\)/);assert.equal(data.subject,'Your BioMod order #'+orderId.slice(0,8).toUpperCase());
 // A draft for an order conversation keeps its own subject (no "Re:") and carries the decided case to the AI.
 await cases.saveRequestIssue(env,{requestId:first.requestId,issue:'out_of_stock',resolutions:['waiting','discount','bogus'],note:'Offer 30% next order'},owner);
 await assert.rejects(()=>cases.saveRequestIssue(env,{requestId:first.requestId,issue:'made_up'},owner),e=>e.status===400);
 const issue=(await cases.issuesFor(env,[first.requestId]))[first.requestId];assert.deepEqual(issue.resolutions,['waiting','discount'],'Unknown resolutions are dropped');
 await replies.saveReplyRule(env,{rule:'Out of stock: offer wait, refund, credit or substitute.',issue:'out_of_stock'},owner);await replies.saveReplyRule(env,{rule:'Shipping rule',issue:'shipping'},owner);await replies.saveReplyRule(env,{rule:'Sign off as Ash.'},owner);
 const draft=await replies.prepareRequestReply(env,{requestId:first.requestId,mode:'ai',instruction:'tell him it is not ready',expectedRevision:null},owner);assert.equal(draft.subject,data.subject);
 const job=(await replies.handleReplyBridge(env,{action:'claim'})).job;assert.equal(job.request.origin,'order');assert.match(job.caseInfo,/Item not in stock yet[\s\S]*Customer will wait, Discount on next order[\s\S]*30%/);
 assert.deepEqual(job.style.rules.sort(),['Out of stock: offer wait, refund, credit or substitute.','Sign off as Ash.'],'General rules plus only this issue\'s rules');
 const log=await cases.caseLog(env);assert.equal(log.length,1);assert.equal(log[0].name,'Synthetic Buyer');
 console.log('PASS: one conversation per order with staff-only order context, order subject kept, issue + resolutions validated, issue-scoped rules and the decided case reach the AI, case log for rules. Isolated SQLite, no email.');
})().catch(e=>{console.error(e);process.exitCode=1;});
