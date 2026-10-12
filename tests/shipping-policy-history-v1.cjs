// Actual public terms, historical-order projection and every real migration; isolated fixtures only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('Network forbidden');};
const {shippingTerms,shippingDispatchTerms}=require('../lib/shipping-terms.ts');
const {orderView,adminOrderView}=require('../lib/catalog-visibility.ts');
const {products}=require('../lib/catalog.ts');
const base={freeShippingAt:20000};
assert.equal(shippingTerms(null).freeThreshold,null);assert.doesNotMatch(shippingTerms(null).banner,/free /i);
assert.match(shippingTerms(base).standard,/\$200 or more after discounts and before tax/);
assert.match(shippingTerms(base).overnight,/quoted rate plus a \$10 handling fee/);
assert.match(shippingTerms({...base,freeShippingAt:24567}).standard,/\$245.67/);
assert.match(shippingTerms({...base,freeShippingAt:0}).standard,/Standard U.S. shipping is free/);
for(const shippingOptions of [{standardEnabled:false},{freeStandardEnabled:false}]){const terms=shippingTerms({...base,shippingOptions});assert.equal(terms.freeThreshold,null);assert.doesNotMatch(terms.banner,/free /i);assert.doesNotMatch(terms.standard,/free /i);}
assert.equal(shippingTerms({...base,shippingOptions:{overnightEnabled:false}}).overnight,null);
assert.match(shippingTerms({...base,shippingOptions:{overnightHandlingCents:1250}}).overnight,/\$12.50 handling fee/);
assert.match(shippingDispatchTerms,/after dispatch/);assert.match(shippingDispatchTerms,/does not speed up preorder/);assert.match(shippingDispatchTerms,/not guaranteed/);

const selected={id:'rate_fixture',tier:'overnight',shippingService:'UPS Next Day Air',shipping:3300,carrierCents:2300,handlingCents:1000,days:1,carrier:'UPS',carrierService:'NextDayAir',source:'easypost',free:false};
const saved={items:[{id:products[0].id,quantity:1,lineTotal:8500,product:{price:10000}}],subtotal:10000,discount:1500,shipping:3300,tax:712,total:12512,shippingService:selected.shippingService,shippingOption:{...selected,PRIVATE:'PRIVATE_FIELD'},shippingOptions:[{PRIVATE:'PRIVATE_UNSELECTED'}],paymentReference:'PRIVATE_PAYMENT'};
const before=JSON.stringify(saved);
for(const view of [orderView(saved),adminOrderView(saved)]){assert.equal(view.shipping,3300);assert.equal(view.total,12512);assert.equal(view.shippingService,selected.shippingService);assert.deepEqual(view.shippingOption,selected);assert.equal(view.shippingOptions,undefined);assert(!JSON.stringify(view).includes('PRIVATE_'));}
assert.equal(JSON.stringify(saved),before,'Order presentation never rewrites a purchase snapshot');
const historical=orderView({...saved,shippingOption:undefined});assert.equal(historical.shippingOption,undefined);assert.equal(historical.shipping,3300);assert.equal(historical.shippingService,selected.shippingService);
const invalid=orderView({...saved,shippingOption:{...selected,shipping:0,free:true}});assert.equal(invalid.shippingOption,undefined);assert.equal(invalid.shipping,3300,'Invalid breakdown cannot change the recorded ledger');

