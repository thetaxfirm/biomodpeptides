// Shared report boundaries against actual SQLite aggregation; synthetic rows only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const original=Module._load;
Module._load=function(id,parent,isMain){if(parent?.filename.endsWith('admin-overview.ts')&&id==='./reply-overdue')return{overdueCustomers:async()=>[]};return original.call(this,id,parent,isMain);};
const {salesDiagnostics,diagnosticWindow}=require('../lib/sales-diagnostics.ts'),{financialReport}=require('../lib/admin-finance.ts'),{promoAnalytics}=require('../lib/promo-analytics.ts'),{readAdminOverviewOrderSummary}=require('../lib/admin-overview-db.ts');
const {financialCsv}=require('../lib/admin-finance-export.ts'),{salesDiagnosticsExport}=require('../lib/sales-diagnostics-export.ts'),{promoAnalyticsExport}=require('../lib/promo-analytics-export.ts');
Module._load=original;
const sql=new DatabaseSync(':memory:');for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
let reads=0;const all=async(query,...values)=>{reads++;assert(values.length<=100,'D1 bind limit');return sql.prepare(query).all(...values);};
const db={prepare(query){let values=[];return{bind(...v){values=v;return this;},async all(){return{results:await all(query,...values)};},async first(){return(await all(query,...values))[0]||null;}};}};
const now=Date.parse('2026-11-27T12:00:00Z');
let next=0;
function seed(created){const id='report-fixture-'+(++next);sql.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,payment_ref,notification_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'synthetic-owner',id,'paid',1000,JSON.stringify({environment:'live',subtotal:1000,discount:100,tax:0,shipping:0,promo:{code:'BM10',savings:100},privateFixture:'DO_NOT_EXPORT'}),'synthetic-payment-'+id,'synthetic-notice-'+id,created,created);sql.prepare('INSERT INTO requests(id,owner,kind,status,data,created) VALUES(?,?,?,?,?,?)').run(id,'synthetic-owner','contact','new','{}',created);}
(async()=>{
 for(const [from,to,timeZone] of [['2026-03-08','2026-03-08','America/New_York'],['2026-11-01','2026-11-01','America/New_York'],['2026-10-04','2026-10-04','Australia/Lord_Howe'],['2026-01-05','2026-01-05','Asia/Kathmandu']]){
  const options={from,to,timeZone},window=diagnosticWindow(null,now,options);
  for(const time of [window.start-1,window.start,window.end-1,window.end])seed(time);
  const deps={requireAdmin:async()=>{},all};
  const [sales,finance,promos,overview]=await Promise.all([salesDiagnostics(deps,null,now,options),financialReport(db,null,now,options),promoAnalytics(deps,null,now,true,options),readAdminOverviewOrderSummary(db,[],now,options)]);
  assert.deepEqual(sales.window,finance.window);assert.equal(promos.window.start,window.start);assert.equal(promos.window.end,window.end);
  assert.equal(sales.orders.reduce((n,r)=>n+r.orders,0),2,'Inclusive first and exclusive next-day instant select exactly two orders');
  assert.equal(sales.requests.reduce((n,r)=>n+r.records,0),2);assert(sales.orders.every(r=>r.day===from&&r.dayUtc===undefined),'Business dates are never mislabeled UTC');
  assert.equal(finance.recordedPaymentOrders,2);assert.equal(finance.amounts.gross.cents,2000);
  const promo=promos.codes.find(c=>c.code==='BM10').rows.find(r=>r.environment==='live');assert.equal(promo.paymentRecorded,2);assert.equal(promo.grossCents,2000);
  assert.equal(overview.sales.at(-1).live.paymentRecorded,2);assert.equal(overview.sales.at(-1).live.grossCents,2000);
  for(const file of [financialCsv(finance),salesDiagnosticsExport(sales),promoAnalyticsExport(promos)]){assert(file.csv.includes(window.timeZone));assert(file.csv.includes(new Date(window.start).toISOString()));assert(file.csv.includes(new Date(window.end).toISOString()));assert(!file.csv.includes('DO_NOT_EXPORT'));assert(!file.csv.includes('synthetic-owner'));}
 }
 const max={from:'2025-11-01',to:'2026-11-01',timeZone:'America/New_York'};const large=await salesDiagnostics({requireAdmin:async()=>{},all},null,now,max);assert.equal(large.window.days,366);
 const before=reads;await assert.rejects(salesDiagnostics({requireAdmin:async()=>{throw Error('denied');},all},null,now,new URLSearchParams('timeZone=Invalid')),/denied/);assert.equal(reads,before,'Authorization precedes options and SQL');
 await assert.rejects(promoAnalytics({requireAdmin:async()=>{throw Error('denied');},all},null,now,true,new URLSearchParams('from=a&from=b')),/denied/);assert.equal(reads,before);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM orders WHERE json_extract(data,'$.privateFixture')='DO_NOT_EXPORT'").get().n,16,'Reports never rewrite source rows');
 console.log('PASS: Sales/Finance/Promos/Today select the same DST and offset cohorts, SQL first-inclusive/last-exclusive boundaries, bounded bindings, accurate CSV timezone/instant metadata, authorization and immutable private rows.');
})().catch(error=>{console.error(error);process.exitCode=1});
