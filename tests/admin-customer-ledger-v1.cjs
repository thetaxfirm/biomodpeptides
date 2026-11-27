// Complete reward balances, immutable adjustments, customer history and preference reads over isolated SQLite.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');const root=path.resolve(__dirname,'..'),cache={};
function load(file){if(cache[file])return cache[file].exports;const m=new Module(path.join(root,file),module);cache[file]=m;m.filename=path.join(root,file);m.require=id=>id.startsWith('./')?load(path.join(path.dirname(file),id+'.ts')):require(id);m._compile(ts.transpileModule(fs.readFileSync(m.filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,m.filename);return m.exports;}
const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',f),'utf8'));
const stmt=(q,args=[])=>({bind:(...a)=>stmt(q,a),first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)}),run:async()=>({meta:sql.prepare(q).run(...args)})});const db={prepare:stmt,batch:async ss=>{sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
(async()=>{
 const rewards=load('lib/admin-rewards.ts'),customers=load('lib/admin-customers.ts');
 sql.prepare("INSERT INTO profiles(id,name,phone,company,created) VALUES('member','Fixture Customer','7025550101','Fixture Lab',1)").run();
 sql.prepare("INSERT INTO crm_contacts(email,owner,name,phone,sources,first_seen,last_seen) VALUES('fixture@example.invalid','member','Fixture Customer','7025550101','[\"account\"]',1,2)").run();
 for(let n=0;n<151;n++)sql.prepare('INSERT INTO rewards(id,owner,points,reason,created) VALUES(?,?,?,?,?)').run('reward-'+String(n).padStart(4,'0'),'member',1,'Fixture earning',n+1);
 let ledger=await rewards.rewardLedger(db,'member');assert.equal(ledger.balance,151);assert.equal(ledger.entries.length,50);assert.equal(ledger.total,151);
 const next=await rewards.rewardLedger(db,'member',ledger.nextCursor);assert.equal(next.entries.length,50);assert(!ledger.entries.some(e=>next.entries.some(n=>n.id===e.id)));
 const actor={email:'owner@example.invalid'},input={owner:'member',points:-11,reason:'Correct fixture award',requestKey:crypto.randomUUID(),expectedBalance:151};
 const saved=await rewards.addRewardAdjustment(db,actor,input,1000);assert.equal(saved.ledger.balance,140);assert.equal(saved.ledger.entries[0].actor,actor.email);
 assert.equal((await rewards.addRewardAdjustment(db,actor,input,1001)).ledger.balance,140,'retry does not double award');
 await assert.rejects(rewards.addRewardAdjustment(db,actor,{...input,requestKey:crypto.randomUUID()},1002),/balance changed/);
 assert.throws(()=>sql.prepare("UPDATE rewards SET points=999 WHERE id='reward-0000'").run(),/immutable/);
 assert.throws(()=>sql.prepare("DELETE FROM rewards WHERE id='reward-0000'").run(),/immutable/);
 assert.equal((await rewards.rewardCustomers(db,'fixture@example.invalid'))[0].balance,140);
 for(let n=0;n<27;n++)sql.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,created,updated) VALUES(?,?,?,?,?,?,?,?)').run('order-'+n,'member','order-'+n,'paid',JSON.stringify({email:n===0?'prior@example.invalid':'fixture@example.invalid',environment:'authorizenet:live',items:[{product:{name:'Fixture product'},quantity:1}]}),1000,n+1,n+1);
 sql.prepare('INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),'member','contact',JSON.stringify({email:'fixture@example.invalid',subject:'Fixture question',message:'Testing only'}),'new',3);
 sql.prepare('INSERT INTO email_signups(email,source_path,consent_version,consent_text,unsubscribe_token,created,updated,unsubscribed_at) VALUES(?,?,?,?,?,?,?,?)').run('fixture@example.invalid','/','test','Fixture consent',crypto.randomUUID(),2,3,3);
 sql.prepare("UPDATE orders SET data=json_set(data,'$.environment','live','$.items',json('[null]')),payment_ref='fixture-paid',notification_id='fixture-notification' WHERE id='order-26'").run();
 sql.prepare("INSERT INTO requests(id,kind,data,status,created) VALUES(?,'text_offer',?,'new',2)").run(crypto.randomUUID(),JSON.stringify({phone:'+17025550101'}));
 sql.prepare("INSERT INTO requests(id,kind,data,status,created) VALUES(?,'text_offer',?,'new',2)").run(crypto.randomUUID(),JSON.stringify({phone:'+12025550199'}));
 const view=await customers.customerWorkspace(db,{email:'fixture@example.invalid'});assert.equal(view.orders.total,27,'account-linked prior email orders included');assert.equal(view.orders.items.length,25);assert.equal(view.orders.recordedPaidCents,1000,'legacy live alias with receipt is included');assert.equal(view.preferences.textMarketing.length,1,'only canonical matching customer phone is returned');assert.equal(view.orders.items[0].items,'Item × 1','legacy null item cannot break the customer workspace');assert.equal(view.rewards[0].balance,140);assert.equal(view.preferences.emailMarketing.state,'unsubscribed');assert.equal(view.conversations.total,1);
 const older=await customers.customerWorkspace(db,{email:'fixture@example.invalid',ordersBefore:view.orders.nextCursor});assert.equal(older.orders.items.length,2);
 assert(view.activity.every(a=>!('body' in a)),'activity does not duplicate message bodies');
 const route=fs.readFileSync(path.join(root,'app/api/admin/customers/route.ts'),'utf8');assert.match(route,/requireStaff\('reports:read'\)/);assert.match(route,/get\('origin'\)!==req.nextUrl.origin/);
 console.log('PASS: complete reward balances, paged immutable entries, idempotent adjustments/conflicts, customer lookup, account-linked history, preferences and protected workspace.');
})().catch(e=>{console.error(e);process.exitCode=1});
