// Exact compiled provider-only cron. All HTTP and D1 records are isolated synthetic fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { migrationStatements } from './sql-migration-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),built=path.join(root,'dist/server');
const config=JSON.parse(await fs.readFile(path.join(built,'wrangler.json'),'utf8')),cron='7,22,37,52 * * * *';
assert(config.triggers?.crons?.includes(cron));assert(config.triggers.crons.includes('0 9 * * *'));assert(config.triggers.crons.includes('*/5 * * * *'));
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'trybiomod-provider-history-'));
const paths=(await fs.readdir(built,{recursive:true})).filter(name=>/\.(?:m?js)$/.test(name));
const sha='a'.repeat(40),id='11111111-1111-4111-8111-111111111111',time='2026-11-27T10:00:00Z';
const account='99aaaddf04e12ed1467d146bb2467455',worker='biomod-peptides';
const calls=[];let denied=0;
const mf=new Miniflare({name:'isolated-provider-history',cf:false,unsafeTriggerHandlers:true,
 modules:[config.main,...paths.filter(name=>name!==config.main)].map(name=>({type:'ESModule',path:path.join(built,name)})),modulesRoot:built,
 compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
 bindings:{HISTORY_CLOUDFLARE_READ_TOKEN:'fixture-read-only'},d1Databases:{DB:'fixture-provider-history'},d1Persist:path.join(temporary,'d1'),
 outboundService:async request=>{
  const url=new URL(request.url);calls.push(request.url);
  const allowed=request.method==='GET'&&(url.hostname==='api.github.com'&&url.pathname.startsWith('/repos/thetaxfirm/biomodpeptides/')&&!request.headers.has('authorization')||url.hostname==='api.cloudflare.com'&&url.pathname.startsWith(`/client/v4/accounts/${account}/`)
    &&request.headers.get('authorization')==='Bearer fixture-read-only');
  if(!allowed){denied++;throw Error('Unexpected provider or credential in isolated fixture');}
  if(url.hostname==='api.github.com')return Response.json(url.pathname.endsWith('/check-runs')?{total_count:1,check_runs:[{id:123,app:{slug:'github-actions'},status:'completed',conclusion:'success',started_at:time,completed_at:time,output:{text:'PRIVATE_CHECK_CONTENT'}}]}:[{sha,author:{login:'fixture-contributor'},commit:{author:{name:'Fixture author'},committer:{name:'Fixture committer',date:time},verification:{verified:true},message:'PRIVATE_COMMIT_MESSAGE'}}]);
  if(url.pathname===`/client/v4/accounts/${account}/workers/scripts/${worker}/deployments`)return Response.json({success:true,result:{deployments:[{id,created_on:time,author_email:'fixture@example.invalid',source:'wrangler',versions:[{version_id:id,percentage:100}]}]},result_info:{total_count:1}});
  if(url.pathname===`/client/v4/accounts/${account}/workers/scripts/${worker}/versions`)return Response.json({success:true,result:{items:[{id,number:1,metadata:{created_on:time,author_email:'fixture@example.invalid',source:'wrangler'},resources:{bindings:[{text:'PRIVATE_BINDING_VALUE'}]}}]},result_info:{total_count:1}});
  if(url.pathname===`/client/v4/accounts/${account}/logs/audit`)return Response.json({success:true,result:[{id,action:{time,type:'update',result:'success'},actor:{email:'fixture@example.invalid',context:'api_token',ip_address:'PRIVATE_IP'},raw:{method:'PATCH',uri:`/accounts/${account}/workers/scripts/${worker}/settings?PRIVATE_QUERY`},resource:{request:{token:'PRIVATE_TOKEN'}}}],result_info:{}});
  denied++;throw Error('Unknown provider route in isolated fixture');
 },log:new Log(LogLevel.ERROR),
});
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for(const file of(await fs.readdir(path.join(root,'drizzle'))).filter(file=>file.endsWith('.sql')).sort())await db.batch(migrationStatements(await fs.readFile(path.join(root,'drizzle',file),'utf8')).map(sql=>db.prepare(sql)));
 const tick=async()=>{const response=await mf.dispatchFetch('http://localhost/cdn-cgi/handler/scheduled?cron='+encodeURIComponent(cron));assert.equal(response.status,200,(await response.text()).slice(0,300));};
 await tick();assert.equal(calls.length,6);assert.equal(denied,0);
 const coverage=(await db.prepare("SELECT source,state,description FROM change_history_sync WHERE source LIKE '%_scheduled'").all()).results;assert.equal(coverage.length,5);assert(coverage.every(row=>row.state==='active'));
 const history=(await db.prepare("SELECT * FROM change_events WHERE action IN ('source_commit_scheduled','build_check','worker_deployment','worker_version','platform_change')").all()).results;assert.equal(history.length,5);assert(history.every(row=>row.occurred_at===Date.parse(time)));assert(!JSON.stringify(history).includes('PRIVATE_'));
 await tick();assert.equal(calls.length,6,'provider leases prevent repeat network polling');
 await db.prepare('UPDATE provider_history_poll SET next_attempt_at=0').run();await tick();assert.equal(calls.length,12);assert.equal((await db.prepare("SELECT COUNT(*) n FROM change_events WHERE action IN ('source_commit_scheduled','build_check','worker_deployment','worker_version','platform_change')").first()).n,5,'repeated feeds preserve immutable first evidence');
 for(const table of['orders','rewards','coa_delivery_outbox','checkout_recovery'])assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n,0);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM settings WHERE key IN ('auto_label_health_v1','payment_verify_health_v1','coa_scheduler_health_v1','checkout_expiry_health_v1')").first()).n,0,'provider timer never runs business jobs');
 assert.equal(denied,0);console.log('PASS: compiled provider-only timer preserves existing crons, reads fixed GitHub/Cloudflare GET endpoints with isolated credentials, records five privacy-filtered feeds, preserves immutable repeats and never runs commerce/email jobs.');
}finally{await mf.dispose();await fs.rm(temporary,{recursive:true,force:true});}
