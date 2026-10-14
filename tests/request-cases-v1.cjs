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
 // Hold: a reported problem parks the order in Needs review; label purchase and Mark shipped refuse until cleared.
 const fulfillment=require('../lib/fulfillment.ts');
 const hold=await cases.setOrderHold(env,orderId,{issue:'out_of_stock',note:'Restock in November'},owner);assert.equal(hold.issue,'out_of_stock');
 const held=JSON.parse(sql.prepare('SELECT data FROM orders WHERE id=?').get(orderId).data);assert.equal(held.hold.by,owner.email);
 assert.equal(fulfillment.orderBucket({status:'paid',data:held}),'review');
 const label=sql.prepare("UPDATE orders SET status='labeling' WHERE id=? AND status='paid' AND json_extract(data,'$.shipment') IS NULL AND json_extract(data,'$.hold') IS NULL").run(orderId);assert.equal(label.changes,0,'Label claim refuses a held order');
 await assert.rejects(()=>cases.setOrderHold(env,orderId,{issue:'nope'},owner),e=>e.status===400);
 await cases.setOrderHold(env,orderId,null,owner);assert.equal(JSON.parse(sql.prepare('SELECT data FROM orders WHERE id=?').get(orderId).data).hold,undefined);
 await assert.rejects(()=>cases.setOrderHold(env,orderId,null,owner),e=>e.status===409);
 assert.equal(fulfillment.orderBucket({status:'paid',data:{}}),'to_ship');
 assert(require('../lib/request-issues.ts').resolutionTypes.some(([k,l])=>k==='free_item'&&/free item of their choice/i.test(l)));
 // Win-back: unpaid orders only; the chosen template becomes a draft (never sent); templates render with real codes and no auto-recovery conflict.
 const unpaid='ord_'+randomUUID().slice(0,12);const product=require('../lib/catalog.ts').products[0];
 sql.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(unpaid,'synthetic-owner','rk-'+unpaid,'awaiting_payment',22759,JSON.stringify({email:'cart@example.invalid',address:{name:'Bruno Synthetic'},items:[{id:product.id,quantity:2,product:{name:product.name}}]}),Date.now(),Date.now());
 await assert.rejects(()=>cases.startWinBack(env,orderId,'help',owner),e=>e.status===409,'Paid orders are not win-back targets');
 await assert.rejects(()=>cases.startWinBack(env,unpaid,'made-up',owner),e=>e.status===400);
 const wb=await cases.startWinBack(env,unpaid,'off-30',owner);
 const wbRow=sql.prepare('SELECT * FROM request_reply_drafts WHERE request_id=?').get(wb.requestId);assert.equal(wbRow.mode,'staff');assert.equal(wbRow.status,'queued');assert.equal(wbRow.approved_at,null,'A win-back draft is never approved to send');
 assert.match(wbRow.proposed_body,/Hi Bruno,/);assert.match(wbRow.proposed_body,/30% off[\s\S]*code COMEBACK30/);assert(wbRow.proposed_body.includes('https://trybiomod.com/product/'+product.slug));
 assert.match(wbRow.subject,new RegExp('^Bruno, your '+product.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' order is saved$'));
 assert.equal((await cases.issuesFor(env,[wb.requestId]))[wb.requestId].issue,'unfinished_checkout');
 sql.prepare("INSERT INTO checkout_recovery(order_id,status,reason,recipient_hash,unsubscribe_token,payload,original_snapshot,savings,attempts,next_attempt_at,created,updated) VALUES(?,'accepted','accepted','h',?,'{}','{}',1234,1,0,0,0)").run(unpaid,randomUUID());
 const previews=await cases.winBackPreview(env,wb.requestId);assert.deepEqual(previews.map(t=>t.id),['help','reminder','founder','off-10','off-15','off-20','off-25','off-30','last']);
 const live=require('../lib/promotions.ts').activePromotions().map(p=>p.code);assert(previews.every(t=>(t.body.match(/COMEBACK\d+/g)||[]).every(code=>live.includes(code))),'Every code in a template is a real active code');
 assert.match(previews.find(t=>t.id==='help').body,/\$12\.34 saving/,'Mentions the automatic recovery saving already applied');
 assert(previews.every(t=>!/expires|only today|hurry|last chance/i.test(t.body)),'No invented urgency');
 const againWb=await cases.startWinBack(env,unpaid,'last',owner);assert.equal(againWb.requestId,wb.requestId,'Same conversation reused');assert.match(sql.prepare('SELECT proposed_body FROM request_reply_drafts WHERE request_id=?').get(wb.requestId).proposed_body,/won't send another reminder/);
 // Replies outside the desk: Jarvis mailbox findings and manual notes; desk sends and pre-request mail are ignored; duplicates collapse.
 const ext=require('../lib/request-external.ts');
 const open=(await replies.handleReplyBridge(env,{action:'open_requests'})).requests;assert(open.some(r=>r.id===wb.requestId&&r.email==='cart@example.invalid'));
 const created=sql.prepare('SELECT created FROM requests WHERE id=?').get(wb.requestId).created;
 const found={requestId:wb.requestId,account:'research@biomodpeptides.com',messageId:'gmail-1',sentAt:created+1000,body:'Sent from Gmail',preview:false};
 await replies.handleReplyBridge(env,{action:'external_replies',replies:[found,found,{...found,messageId:'gmail-old',sentAt:created-3600000}]});
 sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,provider_thread_id,sender,recipient) VALUES('m1',?,'outgoing','desk',?,'gmail-desk',NULL,'research@biomodpeptides.com','cart@example.invalid')").run(wb.requestId,created+5);
 await replies.handleReplyBridge(env,{action:'external_replies',replies:[{...found,messageId:'gmail-desk'}]});
 let extList=(await ext.externalRepliesFor(env,[wb.requestId]))[wb.requestId];assert.equal(extList.length,1,'One per message; old mail and desk sends ignored');assert.equal(extList[0].account,'research@biomodpeptides.com');
 await assert.rejects(()=>replies.handleReplyBridge(env,{action:'external_replies',replies:[{...found,requestId:'not-a-uuid'}]}),e=>e.status===400);
 await assert.rejects(()=>ext.markReplied(env,{requestId:wb.requestId},{email:'f@example.invalid',role:'fulfillment'}),e=>e.status===403);
 await ext.markReplied(env,{requestId:wb.requestId,note:'Called him'},owner);extList=(await ext.externalRepliesFor(env,[wb.requestId]))[wb.requestId];assert.equal(extList.find(e=>e.source==='manual').body,'Called him');
 console.log('PASS: one conversation per order with staff-only order context, order subject kept, issue + resolutions validated, issue-scoped rules and the decided case reach the AI, case log for rules. Isolated SQLite, no email.');
})().catch(e=>{console.error(e);process.exitCode=1;});
