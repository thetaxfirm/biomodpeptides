// Actual scheduled provider logic with isolated SQLite, synthetic metadata and no real credentials/network.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{DatabaseSync}=require('node:sqlite');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {syncProviderHistory,PROVIDER_HISTORY_CRON}=require('../lib/provider-history-sync.ts');
const {providerJson}=require('../lib/provider-history-http.ts');
const {changeHistory}=require('../lib/change-history.ts');
const {commitEvent,insertStatement,target}=require('../lib/change-history-provider-events.mjs');
const now=Date.parse('2026-11-27T10:00:00Z'),minute=60000,hour=60*minute;
const sha=n=>n.toString(16).padStart(40,'0'),uuid=n=>n.toString(16).padStart(32,'0'),date=n=>new Date(now-n*1000).toISOString();
const commit=n=>({sha:sha(n),author:{login:'fixture-contributor'},commit:{author:{name:'Fixture author'},committer:{name:'Fixture committer',date:date(n)},message:'PRIVATE_COMMIT_BODY',verification:{verified:true}}});
const deployment=n=>({id:uuid(n),created_on:date(n),author_email:'operator@example.invalid',source:'wrangler',versions:[{version_id:uuid(n),percentage:100}],annotations:{private:'PRIVATE_DEPLOYMENT'}});
const version=n=>({id:uuid(n),number:n,metadata:{created_on:date(n),author_email:'operator@example.invalid',source:'wrangler'},resources:{bindings:[{name:'PRIVATE_SECRET_NAME',text:'PRIVATE_SECRET_VALUE'}]}});
const audit=n=>({id:uuid(n),action:{time:date(n),type:'update',result:'success'},actor:{email:'operator@example.invalid',context:'api_token',ip_address:'PRIVATE_IP',token_name:'PRIVATE_TOKEN'},raw:{method:'PATCH',uri:`/accounts/${target.account}/workers/scripts/${target.worker}/settings?private=PRIVATE_QUERY`},resource:{request:{private:'PRIVATE_BODY'}}});
function fixture(){const sql=new DatabaseSync(':memory:');for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 const statement=(query,args=[])=>({query,args,bind:(...values)=>statement(query,values),all:async()=>({results:sql.prepare(query).all(...args)}),first:async()=>sql.prepare(query).get(...args)||null,run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}})});
 const DB={prepare:statement,batch:async statements=>{sql.exec('BEGIN');try{const result=statements.map(s=>({meta:{changes:Number(sql.prepare(s.query).run(...s.args).changes)}}));sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 return{sql,DB,health:source=>sql.prepare('SELECT * FROM change_history_sync WHERE source=?').get(source),poll:source=>sql.prepare('SELECT * FROM provider_history_poll WHERE source=?').get(source),count:action=>sql.prepare('SELECT COUNT(*) n FROM change_events WHERE action=?').get(action).n};}
(async()=>{
 assert.equal(PROVIDER_HISTORY_CRON,'7,22,37,52 * * * *');
 const f=fixture(),calls=[];let checkStatus='in_progress';
 const publicRead=async(url,options)=>{calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert(!options.headers.Authorization);const u=new URL(url);assert.equal(u.hostname,'api.github.com');
  if(u.pathname.endsWith('/check-runs'))return Response.json({total_count:1,check_runs:[{id:Number.parseInt(u.pathname.split('/').at(-2),16),app:{slug:'github-actions'},status:checkStatus,conclusion:checkStatus==='completed'?'success':null,started_at:date(1),completed_at:checkStatus==='completed'?date(0):null,output:{text:'PRIVATE_CHECK_BODY'}}]});
  if(u.searchParams.get('per_page')==='20')return Response.json([commit(1),commit(2)]);
  if(u.searchParams.get('page')==='2'){assert.equal(u.searchParams.get('sha'),sha(1),'later history pages use stable commit anchor');return Response.json([commit(101)]);}
  return Response.json(Array.from({length:100},(_,i)=>commit(i+1)));
 };
 await syncProviderHistory({DB:f.DB},now,publicRead);assert.equal(f.count('source_commit_scheduled'),100);assert.equal(f.health('github_commits_scheduled').state,'partial');assert.equal(f.health('github_checks_scheduled').state,'active');assert.equal(f.count('build_check'),2);
 for(const source of ['cloudflare_scheduled','cloudflare_versions_scheduled','cloudflare_audit_scheduled']){assert.equal(f.health(source).state,'unavailable');assert.match(f.health(source).description,/HISTORY_CLOUDFLARE_READ_TOKEN/);}
 const firstCalls=calls.length;await syncProviderHistory({DB:f.DB},now+5*minute,publicRead);assert.equal(calls.length,firstCalls,'leases and next-attempt deadlines prevent extra polling');
 checkStatus='completed';await syncProviderHistory({DB:f.DB},now+15*minute,publicRead);assert.equal(f.count('source_commit_scheduled'),101);assert.equal(f.health('github_commits_scheduled').state,'active');assert.equal(f.count('build_check'),4,'check transitions append separate evidence');
 const imported=insertStatement(commitEvent(commit(1),['lib/fixture.ts'],now));f.sql.prepare(imported.sql).run(...imported.params);
 const report=await changeHistory(f.DB,new URLSearchParams({q:sha(1)}),now+15*minute);assert(report.events.some(e=>e.action==='source_commit'));assert(!report.events.some(e=>e.action==='source_commit_scheduled'),'richer importer can coexist and is preferred without rewriting scheduled evidence');
 assert(!JSON.stringify(f.sql.prepare('SELECT * FROM change_events').all()).includes('PRIVATE_'));
 const g=fixture(),providerCalls=[];let auditDenied=false;
 const providerRead=async(url,options)=>{providerCalls.push(url);assert.equal(options.redirect,'manual');const u=new URL(url);
  if(u.hostname==='api.github.com'){assert.equal(options.headers.Authorization,undefined);return Response.json(u.pathname.endsWith('/check-runs')?{total_count:0,check_runs:[]}:[commit(1)]);}
  assert.equal(u.hostname,'api.cloudflare.com');assert.equal(options.headers.Authorization,'Bearer fixture-reader-only');assert.equal(options.method,'GET');
  if(u.pathname.endsWith('/logs/audit')){if(auditDenied)return new Response('PRIVATE_PROVIDER_ERROR',{status:403});if(u.searchParams.has('cursor')){assert.equal(u.searchParams.get('before'),new Date(now).toISOString());assert.equal(u.searchParams.get('cursor'),'fixture_next');return Response.json({success:true,result:[audit(2)],result_info:{}});}return Response.json({success:true,result:[audit(1),{...audit(3),raw:{method:'GET',uri:'/unrelated'},zone:{name:'other.invalid'}}],result_info:{cursor:'fixture_next'}});}
  const isVersion=u.pathname.endsWith('/versions'),page=Number(u.searchParams.get('page'));if(!isVersion)assert.equal(u.searchParams.get('until'),new Date(now).toISOString());
  const rows=page===1?Array.from({length:100},(_,i)=>(isVersion?version:deployment)(i+1)):[(isVersion?version:deployment)(101)];return Response.json({success:true,result:{[isVersion?'items':'deployments']:rows},result_info:{total_count:101}});
 };
 const env={DB:g.DB,HISTORY_CLOUDFLARE_READ_TOKEN:'fixture-reader-only'};
 await syncProviderHistory(env,now,providerRead);assert.equal(g.health('cloudflare_scheduled').state,'partial');assert.equal(g.health('cloudflare_versions_scheduled').state,'partial');assert.equal(g.health('cloudflare_audit_scheduled').state,'partial');assert.equal(g.count('platform_change'),1);
 await syncProviderHistory(env,now+15*minute,providerRead);assert.equal(g.count('worker_deployment'),101);assert.equal(g.count('worker_version'),101);assert.equal(g.count('platform_change'),2);assert.equal(g.health('cloudflare_audit_scheduled').state,'active');
 assert(!JSON.stringify(g.sql.prepare('SELECT * FROM change_events').all()).includes('PRIVATE_'));
 auditDenied=true;g.sql.prepare("UPDATE provider_history_poll SET next_attempt_at=0 WHERE source='cloudflare_audit_scheduled'").run();await syncProviderHistory(env,now+16*minute,providerRead);assert.equal(g.health('cloudflare_audit_scheduled').state,'unavailable');assert.match(g.health('cloudflare_audit_scheduled').description,/HTTP 403/);assert.equal(g.count('platform_change'),2);assert.equal(g.health('cloudflare_scheduled').state,'active','one denied feed does not replace other successful coverage');
 const h=fixture();h.sql.exec("CREATE TRIGGER reject_source BEFORE INSERT ON change_events WHEN NEW.action='source_commit_scheduled' BEGIN SELECT RAISE(ABORT,'PRIVATE_DB_ERROR'); END");await syncProviderHistory({DB:h.DB},now,publicRead);assert.equal(h.count('source_commit_scheduled'),0);assert.equal(h.poll('github_commits_scheduled').checkpoint,'{}','failed inserts do not advance cursor');assert.match(h.health('github_commits_scheduled').description,/persistence failed/);assert(!h.health('github_commits_scheduled').description.includes('PRIVATE'));
  h.sql.prepare("UPDATE provider_history_poll SET checkpoint=?,next_attempt_at=0 WHERE source='github_commits_scheduled'").run('{"page":"invalid"}');await syncProviderHistory({DB:h.DB},now+minute,publicRead);assert.match(h.health('github_commits_scheduled').description,/checkpoint is invalid/);assert.equal(h.poll('github_commits_scheduled').checkpoint,'{"page":"invalid"}','corrupt checkpoint is identified without silently losing scan position');
 await assert.rejects(()=>providerJson(async()=>{throw Error('PRIVATE_NETWORK')},'https://api.github.com/repos/x'),/network request failed/);
 await assert.rejects(()=>providerJson(async()=>new Response(null,{status:302,headers:{location:'https://private.invalid/PRIVATE'}}),'https://api.github.com/repos/x'),/HTTP 302/);
 await assert.rejects(()=>providerJson(async()=>new Response('x'.repeat(4*1024*1024+1)),'https://api.github.com/repos/x'),/size limit/);
 await assert.rejects(()=>providerJson(async()=>{throw Error('must not fetch')},'https://other.invalid/','fixture-reader-only'),/target validation/);
  await assert.rejects(()=>providerJson(async()=>{throw Error('must not fetch')},'https://api.cloudflare.com:8443/','fixture-reader-only'),/target validation/);
  const p=fixture(),pageCalls=[];const paged=async(url,options)=>{const u=new URL(url);pageCalls.push(url);if(u.pathname.endsWith('/check-runs')){const page=Number(u.searchParams.get('page'));return Response.json({total_count:6,check_runs:[{id:page,app:{slug:'github-actions'},status:'completed',conclusion:'success',started_at:date(page),completed_at:date(page)}]});}return Response.json([commit(1)]);};
  await syncProviderHistory({DB:p.DB},now,paged);assert.equal(p.count('build_check'),5);assert.equal(p.health('github_checks_scheduled').state,'partial');assert.equal(JSON.parse(p.poll('github_checks_scheduled').checkpoint).page,6,'short pages with a larger reported total remain incomplete');
  await syncProviderHistory({DB:p.DB},now+15*minute,paged);assert.equal(p.count('build_check'),6);assert.equal(p.health('github_checks_scheduled').state,'active');assert(pageCalls.some(url=>url.endsWith('page=6')));
  const beforeConcurrent=pageCalls.length;await Promise.all([syncProviderHistory({DB:p.DB},now+16*minute,paged),syncProviderHistory({DB:p.DB},now+16*minute,paged)]);assert.equal(pageCalls.length,beforeConcurrent);
  for(const database of[f,g,h,p]){assert.equal(database.sql.prepare('SELECT COUNT(*) n FROM orders').get().n,0);assert.equal(database.sql.prepare('SELECT COUNT(*) n FROM rewards').get().n,0);database.sql.close();}
 console.log('PASS: scheduled provider metadata, anchored pagination, separate check transitions, bounded retries/leases, missing and denied access, atomic cursor/event persistence, independent coverage and privacy. No real providers.');
})().catch(error=>{console.error(error);process.exitCode=1;});
