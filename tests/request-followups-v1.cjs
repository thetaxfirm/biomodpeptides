// Isolated SQL state transitions only; no production data, network or mail.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,f);
const {followupStateStatements}=require('../lib/request-followups.ts');
function fixture(state='ready',status='resolved'){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE requests(id TEXT,status TEXT);CREATE TABLE request_reply_messages(id TEXT,request_id TEXT,direction TEXT,created INTEGER);CREATE TABLE request_external_replies(request_id TEXT,source TEXT,sent_at INTEGER,recorded_by TEXT);CREATE TABLE request_reply_drafts(request_id TEXT,status TEXT,approved_at INTEGER,approved_by TEXT,lease_token TEXT,lease_until INTEGER,reason TEXT,updated INTEGER,send_locked_at INTEGER,body TEXT,revision INTEGER,ready_id TEXT);');
 sql.prepare('INSERT INTO requests VALUES(?,?)').run('case',status);sql.prepare('INSERT INTO requests VALUES(?,?)').run('other','resolved');
 sql.prepare('INSERT INTO request_reply_drafts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('case',state,900,'staff','lease',999,null,900,state==='sending'?901:null,'Preserved draft',3,'ready-id');
 sql.prepare('INSERT INTO request_reply_messages VALUES(?,?,?,?)').run('sent','case','outgoing',1000);
 const db={prepare(q){return {bind(...values){return {run:()=>sql.prepare(q).run(...values)}}}}};
 const incoming=(id,at,request='case',direction='incoming')=>sql.prepare('INSERT INTO request_reply_messages VALUES(?,?,?,?)').run(id,request,direction,at);
 const apply=(ids)=>{sql.exec('BEGIN');try{for(const s of followupStateStatements(db,'case',ids,3000))s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}};
 return {sql,incoming,apply,row:()=>sql.prepare('SELECT * FROM request_reply_drafts').get(),status:()=>sql.prepare("SELECT status FROM requests WHERE id='case'").get().status};
}
for(const state of ['queued','preparing','ready','needs_review']){const f=fixture(state);f.incoming('new',2000);f.apply(['new']);assert.equal(f.status(),'in_progress');assert.equal(f.row().status,'needs_review');assert.equal(f.row().approved_at,null);assert.equal(f.row().approved_by,null);assert.equal(f.row().lease_token,null);assert.equal(f.row().lease_until,null);assert.equal(f.row().reason,'customer_replied');assert.equal(f.row().body,'Preserved draft');assert.equal(f.row().revision,4);assert.equal(f.row().ready_id,null);assert.equal(f.sql.prepare("SELECT status FROM requests WHERE id='other'").get().status,'resolved');f.sql.close();}
{const f=fixture();f.incoming('tied',1000);f.apply(['tied']);assert.equal(f.status(),'in_progress','Equal timestamps conservatively require review');assert.equal(f.row().status,'needs_review');f.sql.close();}
for(const state of ['sent','sending','cancelled']){const f=fixture(state);f.incoming('new',2000);f.apply(['new']);assert.equal(f.status(),'in_progress');assert.equal(f.row().status,state);assert.equal(f.row().reason,null);f.sql.close();}
for(const status of ['spam','deleted']){const f=fixture('ready',status);f.incoming('new',2000);f.apply(['new']);assert.equal(f.status(),status);f.sql.close();}
for(const at of [900]){const f=fixture();f.incoming('old',at);f.apply(['old']);assert.equal(f.status(),'resolved');assert.equal(f.row().status,'ready');f.sql.close();}
{const f=fixture();f.incoming('new',2000);f.apply(['new']);f.sql.prepare("UPDATE request_reply_drafts SET status='ready',approved_at=4000,reason=NULL").run();f.apply([]);assert.equal(f.row().status,'ready');assert.equal(f.row().approved_at,4000,'Duplicate import never revokes new approval');assert.equal(f.row().revision,4,'Duplicate import never increments the revision');f.sql.close();}
{const f=fixture();f.incoming('other-message',2000,'other');f.incoming('outgoing',2000,'case','outgoing');f.apply(['other-message','outgoing']);assert.equal(f.status(),'resolved');assert.equal(f.row().status,'ready');f.sql.close();}
// Delayed incoming that a staff member already answered stays closed; unverified and other-case mail is not proof.
for(const [source,recordedBy,requestId,answered] of [['manual','staff','case',true],['mailbox','Jarvis exact conversation check','case',true],['mailbox','Jarvis mailbox check','case',false],['manual','staff','other',false]]){const f=fixture();f.sql.prepare('INSERT INTO request_external_replies VALUES(?,?,?,?)').run(requestId,source,2500,recordedBy);f.incoming('delayed',2000);f.apply(['delayed']);assert.equal(f.status(),answered?'resolved':'in_progress');assert.equal(f.row().status,answered?'ready':'needs_review');assert.equal(f.row().revision,answered?3:4);f.sql.close();}
console.log('request-followups-v1: PASS');
