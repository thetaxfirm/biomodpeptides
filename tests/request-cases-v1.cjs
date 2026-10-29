// Order conversations and case tracking on real SQLite. No network, no email, synthetic records only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('Live I/O forbidden');};
const cases=require('../lib/request-cases.ts'),replies=require('../lib/request-replies.ts');
(async()=>{
 const sql=new DatabaseSync(':memory:');for(const n of fs.readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',n),'utf8'));
 const hooks={};
 const db={prepare(q){const st=(v=[])=>({_sql:q,bind:(...n)=>st(n),first:async()=>sql.prepare(q).get(...v)||null,all:async()=>({results:sql.prepare(q).all(...v)}),_execute(){const s=sql.prepare(q);if(s.columns().length){const results=s.all(...v);return {results,success:true,meta:{changes:sql.prepare('SELECT changes() n').get().n}};}return {results:[],success:true,meta:s.run(...v)};},async run(){if(hooks.beforeIssueSave&&q.startsWith('INSERT INTO request_issues')){const hook=hooks.beforeIssueSave;delete hooks.beforeIssueSave;hook();}return this._execute();}});return st();},async batch(list){sql.exec('BEGIN');try{const out=list.map(s=>s._execute());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
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
 await replies.saveReplyRule(env,{rule:'Out of stock: offer wait, refund, credit or substitute.',issue:'out_of_stock'},owner);await replies.saveReplyRule(env,{rule:'Shipping rule',issue:'shipping'},owner);await replies.saveReplyRule(env,{rule:'Use the customer-care signature.'},owner);
 const draft=await replies.prepareRequestReply(env,{requestId:first.requestId,mode:'ai',instruction:'tell him it is not ready',expectedRevision:null},owner);assert.equal(draft.subject,data.subject);
 const job=(await replies.handleReplyBridge(env,{action:'claim'})).job;assert.equal(job.request.origin,'order');assert.match(job.caseInfo,/Item not in stock yet[\s\S]*Customer will wait, Discount on next order[\s\S]*30%/);
 assert.deepEqual(job.style.rules.sort(),['Out of stock: offer wait, refund, credit or substitute.','Use the customer-care signature.'],'General rules plus only this issue\'s rules');
 const log=await cases.caseLog(env);assert.equal(log.length,1);assert.equal(log[0].name,'Synthetic Buyer');
 // Serious cases keep an explicit reason; only an owner clears the review classification.
 const support={email:'support@example.invalid',role:'support'};
 await assert.rejects(()=>cases.saveRequestIssue(env,{requestId:first.requestId,issue:'owner_review',note:''},support),e=>e.status===400);
 await cases.saveRequestIssue(env,{requestId:first.requestId,issue:'owner_review',note:'Payment dispute needs an owner decision.'},support);
 await assert.rejects(()=>cases.saveRequestIssue(env,{requestId:first.requestId,issue:'shipping'},support),e=>e.status===403);
 assert.equal((await cases.issuesFor(env,[first.requestId]))[first.requestId].issue,'owner_review');
 await cases.saveRequestIssue(env,{requestId:first.requestId,issue:'shipping',note:'Owner reviewed.'},owner);
 // A stale support save must not clear owner review added after its initial category read.
 hooks.beforeIssueSave=()=>sql.prepare("UPDATE request_issues SET issue='owner_review',note='New concern raised concurrently.',updated=? WHERE request_id=?").run(Date.now(),first.requestId);
 await assert.rejects(()=>cases.saveRequestIssue(env,{requestId:first.requestId,issue:'product_question',note:'Stale support edit.'},support),e=>e.status===403);
 const concurrentIssue=(await cases.issuesFor(env,[first.requestId]))[first.requestId];assert.equal(concurrentIssue.issue,'owner_review');assert.equal(concurrentIssue.note,'New concern raised concurrently.','The rejected stale save preserves the owner-review reason');
 await cases.saveRequestIssue(env,{requestId:first.requestId,issue:'owner_review',note:'Support added context to the same review.'},support);
 assert.equal((await cases.issuesFor(env,[first.requestId]))[first.requestId].note,'Support added context to the same review.','Support may add context without clearing owner review');
 await cases.saveRequestIssue(env,{requestId:first.requestId,issue:'shipping',note:'Owner reviewed the new concern.'},owner);
 assert.equal((await cases.issuesFor(env,[first.requestId]))[first.requestId].issue,'shipping','Owner can clear the review after considering it');

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
 // Follow-up drafts check purchase/contact history, use a clear question and preserve existing savings.
 const unpaid='ord_'+randomUUID().slice(0,12);const product=require('../lib/catalog.ts').products[0];
 sql.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(unpaid,'synthetic-cart-owner','rk-'+unpaid,'awaiting_payment',22759,JSON.stringify({environment:'authorizenet:live',email:'cart@example.invalid',address:{name:'Bruno Synthetic'},items:[{id:product.id,quantity:2,product:{name:product.name}}]}),Date.now(),Date.now());
 await assert.rejects(()=>cases.startWinBack(env,orderId,'help',owner),e=>e.status===409,'Paid orders are not win-back targets');
 await assert.rejects(()=>cases.startWinBack(env,unpaid,'made-up',owner),e=>e.status===400);
 const wb=await cases.startWinBack(env,unpaid,'help',owner);
 const wbRow=sql.prepare('SELECT * FROM request_reply_drafts WHERE request_id=?').get(wb.requestId);assert.equal(wbRow.mode,'staff');assert.equal(wbRow.status,'queued');assert.equal(wbRow.approved_at,null,'A win-back draft is never approved to send');
 assert.match(wbRow.proposed_body,/Hi Bruno,/);assert.match(wbRow.proposed_body,/Did you get your[\s\S]*order sorted, or would you like a hand/);assert.doesNotMatch(wbRow.proposed_body,/COMEBACK|site didn.t|last reminder/);
 assert.match(wbRow.subject,new RegExp('^Bruno, your '+product.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' order is saved$'));
 assert.equal((await cases.issuesFor(env,[wb.requestId]))[wb.requestId].issue,'unfinished_checkout');
 sql.prepare("INSERT INTO checkout_recovery(order_id,status,reason,recipient_hash,unsubscribe_token,payload,original_snapshot,savings,attempts,next_attempt_at,created,updated) VALUES(?,'accepted','accepted','h',?,'{}','{}',1234,1,0,0,0)").run(unpaid,randomUUID());
 const previews=await cases.winBackPreview(env,wb.requestId);assert.deepEqual(previews.map(t=>t.id),['help','reminder']);
 assert(previews.every(t=>!t.body.includes('COMEBACK')),'No automatic second discount or fresh-cart instruction');
 assert.match(previews.find(t=>t.id==='reminder').body,/\$12\.34 saving/,'Mentions the automatic recovery saving already applied');
 assert(previews.every(t=>!/expires|only today|hurry|last chance/i.test(t.body)),'No invented urgency');
 await assert.rejects(()=>cases.startWinBack(env,unpaid,'last',owner),e=>e.status===400,'Retired final-reminder promise cannot be selected');
 const againWb=await cases.startWinBack(env,unpaid,'reminder',owner);assert.equal(againWb.requestId,wb.requestId,'Same conversation reused');assert.match(sql.prepare('SELECT proposed_body FROM request_reply_drafts WHERE request_id=?').get(wb.requestId).proposed_body,/saving already applied/);
 sql.prepare("UPDATE orders SET status='paid' WHERE id=?").run(unpaid);assert.deepEqual(await cases.winBackPreview(env,wb.requestId),[],'No stale follow-up previews after purchase');
 sql.prepare("UPDATE orders SET status='awaiting_payment' WHERE id=?").run(unpaid);
 // Replies outside the desk: Jarvis mailbox findings and manual notes; desk sends and pre-request mail are ignored; duplicates collapse.
 const ext=require('../lib/request-external.ts');
 const open=(await replies.handleReplyBridge(env,{action:'open_requests'})).requests;assert(open.some(r=>r.id===wb.requestId&&r.email==='cart@example.invalid'));
 const created=sql.prepare('SELECT created FROM requests WHERE id=?').get(wb.requestId).created;
 const found={recipient:'cart@example.invalid',subject:JSON.parse(sql.prepare('SELECT data FROM requests WHERE id=?').get(wb.requestId).data).subject,requestId:wb.requestId,account:'contact@trybiomod.com',messageId:'gmail-1',sentAt:created+1000,body:'Sent from Gmail',preview:false};
 await replies.handleReplyBridge(env,{action:'external_replies',replies:[found,found,{...found,messageId:'gmail-old',sentAt:created-3600000}]});
 sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,provider_thread_id,sender,recipient) VALUES('m1',?,'outgoing','desk',?,'gmail-desk',NULL,'contact@trybiomod.com','cart@example.invalid')").run(wb.requestId,created+5);
 await replies.handleReplyBridge(env,{action:'external_replies',replies:[{...found,messageId:'gmail-desk'}]});
 await replies.handleReplyBridge(env,{action:'external_replies',replies:[{...found,messageId:'unrelated-subject',subject:'Unrelated question'},{...found,messageId:'wrong-recipient',recipient:'other@example.invalid'},{...found,messageId:'personal-mailbox',account:'personal@example.invalid'},{...found,messageId:'missing-subject',subject:undefined}]});
 let extList=(await ext.externalRepliesFor(env,[wb.requestId]))[wb.requestId];assert.equal(extList.length,1,'One per message; old mail and desk sends ignored');assert.equal(extList[0].account,'contact@trybiomod.com');
 assert.equal(extList[0].verified,true,'Exact-subject business reply is verified for this case');
 const duplicateReply=await replies.handleReplyBridge(env,{action:'external_replies',replies:[found]});assert.equal(duplicateReply.saved,0,'Repeated checked message has no new mutation');
 const ambiguous=randomUUID();sql.prepare("INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,NULL,'contact',?,'new',?)").run(ambiguous,JSON.stringify({email:found.recipient,subject:'Re: '+found.subject,message:'Another case'}),created);
 await replies.handleReplyBridge(env,{action:'external_replies',replies:[{...found,messageId:'ambiguous-case'}]});assert.equal(sql.prepare("SELECT COUNT(*) n FROM request_external_replies WHERE message_id='ambiguous-case'").get().n,0,'Same-subject cases are not guessed');
 sql.prepare('DELETE FROM requests WHERE id=?').run(ambiguous);
 const legacyId=await require('../lib/coa-delivery.ts').coaHash('mailbox:'+found.account+':gmail-legacy:'+found.requestId);
 sql.prepare("INSERT INTO request_external_replies(id,request_id,source,account,message_id,sent_at,body,preview,recorded_by,created) VALUES(?,?,'mailbox',?,'gmail-legacy',?,'Preserved old contact',0,'Jarvis mailbox check',?)").run(legacyId,found.requestId,found.account,found.sentAt,created);
 let legacy=(await ext.externalRepliesFor(env,[found.requestId]))[found.requestId].find(e=>e.body==='Preserved old contact');assert.equal(legacy.verified,false,'Old email-only associations remain visible but are not proof of an answer');
 await replies.handleReplyBridge(env,{action:'external_replies',replies:[{...found,messageId:'gmail-legacy',subject:'Re: '+found.subject}]});
 legacy=(await ext.externalRepliesFor(env,[found.requestId]))[found.requestId].find(e=>e.body==='Preserved old contact');assert.equal(legacy.verified,true,'Exact recheck upgrades the link without rewriting saved mail');
 await assert.rejects(()=>replies.handleReplyBridge(env,{action:'external_replies',replies:[{...found,requestId:'not-a-uuid'}]}),e=>e.status===400);
 // A reply in an older order thread can answer a duplicate website inquiry
 // only with exact provider/account/recipient/order AND customer-text evidence.
 const orderInquiry=()=>{
  const requestId=randomUUID(),linkedId=randomUUID(),orderId=randomUUID(),threadId=randomUUID(),messageId=randomUUID(),email=requestId+'@example.invalid',created=Date.now()-10000;
  const message='My order is under review. Is anything needed from me? Order '+orderId.slice(0,8);
  const subject='Order '+orderId.slice(0,8),answer='Your order '+orderId.slice(0,8)+' is being checked by our team.';
  sql.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(orderId,randomUUID(),randomUUID(),'review',1200,JSON.stringify({email,environment:'authorizenet:live'}),created-1000,created-1000);
  sql.prepare("INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,NULL,'contact',?,'in_progress',?)").run(requestId,JSON.stringify({email,subject,message}),created);
  sql.prepare("INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,NULL,'contact',?,'in_progress',?)").run(linkedId,JSON.stringify({email,subject:'Your fixture order is saved',origin:'order',orderId,message:'Internal order context'}),created-1000);
  const incomingId=randomUUID(),incoming={body:message,created:created+1000,sender:email,recipient:'research@biomodpeptides.com'};
  sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,provider_thread_id,sender,recipient) VALUES(?,?,'outgoing',?,?,?,?,?,?)").run(randomUUID(),linkedId,answer,created+2000,messageId,threadId,'research@biomodpeptides.com',email);
  return {requestId,linkedId,orderId,incomingId,incoming,insertIncoming(){sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,provider_thread_id,sender,recipient) VALUES(?,?,'incoming',?,?,?,?,?,?)").run(incomingId,linkedId,incoming.body,incoming.created,randomUUID(),threadId,incoming.sender,incoming.recipient);},threadId,created,message,email,receipt:{requestId,recipient:email,subject:'Re: Your fixture order is saved',account:'research@biomodpeptides.com',messageId,providerThreadId:threadId,sentAt:created+2000,body:answer,preview:false}};
 };
 const matched=orderInquiry();matched.insertIncoming();assert.equal((await ext.recordMailboxReplies(env,[matched.receipt])).saved,1,'Exact inquiry in a verified linked order thread answers a changed-subject copy');
 assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(matched.requestId).status,'resolved');assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(matched.linkedId).status,'in_progress','Association never changes the source thread case');
 assert.equal((await ext.externalRepliesFor(env,[matched.requestId]))[matched.requestId][0].verified,true);
 assert.equal((await ext.recordMailboxReplies(env,[matched.receipt])).saved,0,'Linked-thread receipt is idempotent');
 const typography=orderInquiry();typography.incoming.body='  '+typography.message.toUpperCase().replaceAll(' ', '\n')+'  ';typography.insertIncoming();assert.equal((await ext.recordMailboxReplies(env,[typography.receipt])).saved,1,'Whitespace and case differences are not different inquiries');
 for(const [label,change] of [
  ['missing provider thread',x=>delete x.receipt.providerThreadId],
  ['different provider thread',x=>x.receipt.providerThreadId=randomUUID()],
  ['preview only',x=>x.receipt.preview=true],
  ['different mailbox',x=>x.receipt.account='contact@trybiomod.com'],
  ['different reply body',x=>x.receipt.body='Different saved content'],
  ['unverified provider message',x=>x.receipt.messageId=randomUUID()],
  ['different question about same order',x=>x.incoming.body='Please refund order '+x.orderId.slice(0,8)],
  ['old inquiry only quoted',x=>x.incoming.body='A different question.\nOn Monday someone wrote:\n'+x.message],
  ['customer asked again after answer',x=>x.incoming.created=x.receipt.sentAt+1],
  ['inquiry predates the submitted question',x=>x.incoming.created=x.created-120000],
  ['wrong incoming sender',x=>x.incoming.sender='other@example.invalid'],
  ['wrong incoming mailbox',x=>x.incoming.recipient='contact@trybiomod.com'],
  ['order belongs to another customer',x=>sql.prepare("UPDATE orders SET data=json_set(data,'$.email','other@example.invalid') WHERE id=?").run(x.orderId)],
  ['thread belongs to another order',x=>sql.prepare("UPDATE requests SET data=json_set(data,'$.orderId',?) WHERE id=?").run(randomUUID(),x.linkedId)],
  ['ambiguous duplicate support inquiry',x=>sql.prepare("INSERT INTO requests(id,owner,kind,data,status,created) SELECT ?,NULL,'contact',data,'new',created FROM requests WHERE id=?").run(randomUUID(),x.requestId)],
  ['ambiguous short order number',x=>sql.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) SELECT ?,?,?,status,total,data,created,updated FROM orders WHERE id=?').run(x.orderId.slice(0,8)+randomUUID().slice(8),randomUUID(),randomUUID(),x.orderId)],
 ]){const candidate=orderInquiry();change(candidate);candidate.insertIncoming();assert.equal((await ext.recordMailboxReplies(env,[candidate.receipt])).saved,0,label+' does not prove an answer');assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(candidate.requestId).status,'in_progress',label+' preserves case state');}
 await assert.rejects(()=>ext.markReplied(env,{requestId:wb.requestId},{email:'f@example.invalid',role:'fulfillment'}),e=>e.status===403);
 await ext.markReplied(env,{requestId:wb.requestId,note:'Called him'},owner);extList=(await ext.externalRepliesFor(env,[wb.requestId]))[wb.requestId];assert.equal(extList.find(e=>e.source==='manual').body,'Called him');
 // A verified outside answer retires only this case's pending approval, atomically with the receipt.
 const externalCase=async(status='ready')=>{
  const requestId=randomUUID(),created=Date.now()-10000,email=requestId+'@example.invalid',subject='Outside answer '+requestId;
  sql.prepare("INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,NULL,'contact',?,'in_progress',?)").run(requestId,JSON.stringify({email,subject,message:'Synthetic request'}),created);
  const draft=await replies.prepareRequestReply(env,{requestId,mode:'staff',body:'Preserved draft',expectedRevision:null},owner);
  sql.prepare('UPDATE request_reply_drafts SET status=?,body=?,approved_at=?,approved_by=?,ready_id=?,lease_token=?,lease_until=?,send_locked_at=? WHERE id=?').run(status,'Preserved draft',created+1,owner.email,randomUUID(),randomUUID(),Date.now()+60000,status==='sending'?created+2:null,draft.id);
  return {requestId,id:draft.id,read:()=>sql.prepare('SELECT * FROM request_reply_drafts WHERE id=?').get(draft.id),receipt:{requestId,recipient:email,subject,account:'contact@trybiomod.com',messageId:randomUUID(),sentAt:created+1000,body:'Actual outside answer',preview:false}};
 };
 for(const status of ['queued','preparing','ready','needs_review','sent','sending','cancelled']){
  const c=await externalCase(status),before=c.read();
  const receipt=await ext.recordMailboxReplies(env,[c.receipt]);assert.equal(receipt.saved,1);
  const after=c.read();
  if(['sent','sending','cancelled'].includes(status))assert.deepEqual(after,before,'External contact preserves '+status+' history and uncertain outcomes');
  else {assert.equal(after.status,'needs_review');assert.equal(after.revision,before.revision+1);assert.equal(after.body,before.body);assert.equal(after.proposed_body,before.proposed_body);assert.equal(after.reason,'answered_elsewhere');for(const k of ['ready_id','approved_at','approved_by','lease_token','lease_until'])assert.equal(after[k],null,k+' is invalidated');}
  assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(c.requestId).status,'resolved');
 }
 const uncertain=await externalCase('needs_review');sql.prepare("UPDATE request_reply_drafts SET reason='local_sent_without_provider_receipt' WHERE id=?").run(uncertain.id);const uncertainBefore=uncertain.read();await ext.recordMailboxReplies(env,[uncertain.receipt]);assert.deepEqual(uncertain.read(),uncertainBefore,'Outside answers preserve unresolved local-send evidence');
 const own=await externalCase(),other=await externalCase();
 // Same email cannot collapse unrelated questions or their send approvals.
 sql.prepare("UPDATE requests SET data=json_set(data,'$.email',?) WHERE id=?").run(own.receipt.recipient,other.requestId);
 const unrelatedBefore=other.read();await ext.markReplied(env,{requestId:own.requestId,note:'Answered by phone'},owner);
 assert.equal(own.read().reason,'answered_elsewhere');assert.deepEqual(other.read(),unrelatedBefore);assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(other.requestId).status,'in_progress');
 const replay=await externalCase();await ext.recordMailboxReplies(env,[replay.receipt]);
 await replies.prepareRequestReply(env,{requestId:replay.requestId,mode:'staff',body:'Intentional newer reply',expectedRevision:replay.read().revision,send:true},owner);
 const newBefore=replay.read();assert.equal((await ext.recordMailboxReplies(env,[replay.receipt])).saved,0);assert.deepEqual(replay.read(),newBefore,'Duplicate mailbox import never retires a newly prepared reply');assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(replay.requestId).status,'in_progress');
 await assert.rejects(()=>ext.recordMailboxReplies(env,[{...replay.receipt,sentAt:replay.receipt.sentAt+1}]),e=>e.status===409,'A receipt cannot change its timestamp to supersede newer messages');assert.deepEqual(replay.read(),newBefore);
 for(const offset of [0,1]){
  const delayed=await externalCase();sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,sender,recipient,provider_message_id) VALUES(?,?,'incoming','New question',?,?,?,?)").run(randomUUID(),delayed.requestId,delayed.receipt.sentAt+offset,delayed.receipt.recipient,'contact@trybiomod.com',randomUUID());
  const before=delayed.read();await ext.recordMailboxReplies(env,[delayed.receipt]);assert.deepEqual(delayed.read(),before,'Older or equal-time external mail does not answer the latest question');assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(delayed.requestId).status,'in_progress');
 }
 const upgraded=await externalCase();const upgradeId=await require('../lib/coa-delivery.ts').coaHash('mailbox:'+upgraded.receipt.account+':'+upgraded.receipt.messageId+':'+upgraded.requestId);
 sql.prepare("INSERT INTO request_external_replies(id,request_id,source,account,message_id,sent_at,body,preview,recorded_by,created) VALUES(?,?,'mailbox',?,?,?,'Preserve legacy evidence',1,'Jarvis mailbox check',?)").run(upgradeId,upgraded.requestId,upgraded.receipt.account,upgraded.receipt.messageId,upgraded.receipt.sentAt,upgraded.receipt.sentAt);
 assert.equal((await ext.recordMailboxReplies(env,[upgraded.receipt])).saved,1);assert.equal(upgraded.read().reason,'answered_elsewhere');assert.equal(sql.prepare('SELECT body FROM request_external_replies WHERE id=?').get(upgradeId).body,'Preserve legacy evidence');
 const rollback=await externalCase(),beforeRollback=rollback.read();sql.exec("CREATE TRIGGER fixture_reject_outside BEFORE INSERT ON request_external_replies BEGIN SELECT RAISE(ABORT,'Fixture receipt failure'); END");
 await assert.rejects(()=>ext.recordMailboxReplies(env,[rollback.receipt]),/Fixture receipt failure/);assert.deepEqual(rollback.read(),beforeRollback);assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(rollback.requestId).status,'in_progress','Failed recording rolls back both draft and case changes');sql.exec('DROP TRIGGER fixture_reject_outside');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM change_context').get().n,0);
 console.log('PASS: one conversation per order with staff-only order context, order subject kept, issue + resolutions validated, issue-scoped rules and the decided case reach the AI, case log for rules. Isolated SQLite, no email.');
})().catch(e=>{console.error(e);process.exitCode=1;});
