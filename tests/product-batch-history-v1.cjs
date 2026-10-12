// Real migrations + real D1 audit helper over isolated SQLite; no customer data or providers.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,f);
const {auditRun}=require('../lib/change-history.ts');
const sql=new DatabaseSync(':memory:');
const stmt=(query,values=[])=>({bind:(...v)=>stmt(query,v),run:async()=>({results:[],meta:sql.prepare(query).run(...values)})});
const db={prepare:query=>stmt(query),async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
const actor={source:'admin',actor:'batch-owner@example.invalid',actorType:'staff',action:'product.update'};
const id=991234,old={price:6999,inStock:false,purchasable:false,stockQuantity:200,maxQuantity:200,batch:{lot:'CURRENT-1',reportRef:'public:fixture-report_1',coaAvailable:true},publicationRelease:{lot:'CURRENT-1',reason:'PRIVATE_REVIEW_REASON never copied'}};
const save=data=>sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(data));
const events=()=>sql.prepare("SELECT * FROM change_events WHERE entity_type='product' AND entity_id=? ORDER BY rowid").all(String(id));
const last=()=>{const e=events().at(-1);return {...e,changes:JSON.parse(e.changes)};};
const raw=()=>sql.prepare('SELECT data FROM product_overrides WHERE id=?').get(id).data;
(async()=>{try{
 for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')&&n<'0023').sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 save(old);const originalRows=JSON.stringify(sql.prepare('SELECT * FROM product_overrides ORDER BY id').all()),originalHistory=JSON.stringify(sql.prepare('SELECT * FROM change_events ORDER BY rowid').all());
 const migration=fs.readFileSync(path.join(root,'drizzle/0023_product_batch_history.sql'),'utf8');sql.exec(migration);
 assert.equal(JSON.stringify(sql.prepare('SELECT * FROM product_overrides ORDER BY id').all()),originalRows,'Migration never rewrites product, quantity or batch data');
 assert.equal(JSON.stringify(sql.prepare('SELECT * FROM change_events ORDER BY rowid').all()),originalHistory,'Migration never rewrites existing history');
 const updated={...old,batch:{lot:'CURRENT-2',reportRef:'private:'+'a'.repeat(64),coaAvailable:false},publicationRelease:{lot:'CURRENT-2',reason:'PRIVATE_REPLACEMENT_REASON not logged'},availability:'available'};
 await auditRun(db,actor,'UPDATE product_overrides SET data=? WHERE id=?',JSON.stringify(updated),id);
 let e=last();assert.equal(e.actor,actor.actor);assert.equal(e.source,'admin');assert.equal(e.actor_type,'staff');assert.equal(e.action,'product.update');
 assert.deepEqual(e.changes,[{field:'Current lot',before:'CURRENT-1',after:'CURRENT-2'},{field:'COA reference',before:'public:fixture-report_1',after:'private:'+'a'.repeat(64)},{field:'COA available',before:1,after:0},{field:'Release lot',before:'CURRENT-1',after:'CURRENT-2'},{field:'Availability',before:null,after:'available'}]);
 assert.equal(JSON.parse(raw()).maxQuantity,200);assert.equal(sql.prepare('SELECT COUNT(*) n FROM change_context').get().n,0);
 const count=events().length;await auditRun(db,actor,'UPDATE product_overrides SET data=data WHERE id=?',id);assert.equal(events().length,count,'No-op produces no artificial history');
 save({...updated,publicationRelease:{...updated.publicationRelease,reason:'PRIVATE_DIFFERENT_NOTE still not copied'}});assert.deepEqual(last().changes,[{field:'Other stored fields',before:'Not copied',after:'Changed; private values are not recorded'}]);assert.equal(last().actor,'Unattributed database change');
 save({...updated,publicationRelease:null});assert(last().changes.some(c=>c.field==='Release lot'&&c.after===null));assert(last().changes.some(c=>c.field==='Release review note'&&c.before==='Recorded'&&c.after===null));
 save({...updated,batch:{lot:'LOT.3/24-a',reportRef:'public:Fixture-3_file.2',coaAvailable:true}});assert(last().changes.some(c=>c.field==='Release review note'&&c.after==='Recorded'));
 for(const invalid of [{lot:{secret:'PRIVATE_LOT'},reportRef:{secret:'PRIVATE_REF'},coaAvailable:'PRIVATE_BOOLEAN'},{lot:'PRIVATE@LOT',reportRef:'https://private.invalid/PRIVATE_REF',coaAvailable:1},{lot:'L'.repeat(101),reportRef:'public:PRIVATE/REF',coaAvailable:null}]){
  save({...updated,batch:invalid,publicationRelease:{lot:invalid.lot,reason:{secret:'PRIVATE_REASON'}}});const event=last();assert(event.changes.every(c=>!JSON.stringify(c).includes('PRIVATE_')));assert(event.changes.filter(c=>['Current lot','COA reference','COA available','Release lot','Release review note'].includes(c.field)).every(c=>c.after===null));
 }
 save({...updated,batch:null,publicationRelease:null});
 const beforeRollback=raw(),beforeEvents=events().length;
 await assert.rejects(()=>db.batch([db.prepare('INSERT INTO change_context(id,actor,actor_type,source) VALUES(1,?,?,?)').bind(actor.actor,'staff','admin'),db.prepare('UPDATE product_overrides SET data=? WHERE id=?').bind(JSON.stringify(updated),id),db.prepare('INSERT INTO transaction_guards(id,valid) VALUES(?,0)').bind('batch-rollback-fixture')]));
 assert.equal(raw(),beforeRollback);assert.equal(events().length,beforeEvents);assert.equal(sql.prepare('SELECT COUNT(*) n FROM change_context').get().n,0,'Failure rolls back mutation, log and actor context');
 save(updated);sql.prepare('DELETE FROM product_overrides WHERE id=?').run(id);assert.equal(last().action,'product.delete');assert(last().changes.some(c=>c.field==='Current lot'&&c.before==='CURRENT-2'&&c.after===null));
 save(updated);assert.equal(last().action,'product.insert');assert(last().changes.some(c=>c.field==='Release review note'&&c.before===null&&c.after==='Recorded'));
 const beforeReplay=JSON.stringify(events());sql.exec(migration);assert.equal(JSON.stringify(events()),beforeReplay);
 const history=JSON.stringify(events());for(const privateValue of ['PRIVATE_REVIEW_REASON','PRIVATE_REPLACEMENT_REASON','PRIVATE_DIFFERENT_NOTE','PRIVATE_LOT','PRIVATE_REF','PRIVATE_REASON','PRIVATE_BOOLEAN'])assert(!history.includes(privateValue));
 assert.throws(()=>sql.exec('DELETE FROM change_events'),/immutable|append|delete/i);assert.throws(()=>sql.exec("UPDATE change_events SET summary='replaced'"),/immutable|append|update/i);
 console.log('PASS: batch/release migration preserves data and history; exact safe lot/report/COA/status changes; attributed atomic audit and rollback; unlogged reason text; unknown direct actor; no-op and malformed/private exclusion; append-only events. Isolated SQLite only.');
}finally{sql.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
