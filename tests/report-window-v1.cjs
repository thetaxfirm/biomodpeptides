// Calendar boundaries only. No database, network, live settings or local timezone dependence.
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const file=require('node:path').resolve(__dirname,'../lib/report-window.ts'),m=new Module(file,module);
m.filename=file;m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,file);
const {calendarReportWindow,reportDayBoundaries,reportDayStart,reportOptionsFromParams,reportTimeZone,ReportWindowError}=m.exports;
const now=Date.parse('2026-11-27T01:30:00Z'),policy={defaultDays:7,allowedDays:[7,30,90],allowAll:true};
const window=(from,to,timeZone='UTC')=>calendarReportWindow(null,now,{from,to,timeZone},policy);
assert.deepEqual(calendarReportWindow(null,now,{},policy),{days:7,start:Date.parse('2026-11-20T00:00:00Z'),end:Date.parse('2026-11-27T00:00:00Z'),timeZone:'UTC'});
const la=calendarReportWindow('7',now,{timeZone:'America/Los_Angeles'},policy);
assert.equal(la.end,Date.parse('2026-11-26T08:00:00Z'),'Complete dates use the reporting timezone, not server UTC today');
assert.equal(la.start,Date.parse('2026-11-19T08:00:00Z'));
for(const [date,zone,start,end] of [
 ['2026-03-08','America/New_York','2026-03-08T05:00:00Z','2026-03-09T04:00:00Z'],
 ['2026-11-01','America/New_York','2026-11-01T04:00:00Z','2026-11-02T05:00:00Z'],
 ['2026-10-04','Australia/Lord_Howe','2026-10-03T13:30:00Z','2026-10-04T13:00:00Z'],
 ['2026-01-05','Asia/Kathmandu','2026-01-04T18:15:00Z','2026-01-05T18:15:00Z'],
 ['2018-11-04','America/Sao_Paulo','2018-11-04T03:00:00Z','2018-11-05T02:00:00Z'],
 ['2011-12-29','Pacific/Apia','2011-12-29T10:00:00Z','2011-12-30T10:00:00Z'],
]){
 const w=window(date,date,zone);assert.equal(w.start,Date.parse(start),zone+' start');assert.equal(w.end,Date.parse(end),zone+' exclusive end');
 assert.deepEqual(reportDayBoundaries(w),[{date,start:w.start,end:w.end}]);
 assert(w.start<w.end,'Inclusive single calendar date is a nonempty interval');
}
const dst=window('2026-03-07','2026-03-09','America/New_York'),days=reportDayBoundaries(dst);
assert.deepEqual(days.map(d=>(d.end-d.start)/3600000),[24,23,24]);
assert(days.every((d,i)=>!i||days[i-1].end===d.start),'Daily intervals join without gaps or double counts');
assert.deepEqual(reportDayBoundaries(window('2011-12-29','2011-12-31','Pacific/Apia')).map(d=>d.date),['2011-12-29','2011-12-31']);
for(const options of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-01-01'},{to:'2026-01-01'},{from:'',to:''},{from:'2026-05-02',to:'2026-05-01'},{from:'2024-01-01',to:'2026-01-01'},{from:'2026-11-27',to:'2026-11-27'},{from:'2026-11-26',to:'2026-11-26',timeZone:'America/Los_Angeles'},{from:'2011-12-30',to:'2011-12-30',timeZone:'Pacific/Apia'}])assert.throws(()=>calendarReportWindow(null,now,options,policy),e=>e instanceof ReportWindowError&&e.status===400);
for(const zone of ['','Not/AZone','UTC;DROP TABLE orders','+03:00','America/New_York '])assert.throws(()=>reportTimeZone(zone),ReportWindowError);
for(const params of ['from=a&from=b','days=7&days=30','timeZone=UTC&timeZone=Europe/London','complete=true&complete=false'])assert.throws(()=>reportOptionsFromParams(new URLSearchParams(params)),ReportWindowError);
assert.throws(()=>calendarReportWindow('7',now,{from:'2026-01-01',to:'2026-01-02'},policy),/preset period or custom/);
for(const clock of [NaN,Infinity,-1,0.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>calendarReportWindow(null,clock,{},policy),/time/);
assert.equal(calendarReportWindow('all',now,{},policy).start,0);
assert.equal(reportDayStart('2026-01-01','UTC'),Date.parse('2026-01-01T00:00:00Z'));
console.log('PASS: UTC compatibility, inclusive custom dates, DST gaps/folds, half-hour and quarter-hour zones, midnight DST, skipped dates, bounded ranges and invalid/duplicate query rejection.');
