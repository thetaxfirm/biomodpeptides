/* Actual SQLite reporting across calendar boundaries; synthetic counts only, no network. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,f);
const {trafficReport,shoppingReport}=require('../lib/traffic-metrics-server.ts');
const {diagnosticWindow}=require('../lib/sales-diagnostics.ts');
const {calendarReportWindow,reportDayBoundaries,reportDate}=require('../lib/report-window.ts');
const DB=new DatabaseSync(':memory:');
for(const file of ['0014_aggregate_traffic.sql','0015_aggregate_shopping.sql','0045_report_window_aggregates.sql'])DB.exec(fs.readFileSync(path.join(__dirname,'../drizzle',file),'utf8'));
let reads=0,queries=[];
function statement(sql,values=[]){return {bind:(...next)=>statement(sql,next),first:async()=>{queries.push({sql,values});return DB.prepare(sql).get(...values)||null},all:async()=>{queries.push({sql,values});return {results:DB.prepare(sql).all(...values)}},run:async()=>({meta:DB.prepare(sql).run(...values)}),execute:()=>({meta:DB.prepare(sql).run(...values)})};}
const db={prepare:sql=>statement(sql),batch:async statements=>{DB.exec('BEGIN');try{const result=statements.map(s=>s.execute());DB.exec('COMMIT');return result}catch(e){DB.exec('ROLLBACK');throw e}}};
let now=Date.parse('2026-11-05T18:00:00Z');
const env={TRAFFIC_MEASUREMENT_ENABLED:'true',TRAFFIC_MEASUREMENT_STARTED_AT:'2026-01-01T00:00:00Z',SHOPPING_MEASUREMENT_ENABLED:'true',SHOPPING_MEASUREMENT_STARTED_AT:'2026-01-01T00:00:00Z'};
const deps={requireAdmin:async()=>{},env:()=>env,database:()=>{reads++;return db},now:()=>now};
const request=query=>new Request('https://trybiomod.com/api/metrics/report?'+query);
async function report(kind,params){const response=await (kind==='traffic'?trafficReport:shoppingReport)(request(params),deps);assert.equal(response.status,200,await response.clone().text());return response.json()}
function clear(){DB.exec('DELETE FROM traffic_daily; DELETE FROM shopping_daily; DELETE FROM traffic_minute; DELETE FROM shopping_minute; DELETE FROM metrics_time_coverage')}
function coverage(at){for(const kind of ['traffic','shopping'])DB.prepare('INSERT INTO metrics_time_coverage VALUES(?,?)').run(kind,at)}
function countAt(at,count=1){const day=reportDate(at),bucket=Math.floor(at/60000)*60000;DB.prepare(`INSERT INTO traffic_daily VALUES(?,'home','search',?) ON CONFLICT(day,page_group,source_group) DO UPDATE SET event_count=event_count+excluded.event_count`).run(day,count);DB.prepare(`INSERT INTO shopping_daily VALUES(?,'cart_view',?) ON CONFLICT(day,stage) DO UPDATE SET event_count=event_count+excluded.event_count`).run(day,count);DB.prepare(`INSERT INTO traffic_minute VALUES(?,'home','search',?) ON CONFLICT(bucket,page_group,source_group) DO UPDATE SET event_count=event_count+excluded.event_count`).run(bucket,count);DB.prepare(`INSERT INTO shopping_minute VALUES(?,'cart_view',?) ON CONFLICT(bucket,stage) DO UPDATE SET event_count=event_count+excluded.event_count`).run(bucket,count)}
(async()=>{
 const realFetch=global.fetch;global.fetch=()=>{throw Error('Network forbidden')};
 try{
  for(const [zone,date,clock,hours] of [['America/New_York','2026-03-08','2026-03-11T18:00:00Z',23],['America/New_York','2026-11-01','2026-11-05T18:00:00Z',25],['Australia/Lord_Howe','2026-10-04','2026-10-08T18:00:00Z',23.5],['Asia/Kathmandu','2026-10-04','2026-10-08T18:00:00Z',24]]){
   clear();now=Date.parse(clock);const query=new URLSearchParams({from:date,to:date,timeZone:zone}),window=calendarReportWindow(null,now,query,{defaultDays:30,allowedDays:[7,30,90]});
   assert.equal(window.end-window.start,hours*3600000);coverage(window.start-86400000);
   countAt(window.start-60000,2);countAt(window.start,3);countAt(window.end-60000,5);countAt(window.end,7);
   for(const kind of ['traffic','shopping']){
    const value=await report(kind,query);assert.equal(value.totals.events,8,zone+' '+kind);assert.equal(value.completedDays.length,1);assert.equal(value.completedDays[0].date,date);assert.equal(value.partialToday,null);assert.equal(value.window.startInstant,window.start);assert.equal(value.window.endInstant,window.end);assert.equal(value.window.aggregation,'minute');assert.equal(value.window.requestedTo,date);assert.equal(value.window.timeZone,window.timeZone);assert.equal(value.activationDayPartial,null);
   }
   const sales=diagnosticWindow(null,now,query);assert.equal(sales.start,window.start);assert.equal(sales.end,window.end);
  }
  clear();now=Date.parse('2026-11-05T18:00:00Z');countAt(Date.parse('2026-11-01T12:00:00Z'),4);
  DB.exec('DELETE FROM traffic_minute; DELETE FROM shopping_minute');
  for(const kind of ['traffic','shopping']){
   const unavailable=await report(kind,'from=2026-11-01&to=2026-11-01&timeZone=America/New_York');assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.totals.events,null);assert.equal(unavailable.window.preciseFrom,null);assert.deepEqual(unavailable.completedDays,[]);
   const utc=await report(kind,'from=2026-11-01&to=2026-11-01');assert.equal(utc.totals.events,4);assert.equal(utc.window.aggregation,'utc_daily');
  }
  clear();coverage(Date.parse('2026-11-01T12:00:00Z'));countAt(Date.parse('2026-11-01T13:00:00Z'),4);countAt(Date.parse('2026-11-02T06:00:00Z'),6);
  for(const kind of ['traffic','shopping']){
   const value=await report(kind,'from=2026-11-01&to=2026-11-03&timeZone=America/New_York');assert.equal(value.totals.events,6);assert.deepEqual(value.completedDays.map(d=>d.date),['2026-11-02','2026-11-03']);assert.equal(value.completedDays[1].events,0);assert.equal(value.activationDayPartial.events,4);assert.equal(value.activationDayPartial.date,'2026-11-01');
   const before=await report(kind,'from=2026-10-29&to=2026-10-30&timeZone=America/New_York');assert.equal(before.totals.events,null);assert.deepEqual(before.completedDays,[]);
  }
  // A UTC retention cut through a local date never becomes a fully covered zero day.
  clear();coverage(Date.parse('2026-01-01T00:00:00Z'));const retention=Math.floor(now/86400000)*86400000-89*86400000;
  for(const kind of ['traffic','shopping']){const value=await report(kind,'days=90&timeZone=America/New_York');assert(value.completedDays.every(d=>reportDayBoundaries(calendarReportWindow(null,now,{from:d.date,to:d.date,timeZone:'America/New_York'},{defaultDays:30,allowedDays:[7,30,90]}))[0].start>=retention));assert.equal(value.activationDayPartial.date,reportDate(retention,'America/New_York'));assert.equal(value.window.retainedFrom,reportDate(retention));}
  // Local date cap flags refer to contributing UTC dates; they do not impose a new local cap.
  clear();coverage(Date.parse('2026-10-30T00:00:00Z'));countAt(Date.parse('2026-11-01T20:00:00Z'),50000);countAt(Date.parse('2026-11-02T01:00:00Z'),50000);
  for(const kind of ['traffic','shopping']){const value=await report(kind,'from=2026-11-01&to=2026-11-01&timeZone=America/New_York');assert.equal(value.totals.events,100000);assert(value.completedDays[0].capReached);assert.deepEqual(value.cap.daysReached,['2026-11-01','2026-11-02']);}
  for(const query of ['days=3','days=7&days=30','days=7&from=2026-11-01&to=2026-11-02','from=2026-11-01','from=2026-11-05&to=2026-11-05','timeZone=Wrong/Zone','timeZone=UTC&timeZone=UTC','email=PRIVATE'])for(const fn of [trafficReport,shoppingReport]){const before=reads;assert.equal((await fn(request(query),deps)).status,400,query);assert.equal(reads,before);}
  for(const fn of [trafficReport,shoppingReport]){const before=reads;assert.equal((await fn(request('timeZone=invalid'),{...deps,requireAdmin:async()=>{throw Error('unauthorized')}})).status,403);assert.equal(reads,before);}
  assert(queries.every(query=>query.values.length<100));assert(!JSON.stringify(queries).includes('PRIVATE'));
  console.log('PASS: traffic/shopping DST, fractional offsets, inclusive/exclusive custom dates, UTC legacy history, unavailable minute history, partial coverage, retention, UTC caps, authorization and privacy.');
 }finally{global.fetch=realFetch;DB.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
