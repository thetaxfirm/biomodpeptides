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
  const {commitEvent,insertStatement}=await import('../scripts/change-history-import-v1.mjs');
  const imported=commitEvent({sha,commit:{committer:{date:new Date(now-1000).toISOString(),name:'Fixture committer'},author:{name:'Fixture author'},verification:{verified:true}}},['lib/fixture.ts'],now);
  const statement=insertStatement(imported);db.prepare(statement.sql).run(...statement.params);
  const canonical=db.prepare('SELECT * FROM change_events WHERE id=?').get('github:commit:'+sha);
  assert(canonical,'a prior scheduled observation cannot reserve the richer importer identity');
  assert.equal(canonical.actor,'Fixture author');assert.match(canonical.changes,/lib\/fixture\.ts/);assert.match(canonical.changes,/Signature verified/);
  const observed=db.prepare('SELECT * FROM change_events WHERE id=?').get('github:observed-source:'+sha);assert.equal(observed.action,'source_observed');
  const preferred=await changeHistory(DB,new URLSearchParams(),now+4500000);
  assert(!preferred.events.some(e=>e.action==='source_observed'),'Default view prefers richer source evidence without deleting observations');
  const count=db.prepare('SELECT COUNT(*) n FROM change_events').get().n;
  await syncRuntimeHistory(env,now+7200000,request);assert.equal(db.prepare('SELECT COUNT(*) n FROM change_events').get().n,count,'later scheduled runs duplicate neither evidence record');
  const atom = (entries) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.map(({sha,date})=>`<entry><id>tag:github.com,2008:Grit::Commit/${sha}</id><link type="text/html" rel="alternate" href="https://github.com/thetaxfirm/biomodpeptides/commit/${sha}"/><updated>${date}</updated><title>PRIVATE_TITLE</title><author><email>PRIVATE_EMAIL</email></author></entry>`).join('')}</feed>`;
  const fallbackSha='b'.repeat(40),date=new Date(now-2000).toISOString();
  const health=()=>db.prepare("SELECT state,description FROM change_history_sync WHERE source='github_recent'").get();
  const release=()=>db.prepare("UPDATE change_history_sync SET synced_at=0 WHERE source='source_poll'").run();
  let fallbackCalls=[];release();
  await syncRuntimeHistory({DB},now+8000000,async(url,options)=>{
    fallbackCalls.push(url);assert.equal(options.redirect,'error');assert(!options.headers.Authorization);
    return url.startsWith('https://api.github.com/')?new Response('PRIVATE_API_BODY',{status:403,headers:{'x-ratelimit-remaining':'0'}}):new Response(atom([{sha:fallbackSha,date}]),{headers:{'content-type':'application/atom+xml'}});
  });
  assert.equal(fallbackCalls.length,2);assert.equal(health().state,'active');assert.match(health().description,/Atom fallback \(REST API HTTP 403 \(rate limited\)\)/);
  assert.equal(db.prepare('SELECT occurred_at FROM change_events WHERE entity_id=?').get(fallbackSha).occurred_at,now-2000);
  assert(!JSON.stringify(db.prepare('SELECT * FROM change_events').all()).includes('PRIVATE_'));
  const afterFallback=db.prepare('SELECT COUNT(*) n FROM change_events').get().n;
  for(const invalid of [
    atom([{sha:'c'.repeat(40),date},{sha:'not-a-sha',date}]),
    atom([{sha:'c'.repeat(40),date:'2026-02-30T00:00:00Z'}]),
    atom([{sha:'c'.repeat(40),date}]).replace('/thetaxfirm/biomodpeptides/commit/','/other/repository/commit/'),
    atom(Array.from({length:21},()=>({sha:'c'.repeat(40),date}))),
    atom([{sha:'c'.repeat(40),date}]).replace('<feed','<!DOCTYPE feed [<!ENTITY x "PRIVATE_ENTITY">]><feed'),
    'x'.repeat(256*1024+1),
  ]){
    release();await syncRuntimeHistory({DB},now+9000000,async url=>url.startsWith('https://api.github.com/')?Response.json([{sha:'bad',commit:{committer:{date}}}]):new Response(invalid));
    assert.equal(health().state,'unavailable');assert.match(health().description,/REST API metadata validation failed; Atom feed/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM change_events').get().n,afterFallback,'invalid feed cannot persist an earlier valid entry');
  }
  release();await syncRuntimeHistory({DB},now+10000000,async url=>url.startsWith('https://api.github.com/')?new Response('PRIVATE_FAILURE',{status:429}):new Response('PRIVATE_FAILURE',{status:503}));
  assert.match(health().description,/REST API HTTP 429 \(rate limited\); Atom feed HTTP 503/);assert(!health().description.includes('PRIVATE'));
  release();await syncRuntimeHistory({DB},now+11000000,async()=>{throw Error('PRIVATE_NETWORK_MESSAGE');});
  assert.match(health().description,/REST API network request failed; Atom feed network request failed/);assert(!health().description.includes('PRIVATE'));
  const broken={prepare(sql){if(sql.startsWith('INSERT OR IGNORE INTO change_events'))return{bind(){return{run:async()=>{throw Error('PRIVATE_DATABASE_MESSAGE');}}}};return DB.prepare(sql);}};
  release();let saveFetches=0;await syncRuntimeHistory({DB:broken},now+12000000,async()=>{saveFetches++;return Response.json([{sha:'d'.repeat(40),commit:{committer:{date}}}]);});
  assert.equal(saveFetches,1,'persistence errors do not retry a different source');assert.match(health().description,/Source history persistence failed/);assert(!health().description.includes('PRIVATE'));
  console.log('PASS: scheduled source sync, metadata minimization, bounded polling, retries, executing version evidence, immutable existing history.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
