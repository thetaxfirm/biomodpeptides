// Real Worker/D1 batch semantics against bundled source, with isolated synthetic aggregates only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { migrationStatements } from './sql-migration-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const now=Date.parse('2026-11-05T12:00:00Z'),day='2026-11-05';
const bundled=await build({stdin:{contents:`import {recordTraffic,recordShopping,trafficReport,shoppingReport} from './lib/traffic-metrics-server';
export default {async fetch(request,env){const url=new URL(request.url);try{
 if(url.pathname==='/record'){const accepted=url.searchParams.get('kind')==='shopping'?await recordShopping(env.DB,{event:'cart_view'},${now}):await recordTraffic(env.DB,{event:'page_view',pageGroup:'home',sourceGroup:'search'},${now});return Response.json({accepted})}
 const deps={requireAdmin:async()=>{},env:()=>({TRAFFIC_MEASUREMENT_ENABLED:'true',TRAFFIC_MEASUREMENT_STARTED_AT:'2026-01-01T00:00:00Z',SHOPPING_MEASUREMENT_ENABLED:'true',SHOPPING_MEASUREMENT_STARTED_AT:'2026-01-01T00:00:00Z'}),database:()=>env.DB,now:()=>${now}};
 return url.pathname==='/shopping'?shoppingReport(request,deps):trafficReport(request,deps);
 }catch{return new Response('Synthetic storage failure',{status:503})}}};`,resolveDir:root,sourcefile:'isolated-metrics-worker.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
let outbound=0;
const mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-01',d1Databases:{DB:'isolated-calendar-counts'},cf:false,outboundService:()=>{outbound++;throw Error('Outbound forbidden')},log:new Log(LogLevel.ERROR)});
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for(const file of ['0014_aggregate_traffic.sql','0015_aggregate_shopping.sql','0045_report_window_aggregates.sql'])await db.batch(migrationStatements(await fs.readFile(path.join(root,'drizzle',file),'utf8')).map(sql=>db.prepare(sql)));
 for(const kind of ['traffic','shopping']){
  const cols=kind==='traffic'?"'home','search'":"'cart_view'";
  await db.prepare(`INSERT INTO ${kind}_daily VALUES(?,${cols},49998)`).bind(day).run();
  const responses=await Promise.all(Array.from({length:12},()=>mf.dispatchFetch('http://localhost/record?kind='+kind)));
  assert(responses.every(r=>r.status===200));const accepted=await Promise.all(responses.map(r=>r.json()));assert.equal(accepted.filter(x=>x.accepted).length,2,'Only two events fit the cap');
  assert.equal((await db.prepare(`SELECT SUM(event_count) n FROM ${kind}_daily`).first()).n,50000);
  assert.equal((await db.prepare(`SELECT SUM(event_count) n FROM ${kind}_minute`).first()).n,2,'Rejected D1 changes() does not leak into minute increments');
  assert.equal((await db.prepare('SELECT started_at FROM metrics_time_coverage WHERE kind=?').bind(kind).first()).started_at,now);
 }
 await db.batch(['DELETE FROM traffic_daily','DELETE FROM traffic_minute',"DELETE FROM metrics_time_coverage WHERE kind='traffic'"].map(sql=>db.prepare(sql)));
 await db.prepare("CREATE TRIGGER minute_failure BEFORE INSERT ON traffic_minute BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
 assert.equal((await mf.dispatchFetch('http://localhost/record?kind=traffic')).status,503);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM traffic_daily').first()).n,0,'Minute failure rolls back daily insert');
 assert.equal(await db.prepare("SELECT * FROM metrics_time_coverage WHERE kind='traffic'").first(),null);
 await db.prepare('DROP TRIGGER minute_failure').run();
 const start=Date.parse('2026-11-01T04:00:00Z'),end=Date.parse('2026-11-02T05:00:00Z');
 await db.batch([
  db.prepare("INSERT INTO metrics_time_coverage VALUES('traffic',?)").bind(start-86400000),
  db.prepare("INSERT INTO traffic_daily VALUES('2026-11-01','home','search',3)"),db.prepare("INSERT INTO traffic_daily VALUES('2026-11-02','home','search',7)"),
  db.prepare("INSERT INTO traffic_minute VALUES(?,'home','search',3)").bind(start),db.prepare("INSERT INTO traffic_minute VALUES(?,'home','search',7)").bind(end),
 ]);
 const response=await mf.dispatchFetch('http://localhost/traffic?from=2026-11-01&to=2026-11-01&timeZone=America/New_York');assert.equal(response.status,200);const report=await response.json();assert.equal(report.totals.events,3);assert.equal(report.window.endInstant-report.window.startInstant,25*3600000);assert.equal(report.window.endInstant,end);assert.equal(report.completedDays[0].date,'2026-11-01');assert.equal(outbound,0);
 console.log('PASS: real Worker/D1 concurrent cap, changes() acceptance chain, transactional rollback, independent coverage and DST JSON interval query; no outbound services.');
}finally{await mf.dispose()}
