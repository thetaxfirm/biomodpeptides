// Actual contact/sync modules, isolated SQLite and synthetic records only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
function load(file) { const m = { exports: {} }; new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(m,m.exports,()=>{throw Error('Unexpected dependency');}); return m.exports; }
function wrap(sql) { const stmt=(query,args=[])=>({query,args,bind:(...a)=>stmt(query,a),all:async()=>({results:sql.prepare(query).all(...args)}),first:async()=>sql.prepare(query).get(...args)||null,run:async()=>({meta:sql.prepare(query).run(...args)})}); return {prepare:stmt,batch:async list=>{sql.exec('BEGIN');try {const result=[];for(const s of list)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}}; }
(async()=>{
 const contact=load('lib/contacts.ts'), shared=load('lib/shared-crm.ts');
 const sql=new DatabaseSync(':memory:');for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
 const db=wrap(sql), crm=wrap(new DatabaseSync(':memory:'));
 await contact.recordContact(db,{email:'fixture@example.invalid',source:'account'},1);
 const insert=sql.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,created,updated) VALUES(?,?,?,?,?,?,?,?)');
 sql.exec('BEGIN');for(let i=0;i<5001;i++)insert.run('order-'+i,'member','key-'+i,'paid',JSON.stringify({email:'fixture@example.invalid'}),100,i+1,i+1);sql.exec('COMMIT');
 const complete=await contact.contactList(db);assert.equal(complete[0].orders,5001);assert.equal(complete[0].paidCents,500100,'history is not capped at 5000');
 await shared.publishOnSchedule({DB:db,CRM:crm},'trybiomod',contact.contactList,10_000_000);
 assert.equal((await shared.crmSyncHealth(db,true,10_000_001)).status,'ok');
 const broken={...db,prepare:q=>q.includes('FROM orders')?{all:async()=>{throw Error('Synthetic source failure');}}:db.prepare(q)};
 await assert.rejects(contact.contactList(broken),/Synthetic source failure/);
 await shared.publishOnSchedule({DB:broken,CRM:crm},'trybiomod',contact.contactList,14_000_000);
 assert.equal((await crm.prepare('SELECT paid_cents FROM crm_store_activity').first()).paid_cents,500100,'incomplete source never overwrites last complete totals');
 const health=await shared.crmSyncHealth(db,true,14_000_001);assert.equal(health.status,'failed');assert.equal(health.lastSuccessAt,10_000_000);
 const capture=fs.readFileSync(path.join(root,'lib/crm-capture.ts'),'utf8');assert.doesNotMatch(capture,/await publishContacts/,'Contacts GET does not publish snapshots');
 const route=fs.readFileSync(path.join(root,'app/api/store/[action]/route.ts'),'utf8');assert.match(route,/checkoutRecovery: allowed\('orders:read'\) \? await recoveryAdminStatus\(runtime\(\)\) : null/);
 assert.match(fs.readFileSync(path.join(root,'db/schema.ts'),'utf8'),/staff_role.*'catalog'/,'declared schema includes Catalog');
 console.log('PASS: complete full-history contact snapshots, failed reads preserve shared totals, visible failed sync health, read-only Contacts and Catalog response gate.');
})().catch(e=>{console.error(e);process.exitCode=1});
