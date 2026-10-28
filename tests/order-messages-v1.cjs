// Orders tab "Messaged" history on real SQLite with every migration applied.
// Synthetic example.invalid records only. No network, no email, no customer data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('Live I/O forbidden');};
const {orderMessageLogs,orderMessageLabel}=require('../lib/order-messages.ts');
(async()=>{
 const sql=new DatabaseSync(':memory:');for(const n of fs.readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',n),'utf8'));
 const db={prepare(q){const st=(v=[])=>({bind:(...n)=>st(n),first:async()=>sql.prepare(q).get(...v)||null,all:async()=>({results:sql.prepare(q).all(...v)}),async run(){return {meta:sql.prepare(q).run(...v)};}});return st();}};
 const env={DB:db};
 const T=Date.UTC(2026,9,10,12);const H=3600e3;
 const order=(status,email,created)=>{const id='ord_'+randomUUID().slice(0,12);sql.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(id,'synthetic-owner-'+id,'rk-'+id,status,10000,JSON.stringify({email,address:{name:'Synthetic Buyer'}}),created,created);return {id,created,data:{email}};};
 const request=(data)=>{const id=randomUUID();sql.prepare("INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,NULL,'contact',?,'new',?)").run(id,JSON.stringify(data),T);return id;};
 const sent=(requestId,recipient,created,sender='staff@example.invalid')=>sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,sender,recipient) VALUES(?,?,'outgoing','(body not read)',?,?,?,?)").run(randomUUID(),requestId,created,'pm-'+randomUUID(),sender,recipient);

 const a=order('awaiting_payment','A.Buyer@Example.invalid',T);   // mixed case on purpose
 const b=order('shipped','b@example.invalid',T);
 const c=order('awaiting_payment','c@example.invalid',T);

 // A: automatic reminder, a desk reply in the order conversation, a logged phone call,
 // a reply in an unrelated conversation AFTER the order, and one BEFORE it (excluded).
 sql.prepare("INSERT INTO checkout_recovery(order_id,status,reason,recipient_hash,unsubscribe_token,payload,original_snapshot,savings,next_attempt_at,accepted_at,created,updated) VALUES(?,'accepted','reminder','h',?, '{}','{}',750,?,?,?,?)").run(a.id,'u-'+randomUUID(),T,T+1*H,T,T);
 const linked=request({email:'a.buyer@example.invalid',origin:'order',orderId:a.id});
 sent(linked,'a.buyer@example.invalid',T+2*H);
 sql.prepare("INSERT INTO request_external_replies(id,request_id,source,account,message_id,sent_at,body,recorded_by,created) VALUES(?,?,'manual','phone',NULL,?,'(not read)','owner@example.invalid',?)").run(randomUUID(),linked,T+3*H,T+3*H);
 const other=request({email:'a.buyer@example.invalid'});
 sent(other,'A.BUYER@example.invalid',T+4*H);
 sent(other,'a.buyer@example.invalid',T-5*H);
 // B: tracking accepted, then a resend whose acceptance was not confirmed, and a lab report email.
 for(const [status,at] of [['succeeded',T+5*H],['observed',T+6*H],['attempted',T+6*H]])
  sql.prepare("INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes) VALUES(?,?,?,'system','Automatic label purchase','system','shipping.tracking_email','order',?,'s',?,'[]')").run(randomUUID(),at,at,b.id,status);
 const coaReq=request({email:'b@example.invalid'});
 sql.prepare("INSERT INTO coa_delivery_outbox(id,request_id,purpose,status,reason,recipient,template_version,idempotency_key,next_attempt_at,accepted_at,created,updated) VALUES(?,?,'coa','accepted','sent','b@example.invalid','v1',?,?,?,?,?)").run(randomUUID(),coaReq,'k-'+randomUUID(),T,T+7*H,T,T);

 const logs=await orderMessageLogs(env,[a,b,c]);
 assert.deepEqual(logs[a.id].items.map(m=>m.kind),['reply','manual','reply','auto_reminder'],'A: newest first; the pre-order message is excluded and the linked reply is counted once');
 assert.equal(logs[a.id].count,4);assert.equal(logs[a.id].last.at,T+4*H);
 assert.equal(logs[a.id].items[1].by,'owner@example.invalid','Logged calls name who recorded them');
 assert.deepEqual(logs[b.id].items.map(m=>m.kind),['coa','tracking_unconfirmed','tracking'],'B: an unconfirmed resend is labelled as such; attempted rows are not sends');
 assert.deepEqual(logs[c.id],{count:0,last:null,items:[]},'C: nothing sent');
 assert.equal(orderMessageLabel.tracking_unconfirmed,'Tracking email (not confirmed)');
 assert(!JSON.stringify(logs).includes('(body not read)'),'Message bodies are never returned');
 // A missing table (older database) degrades to empty instead of breaking the Orders tab.
 const broken={DB:{prepare(){return {bind(){return this;},async all(){throw Error('no such table');}};}}};
 assert.deepEqual((await orderMessageLogs(broken,[c]))[c.id],{count:0,last:null,items:[]});

 // Wiring: the orders route attaches the log; the table and detail view render it; automatic labels record their tracking email.
 const route=fs.readFileSync(path.join(root,'app/api/store/[action]/route.ts'),'utf8');
 assert.match(route,/orderMessageLogs\(runtime\(\)/);
 const ui=fs.readFileSync(path.join(root,'components/store/orders-admin.tsx'),'utf8');
 assert.match(ui,/<th>Last contact recorded<\/th>/);assert.match(ui,/Contact history recorded/);assert.match(ui,/not confirmed inbox delivery/);assert.match(ui,/No contact recorded/);
 const auto=fs.readFileSync(path.join(root,'lib/auto-label.ts'),'utf8');
 assert.match(auto,/action: 'shipping\.tracking_email'/);
 console.log('order-messages-v1: ok');
})().catch(e=>{console.error(e);process.exit(1);});
