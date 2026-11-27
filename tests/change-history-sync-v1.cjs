// Public metadata only; isolated SQLite and mocked network.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {syncRuntimeHistory}=require('../lib/change-history-sync.ts');
const {changeHistory}=require('../lib/change-history.ts');
const db=new DatabaseSync(':memory:');
db.exec(fs.readFileSync('drizzle/0020_change_history.sql','utf8').split('CREATE TRIGGER IF NOT EXISTS audit_product_overrides_insert')[0]);
const DB={prepare(sql){const statement=(values=[])=>({bind:(...args)=>statement(args),all:async()=>({results:db.prepare(sql).all(...values)}),first:async()=>db.prepare(sql).get(...values)||null,run:async()=>({meta:{changes:Number(db.prepare(sql).run(...values).changes)}})});return statement();}};
(async()=>{
  const now=Date.parse('2026-11-27T00:00:00Z'),sha='a'.repeat(40),env={DB,CF_VERSION_METADATA:{id:'11111111-1111-4111-8111-111111111111'}};
  let calls=0;
  const request=async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert(!options.headers.Authorization);assert(url.startsWith('https://api.github.com/repos/thetaxfirm/biomodpeptides/commits?'));return Response.json([{sha,commit:{committer:{date:new Date(now-1000).toISOString()},message:'PRIVATE_NOT_COPIED',author:{email:'PRIVATE_NOT_COPIED'}}}]);};
  await syncRuntimeHistory(env,now,request);
  await syncRuntimeHistory(env,now+300000,request);
  assert.equal(calls,1,'Hourly lease prevents duplicate provider polling');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM change_events').get().n,2,'Runtime and commit entries are idempotent');
  assert(!JSON.stringify(db.prepare('SELECT * FROM change_events').all()).includes('PRIVATE_NOT_COPIED'));
  await syncRuntimeHistory(env,now+3600000,async()=>{throw Error('PRIVATE_PROVIDER_ERROR');});
  assert.equal(db.prepare("SELECT state FROM change_history_sync WHERE source='github_recent'").get().state,'unavailable');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM change_events').get().n,2,'Outage preserves last recorded evidence');
  await syncRuntimeHistory(env,now+4500000,request);assert.equal(calls,2,'Failed read retries in fifteen minutes');
  const report=await changeHistory(DB,new URLSearchParams(),now+4500000);
  assert(report.events.some(e=>e.action==='runtime_observed'));
  console.log('PASS: scheduled source sync, metadata minimization, bounded polling, retries, executing version evidence, immutable existing history.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