(async()=>{
const {migrationStatements}=await import('./sql-migration-fixture.mjs');
const db=new DatabaseSync(':memory:');
try{
 const root=path.resolve(__dirname,'..');
 const apply=file=>{for(const statement of migrationStatements(fs.readFileSync(path.join(root,'drizzle',file),'utf8')))db.exec(statement);};
 for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(f=>f.endsWith('.sql')&&f<'0022').sort())apply(file);
 const original={freeShippingAt:20000,shippingCents:500,packDiscounts:{3:10},shippingOptions:{standardEnabled:true,expeditedEnabled:true,overnightEnabled:true,freeStandardEnabled:true,standardHandlingCents:0,expeditedHandlingCents:0,overnightHandlingCents:1000,carriers:['USPS','UPS']},apiKey:'PRIVATE_SECRET'};
 db.prepare("INSERT INTO settings(key,value) VALUES('store',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(original));
 const existingSettings=JSON.stringify(db.prepare('SELECT * FROM settings ORDER BY key').all()),existingEvents=JSON.stringify(db.prepare('SELECT * FROM change_events ORDER BY rowid').all());
 apply('0022_shipping_settings_history.sql');
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM settings ORDER BY key').all()),existingSettings,'Migration changes no runtime setting');
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM change_events ORDER BY rowid').all()),existingEvents,'Migration preserves historical events exactly');
 const events=()=>db.prepare("SELECT * FROM change_events WHERE entity_id='store' ORDER BY rowid").all();
 const last=()=>{const e=events().at(-1);return{...e,changes:JSON.parse(e.changes)};};
 const updated={...original,shippingOptions:{...original.shippingOptions,standardEnabled:false,freeStandardEnabled:false,overnightHandlingCents:1200,carriers:['UPS','FedEx']}};
 db.exec('BEGIN');db.prepare('INSERT INTO change_context(id,actor,actor_type,source,action,summary) VALUES(1,?,?,?,?,?)').run('owner@example.invalid','staff','admin','settings.update','Store shipping changed');db.prepare("UPDATE settings SET value=? WHERE key='store'").run(JSON.stringify(updated));db.exec('DELETE FROM change_context; COMMIT');
 let e=last();assert.equal(e.actor,'owner@example.invalid');assert.equal(e.actor_type,'staff');assert.equal(e.source,'admin');assert.equal(e.action,'settings.update');
 assert.deepEqual(e.changes,[{field:'Standard shipping enabled',before:1,after:0},{field:'Free standard shipping enabled',before:1,after:0},{field:'Overnight handling (cents)',before:1000,after:1200},{field:'USPS enabled',before:1,after:0},{field:'FedEx enabled',before:0,after:1}]);
 const n=events().length;db.exec("UPDATE settings SET value=value WHERE key='store'");assert.equal(events().length,n,'No-op save adds no history');
 db.prepare("UPDATE settings SET value=? WHERE key='store'").run(JSON.stringify({...updated,shippingOptions:{...updated.shippingOptions,carriers:['PRIVATE_CARRIER'],overnightHandlingCents:'PRIVATE_FEE',standardEnabled:'PRIVATE_FLAG'},apiKey:'PRIVATE_CHANGED_SECRET'}));
 e=last();assert.equal(e.actor_type,'unknown');assert.equal(e.actor,'Unattributed database change');assert(e.changes.every(c=>c.after===null),'Invalid or private values are not copied');
 db.prepare("UPDATE settings SET value=? WHERE key='store'").run('PRIVATE_MALFORMED_JSON');assert(last().changes.every(c=>c.after===null));
 db.prepare("UPDATE settings SET value=? WHERE key='store'").run(JSON.stringify({private:'PRIVATE_VALUE'}));assert.deepEqual(last().changes,[{field:'Other stored fields',before:'Not copied',after:'Changed; private values are not recorded'}]);
 db.prepare("DELETE FROM settings WHERE key='store'").run();assert.equal(last().action,'setting.delete');
 db.prepare("INSERT INTO settings(key,value) VALUES('store',?)").run(JSON.stringify(updated));assert(last().changes.some(c=>c.field==='Overnight handling (cents)'&&c.before===null&&c.after===1200));
 assert(!JSON.stringify(db.prepare('SELECT * FROM change_events').all()).includes('PRIVATE_'),'No private setting or carrier value is captured');
 console.log('PASS: live shipping terms and disabling offers, selected-service historical snapshots, no migration data changes, attributed safe fee/carrier audit history, no-op suppression and private/malformed value exclusion. Isolated fixtures only.');
}finally{db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
