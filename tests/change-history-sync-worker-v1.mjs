// Exact compiled scheduled handler, isolated D1 and mocked public GitHub feeds only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { migrationStatements } from './sql-migration-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),built=path.join(root,'dist/server');
const config=JSON.parse(await fs.readFile(path.join(built,'wrangler.json'),'utf8'));
assert(config.triggers?.crons?.includes('*/5 * * * *'));
assert.equal(config.version_metadata?.binding,'CF_VERSION_METADATA');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'trybiomod-history-sync-'));
const names=(await fs.readdir(built,{recursive:true})).filter(name=>/\.(?:m?js)$/.test(name));
const version='11111111-1111-4111-8111-111111111111',now=Date.now();
const revisions=Array.from({length:20},(_,i)=>({sha:(i+1).toString(16).padStart(40,'0'),timestamp:now-(i+1)*60000}));
const atom=`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${revisions.map(row=>`<entry><id>tag:github.com,2008:Grit::Commit/${row.sha}</id><link type="text/html" rel="alternate" href="https://github.com/thetaxfirm/biomodpeptides/commit/${row.sha}"/><updated>${new Date(row.timestamp).toISOString()}</updated><title>PRIVATE_FIXTURE_TITLE</title><author><email>PRIVATE_FIXTURE_EMAIL</email></author></entry>`).join('')}</feed>`;
const calls=[];let forbidden=0;
const mf=new Miniflare({name:'isolated-source-history',cf:false,unsafeTriggerHandlers:true,
  modules:[config.main,...names.filter(name=>name!==config.main)].map(name=>({type:'ESModule',path:path.join(built,name)})),modulesRoot:built,
  compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
  bindings:{CF_VERSION_METADATA:{id:version}},d1Databases:{DB:'isolated-source-history'},d1Persist:path.join(temporary,'d1'),
  outboundService:async request=>{
    calls.push(request.url);
    if(request.method!=='GET'||request.headers.has('authorization')){forbidden++;throw Error('Only unauthenticated public GET requests are allowed in this fixture');}
    if(request.url==='https://api.github.com/repos/thetaxfirm/biomodpeptides/commits?sha=main&per_page=100')return new Response('Fixture rate limit',{status:403,headers:{'x-ratelimit-remaining':'0'}});
    if(request.url==='https://github.com/thetaxfirm/biomodpeptides/commits/main.atom')return new Response(atom,{headers:{'content-type':'application/atom+xml'}});
    forbidden++;throw Error('External call prohibited in this fixture');
  },log:new Log(LogLevel.ERROR),
});
try{
  await mf.ready;const db=await mf.getD1Database('DB');
  for(const name of(await fs.readdir(path.join(root,'drizzle'))).filter(name=>name.endsWith('.sql')).sort())await db.batch(migrationStatements(await fs.readFile(path.join(root,'drizzle',name),'utf8')).map(sql=>db.prepare(sql)));
  const tick=async()=>{const response=await mf.dispatchFetch('http://localhost/cdn-cgi/handler/scheduled?cron='+encodeURIComponent('*/5 * * * *'));assert.equal(response.status,200,(await response.text()).slice(0,300));};
  await tick();assert.equal(calls.length,2);assert.equal(forbidden,0);
  const health=await db.prepare("SELECT source,state,description FROM change_history_sync WHERE source IN ('runtime','github_recent')").all();
  assert.equal(health.results.find(row=>row.source==='runtime')?.state,'active');
  assert.equal(health.results.find(row=>row.source==='github_recent')?.state,'active');
  assert.match(health.results.find(row=>row.source==='github_recent').description,/Atom fallback \(REST API HTTP 403 \(rate limited\)\).*newest 20/);
  const observed=(await db.prepare("SELECT entity_id,occurred_at,changes FROM change_events WHERE action='source_observed' ORDER BY occurred_at DESC").all()).results;
  assert.equal(observed.length,20);assert.deepEqual(observed.map(row=>({sha:row.entity_id,timestamp:row.occurred_at})),revisions);
  const records=JSON.stringify((await db.prepare('SELECT * FROM change_events').all()).results);assert(!records.includes('PRIVATE_FIXTURE'));assert.equal((await db.prepare("SELECT COUNT(*) n FROM change_events WHERE action='runtime_observed'").first()).n,1);
  await tick();assert.equal(calls.length,2,'next five-minute tick keeps the hourly polling lease');
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM change_events WHERE action='source_observed'").first()).n,20);
  await db.prepare("UPDATE change_history_sync SET synced_at=0 WHERE source='source_poll'").run();await tick();assert.equal(calls.length,4,'next allowed poll reads both public sources');
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM change_events WHERE action='source_observed'").first()).n,20,'repeat feed is immutable and idempotent');
  for(const table of ['orders','inventory_reservations','requests','rewards','coa_delivery_outbox','request_reply_messages','checkout_recovery','affiliate_order_terms']) assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0,table+' stays empty');
  const runtime=(await db.prepare("SELECT id,entity_id FROM change_events WHERE action='runtime_observed'").all()).results;assert.deepEqual(runtime,[{id:'cloudflare:runtime:'+version,entity_id:version}],'the executing version is recorded once after repeated ticks');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM change_context').first()).n,0);assert.equal(forbidden,0);
  console.log('PASS: compiled scheduled Worker records runtime version and 20 chronologically correct source observations through REST 403 → public Atom fallback; polling lease and immutable duplicates hold. No customer rows or real outbound calls.');
}finally{await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}
