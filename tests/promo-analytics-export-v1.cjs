/* Aggregate fixtures only. No database, credentials, network or real customer records. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
const {promoAnalyticsExport}=require('../lib/promo-analytics-export.ts');
const secret='FIXTURE_PRIVATE_DATA_MUST_NOT_EXPORT';
const zero=environment=>({environment,orders:0,paymentRecorded:0,grossCents:0,discountCents:0,missingPaymentRecords:0,missingAmountRecords:0,missingDiscountRecords:0});
const report={asOf:Date.parse('2026-10-09T18:32:15.123Z'),window:{days:30,start:Date.parse('2026-09-10T00:00:00Z'),end:Date.parse('2026-10-09T18:32:15.124Z'),timeZone:'UTC',includesPartialToday:true},classification:'unclassified',codes:[
 {code:'BM10',percentOff:10,active:true,rows:[{...zero('live'),orders:5,paymentRecorded:3,grossCents:12000,discountCents:1200,missingPaymentRecords:1,missingAmountRecords:1,missingDiscountRecords:1,owner:secret,payment:{reference:secret}}, {...zero('sandbox'),orders:2,paymentRecorded:2,grossCents:99999999,discountCents:99999},zero('unknown')],customer:secret},
 {code:'BIOMOD10',percentOff:null,active:false,rows:[zero('live'),zero('sandbox'),zero('unknown')]},
],customer:secret};
function parseCsv(input){const rows=[],row=[];let field='',quoted=false;input=input.replace(/^\uFEFF/,'');for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(!quoted&&c===','){row.push(field);field='';}else if(!quoted&&c==='\r'&&input[i+1]==='\n'){row.push(field);rows.push([...row]);row.length=0;field='';i++;}else field+=c;}assert.equal(quoted,false);assert.equal(field,'');const header=rows.shift();assert(rows.every(row=>row.length===header.length));return rows.map(row=>Object.fromEntries(header.map((key,i)=>[key,row[i]])));}
const before=JSON.stringify(report);const file=promoAnalyticsExport(report);const rows=parseCsv(file.csv);const metadata=Object.fromEntries(rows.filter(r=>r.record_type==='metadata').map(r=>[r.metadata_key,r.metadata_value]));const data=rows.filter(r=>r.record_type==='promo_orders');
assert.equal(file.filename,'biomod-promo-analytics-20261009T183215123Z-v1.csv');assert(file.csv.startsWith('\uFEFF'));assert.equal(JSON.stringify(report),before);assert(!file.csv.includes(secret));assert.equal(data.length,6);assert.deepEqual(data.slice(0,3).map(r=>r.environment),['live','sandbox','unknown']);assert.equal(data[0].orders_started,'5');assert.equal(data[0].payment_recorded,'3');assert.equal(data[0].gross_cents,'12000');assert.equal(data[0].promo_discount_cents,'1200');assert.equal(data[0].missing_amount_records,'1');assert.equal(data[0].missing_payment_records,'1');assert.equal(data[0].missing_discount_records,'1');assert.equal(data[3].active,'false');assert.equal(data[3].percent_off,'');assert(rows.every(r=>r.classification==='unclassified'));
assert.equal(metadata.window_start_utc_inclusive,'2026-09-10T00:00:00.000Z');assert.equal(metadata.window_end_utc_exclusive,'2026-10-09T18:32:15.124Z');assert.equal(metadata.includes_partial_today,'true');assert.equal(metadata.time_zone,'UTC');assert.equal(metadata.currency,'USD');assert.match(metadata.measurement_scope,/Not cart applications, unique visitors, conversion rates or daily payment cohorts/);assert.match(metadata.environment_scope,/Live payments can include internal tests/);assert.match(metadata.gross_scope,/shipping and tax before refunds/);assert.match(metadata.gross_scope,/missing_amount_records/);assert.match(metadata.code_scope,/current code setting/);
const all=parseCsv(promoAnalyticsExport({...report,window:{...report.window,days:'all',start:0}}).csv);assert.equal(all.find(r=>r.metadata_key==='period_days').metadata_value,'all');assert.equal(all.find(r=>r.metadata_key==='window_start_utc_inclusive').metadata_value,'1970-01-01T00:00:00.000Z');
assert.equal(parseCsv(promoAnalyticsExport({...report,codes:[]}).csv).filter(r=>r.record_type==='promo_orders').length,0);
for(const code of ['=HYPERLINK("https://example.invalid","x")',' +1+1','-2+3','@SUM(1,2)','\t=1+1','\rabc','\nabc',' \t@SUM(1)']){const csv=promoAnalyticsExport({...report,codes:[{...report.codes[0],code}]}).csv;assert.equal(parseCsv(csv).find(r=>r.record_type==='promo_orders').code,"'"+code);}
const escaped='a "quote", comma\nand newline';assert.equal(parseCsv(promoAnalyticsExport({...report,codes:[{...report.codes[0],code:escaped}]}).csv).find(r=>r.record_type==='promo_orders').code,escaped);

const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const originalLoad=Module._load;let hookValues;const nativeTables={Table:'table',TableHeader:'thead',TableBody:'tbody',TableRow:'tr',TableHead:'th',TableCell:'td'};let apiImpl=()=>{throw Error('Unexpected network');};let currentHooks={...React,useState:()=>[hookValues.shift(),()=>{}],useEffect:()=>{}};
Module._load=function(name,parent,isMain){if(name==='react')return currentHooks;if(name==='@/lib/promo-analytics-export')return{promoAnalyticsExport};if(name==='@/lib/catalog')return{money:value=>'$'+(value/100).toFixed(2)};if(name==='./provider')return{api:(...args)=>apiImpl(...args)};if(name==='@/components/ui/table')return nativeTables;if(name.endsWith('.module.css'))return{};return originalLoad.call(this,name,parent,isMain);};
const {PromoAnalytics}=require('../components/store/promo-analytics.tsx');
const values=(r=report,environment='live',loading=false,error='')=>['30',environment,0,r,loading,error,''];
function render(state){hookValues=state;return renderToStaticMarkup(React.createElement(PromoAnalytics));}
function nodes(tree,out=[]){if(Array.isArray(tree)){tree.forEach(x=>nodes(x,out));return out;}if(tree&&typeof tree==='object'&&tree.props){out.push(tree);nodes(tree.props.children,out);}return out;}
const find=(tree,pred)=>{const node=nodes(tree).find(pred);assert(node,'node not found');return node;};
function button(tree,label){return find(tree,n=>n.type==='button'&&n.props.children===label);}
try{
 const html=render(values());assert(html.includes('Live orders'));assert(html.includes('BM10'));assert(html.includes('Inactive'));assert(html.includes('$120.00'));assert(!html.includes('$999999.99'));assert(html.includes('Today')||html.includes('today'));assert(html.includes('Not recorded'));assert(html.includes('Recorded gross excludes those amounts and may be incomplete.'));assert(html.includes('currently unclassified'));assert(html.includes('CSV includes all environments in separate rows.'));
 assert(render(values(report,'sandbox')).includes('$999999.99'));assert(!render(values(report,'sandbox')).includes('$120.00'));
 const loading=render(values(report,'live',true));assert(!loading.includes('<table'));assert(!loading.includes('BM10'));
 const failed=render(values(report,'live',false,'Cannot load report'));assert(!failed.includes('<table'));assert(failed.includes('role="alert"'));hookValues=values(report,'live',false,'Cannot load report');assert.equal(button(PromoAnalytics(),'Download CSV').props.disabled,true);
 const missing={...report,codes:[{...report.codes[0],rows:[{...zero('live'),orders:1,paymentRecorded:1,missingAmountRecords:1,missingDiscountRecords:1},zero('sandbox'),zero('unknown')]}]};const incomplete=render(values(missing));assert((incomplete.match(/Not recorded/g)||[]).length===2);assert(!incomplete.includes('$0.00'));
 const allHtml=render(['all','live',0,{...report,window:{...report.window,days:'all',start:0}},false,'','']);assert(allHtml.includes('all available history'));assert(!allHtml.includes('1970-01-01'));
 const old={document:global.document,setTimeout:global.setTimeout,createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};let emitted,clicked=0,removed=0,revoked=0,scheduled;const anchor={href:'',download:'',click(){clicked++;},remove(){removed++;}};
 try{global.document={createElement:tag=>{assert.equal(tag,'a');return anchor;},body:{appendChild:link=>assert.equal(link,anchor)}};global.setTimeout=(fn,delay)=>{assert.equal(delay,1000);scheduled=fn;return 1;};URL.createObjectURL=blob=>{emitted=blob;return'blob:fixture';};URL.revokeObjectURL=url=>{assert.equal(url,'blob:fixture');revoked++;};hookValues=values();button(PromoAnalytics(),'Download CSV').props.onClick();assert.equal(clicked,1);assert.equal(removed,1);assert.equal(anchor.download,file.filename);assert.equal(emitted.type,'text/csv;charset=utf-8');scheduled();assert.equal(revoked,1);}finally{global.document=old.document;global.setTimeout=old.setTimeout;URL.createObjectURL=old.createObjectURL;URL.revokeObjectURL=old.revokeObjectURL;}
}finally{Module._load=originalLoad;}
console.log('PASS: aggregate-only CSV with exact cents/window/env/missing-record scope, private-field exclusion, formula escaping and download cleanup; UI hides stale/error data, separates environments and avoids zero for wholly missing paid amounts.');

// Exercise the actual effect cleanup and period controls against deferred local responses.
(async()=>{
 let host;
 Object.assign(currentHooks,{
  useState(initial){const i=host.cursor++;if(!(i in host.slots))host.slots[i]=initial;return[host.slots[i],value=>{const next=typeof value==='function'?value(host.slots[i]):value;if(!Object.is(next,host.slots[i])){host.slots[i]=next;host.dirty=true;}}];},
  useEffect(fn,deps){const i=host.cursor++;const previous=host.slots[i];if(!previous||deps.some((value,index)=>!Object.is(previous.deps[index],value))){previous?.cleanup?.();const entry={deps};host.slots[i]=entry;host.effects.push(()=>entry.cleanup=fn());}},
 });
 const pending=[];apiImpl=action=>new Promise((resolve,reject)=>pending.push({action,resolve,reject}));
 host={slots:[],cursor:0,effects:[],tree:null,dirty:false,render(){for(let n=0;n<20;n++){this.cursor=0;this.effects=[];this.dirty=false;this.tree=PromoAnalytics();for(const effect of this.effects)effect();if(!this.dirty)return;}throw Error('Render loop');}};
 host.render();assert.equal(pending[0].action,'admin-promos?days=30');assert.equal(button(host.tree,'Download CSV').props.disabled,true);
 pending[0].resolve(report);await new Promise(setImmediate);host.render();assert.equal(button(host.tree,'Download CSV').props.disabled,false);
 button(host.tree,'Refresh totals').props.onClick();host.render();assert.equal(button(host.tree,'Download CSV').props.disabled,true);assert(!nodes(host.tree).some(node=>node.type==='table'));
 find(host.tree,node=>node.type==='select'&&node.props.value==='30').props.onChange({target:{value:'7'}});host.render();assert.equal(pending[2].action,'admin-promos?days=7');
 pending[1].resolve(report);await new Promise(setImmediate);host.render();assert.equal(button(host.tree,'Download CSV').props.disabled,true,'late old-period report cannot re-enable CSV');assert(!nodes(host.tree).some(node=>node.type==='table'));
 pending[2].reject(Error('offline'));await new Promise(setImmediate);host.render();assert.equal(button(host.tree,'Download CSV').props.disabled,true);assert(nodes(host.tree).some(node=>node.props.role==='alert'));assert(!nodes(host.tree).some(node=>node.type==='table'));
 button(host.tree,'Refresh totals').props.onClick();host.render();pending[3].resolve({...report,window:{...report.window,days:7}});await new Promise(setImmediate);host.render();assert.equal(button(host.tree,'Download CSV').props.disabled,false);assert(nodes(host.tree).some(node=>node.type==='table'));
 console.log('PASS: actual request effect clears stale reports on refresh/period changes, ignores late responses, exposes load failures without false zeros, and recovers on retry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
