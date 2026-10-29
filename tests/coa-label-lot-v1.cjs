/* Owner rule, Oct 14 2026: a COA goes out only for the lot printed on the customer's vial.
   Real modules, synthetic report fixtures; no database, mail or network. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
const root = path.resolve(__dirname, '..');
const delivery = require('../lib/coa-delivery.ts');
const registry = require('./fixtures/coa-originals-v1.cjs');

// Lots are read the way customers type them off a label.
for (const typed of ['102-30-0001', ' lot: 102-30-0001 ', 'LOT 102 30 0001', 'Lot #102–30–0001', '102_30_0001', 'lot no. 102-30-0001']) assert.equal(delivery.normalizeLot(typed), '102-30-0001', typed);
for (const bad of ['', '  ', 'lot:', '<b>102</b>', '102/30/0001', '102.30.0001', '102+30+0001', 'ABß001', '102\n30\n0001', 'x'.repeat(61), 12, null]) assert.equal(delivery.normalizeLot(bad), null, String(bad));
assert.equal(delivery.labelLotOf({ labelLot: 'lot: 102-30-0001' }), '102-30-0001');
assert.equal(delivery.labelLotOf({ subject: 'COA request: HEAT-R 20mg / 102-20-0001' }), null, 'A subject line is never treated as the vial lot');

// The case that went wrong: the vial says 102-30-0001, the report was 102-20-0001.
assert.match(delivery.labelLotMismatch('102-30-0001', '102-20-0001'), /vial says lot 102-30-0001, but this report is for lot 102-20-0001/);
assert.equal(delivery.labelLotMismatch('102-30-0001', '102-30-0001'), null);
assert.equal(delivery.labelLotMismatch('102-30-0001', ' 102-30-0001 '), null);
assert.equal(delivery.labelLotMismatch(null, '102-20-0001'), null, 'No vial lot given: the other guards decide');
for (const typed of ['102300001', '102 30 0001', '102-300001', ' lot: 102300001 ', '102_30_0001']) {
  assert.equal(delivery.lotComparisonKey(typed), '102300001', typed);
  assert.equal(delivery.labelLotMismatch(typed, '102-30-0001'), null, typed);
}
for (const wrong of ['1023000001', '10230001', '0102300001', '1O2300001', '10230000I', '102/30/0001']) assert(delivery.labelLotMismatch(wrong, '102-30-0001'), wrong);
assert.equal(delivery.lotComparisonKey('AB-001'), 'AB001');
assert.notEqual(delivery.lotComparisonKey('AB-001'), delivery.lotComparisonKey('AB-01'), 'Leading zeroes are part of the lot');
assert.equal(delivery.lotComparisonKey('LOTABC'), 'LOTABC', 'Do not strip letters from a lot that merely starts with LOT');
for (const labelLot of ['102/30/0001', '<b>102</b>', 123, '   ']) assert(delivery.hasInvalidLabelLot({labelLot}));
for (const data of [{}, {labelLot:null}, {labelLot:''}, {labelLot:'102300001'}]) assert.equal(delivery.hasInvalidLabelLot(data), false);

// The vial lot picks the report, whatever product page the customer asked from.
const heatR30 = registry.reports.find(r => r.lot === '102-30-0001');
for (const typed of ['102-30-0001', '102300001', '102 30 0001']) {
  assert.equal(delivery.reportForLabelLot(typed, registry.reports)?.sha256, heatR30.sha256);
  assert.equal(delivery.exactCoaReport('COA request: HEAT-R 30mg / '+typed, registry.reports)?.sha256, heatR30.sha256);
}
for (const wrong of ['1023000001', '10230001', '0102300001', '1O2300001', '102/30/0001']) assert.equal(delivery.reportForLabelLot(wrong, registry.reports), null, wrong);
assert.equal(delivery.reportForLabelLot('999-20-0001', registry.reports), null, 'Unknown lots are never guessed');
const twins = [...registry.reports, { ...heatR30, sha256: 'f'.repeat(64) }];
assert.equal(delivery.reportForLabelLot('102-30-0001', twins), null, 'Two reports for one lot need a person');
for (const lot of ['102300001', '102 30 0001']) {
  const collision = [...registry.reports, {...heatR30, lot, sha256:'f'.repeat(64)}];
  assert.equal(delivery.reportForLabelLot('102-30-0001', collision), null, 'Separator-equivalent duplicate reports require review');
  assert.equal(delivery.exactCoaReport('COA request: HEAT-R 30mg / 102-30-0001', collision), null);
}

// Every place that picks a COA applies the rule.
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const outbox = read('lib/coa-outbox.ts');
assert.match(outbox, /const labelLot=labelLotOf\(data\);/);
assert.match(outbox, /labelLot\?reportForLabelLot\(labelLot,originals,associations\):exactCoaReport\(data\.subject/);
const desk = read('lib/request-replies.ts');
assert.match(desk, /labelLot=labelLotOf\(parse\(request\.data\)\)/);
assert.match(desk, /const wrongLot=report\?labelLotMismatch\(labelLot,report\.lot\):null;if\(wrongLot\)return \{coa:\{state:'needs_review'/);
assert(desk.indexOf('const wrongLot=') < desk.indexOf('readCoaOriginal(env.DB,report)'), 'The lot check runs before any original is read or attached');
const link = read('lib/coa-link.ts');
assert.match(link, /if \(!lot\) throw new CoaLinkError\('Enter the lot number printed on your vial/);
assert.match(link, /if \(!report\) return queueLotReview\(/);
const route = read('app/api/store/[action]/route.ts');
assert.match(route, /const labelLot = normalizeLot\(b\.labelLot\);/);
const form = read('components/store/batch-record.tsx');
assert.match(form, /Lot on your vial<input id=\{'coa-lot-'/);
assert(!/Documentation: '\+r\.product_name\+\(r\.product_lot/.test(form), 'Contact links never pre-fill the page lot as if it were the customer\'s');
console.log('PASS: separator-only vial lot matching, extra/missing digits and invalid characters refused, ambiguous reports blocked, vial lot parsing, mismatch refusal, report chosen by vial lot (unknown and duplicate lots go to a person), and the rule wired into Request by email, contact form, COA automation and the reply desk');


// Public private-link flow on isolated SQLite, with a mocked provider and original PDF verification.
(async () => {
 const {DatabaseSync}=require('node:sqlite'), linkApi=require('../lib/coa-link.ts'), {randomUUID}=require('node:crypto');
 const sql=new DatabaseSync(':memory:');
 try {
  for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sql.exec(read('drizzle/'+name));
  for(const report of registry.reports)sql.prepare('INSERT INTO coa_original_reports(sha256,data,enabled) VALUES(?,?,1)').run(report.sha256,JSON.stringify(report));
  const db={prepare(query){const st=(values=[])=>({bind:(...next)=>st(next),first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)}),run:async()=>({meta:sql.prepare(query).run(...values)})});return st();}};
  const env={DB:db,RESEND_API_KEY:'isolated-fixture',ORDER_EMAIL_FROM:'Fixture <sender@example.invalid>'}, sends=[];
  const deps={uuid:randomUUID,fetch:async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');sends.push(JSON.parse(init.body));return new Response('{}',{status:200});}};
  let index=0;
  for(const lot of ['102300001','102 30 0001','102-30-0001']) {
   const result=await linkApi.sendCoaLink(env,{productId:1389,email:`format-${++index}@example.invalid`,lot},deps);
   assert.equal(result.review,false);assert.equal(result.lot,'102-30-0001');assert.equal(result.otherProduct,true);
   const token=/\/api\/coa-file\/([^\s]+)/.exec(sends.at(-1).text)[1];
   const opened=await linkApi.openCoaLink(env,token);
   assert.equal(await delivery.coaHash(opened.bytes),heatR30.sha256);
   assert.equal(opened.filename,heatR30.filename);
  }
  const count=sends.length;
  for(const lot of ['1023000001','10230001','0102300001','1O2300001']) {
   const result=await linkApi.sendCoaLink(env,{productId:745,email:`wrong-${++index}@example.invalid`,lot},deps);
   assert.equal(result.review,true);assert.equal(sends.length,count,'No extra/missing digit or letter lookalike sends');
  }
  for(const lot of ['102/30/0001','102.30.0001','<b>102300001</b>'])await assert.rejects(()=>linkApi.sendCoaLink(env,{productId:745,email:'invalid@example.invalid',lot},deps),e=>e.status===400);
  assert.equal(sends.length,count);
  sql.prepare('INSERT INTO coa_original_reports(sha256,data,enabled) VALUES(?,?,1)').run('f'.repeat(64),JSON.stringify({...heatR30,lot:'102300001',sha256:'f'.repeat(64)}));
  const lookup=await linkApi.coaForLabelLot(db,1389,'102300001');assert.equal(lookup.report,null,'Formatting collision never chooses the current report first');
  assert.equal((await linkApi.sendCoaLink(env,{productId:1389,email:'ambiguous@example.invalid',lot:'102300001'},deps)).review,true);
  assert.equal(sends.length,count,'Ambiguous lot sends nothing');
  // Persisted report selection is authoritative; a default fallback was not enough above.
  sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=json_set(product_overrides.data,\'$.batch\',json_extract(excluded.data,\'$.batch\'))').run(heatR30.productId,JSON.stringify({batch:{lot:heatR30.lot,reportRef:'private:'+heatR30.sha256,coaAvailable:true}}));
  const resolved=await linkApi.coaForLabelLot(db,1389,'102300001');assert.equal(resolved.report.sha256,heatR30.sha256);
  assert.equal((await linkApi.sendCoaLink(env,{productId:1389,email:'resolved@example.invalid',lot:'102300001'},deps)).review,false);assert.equal(sends.length,count+1);
  const second=registry.reports.find(r=>r.productId===1389);sql.prepare('UPDATE coa_original_reports SET data=? WHERE sha256=?').run(JSON.stringify({...second,lot:'102300001'}),second.sha256);
  sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(second.productId,JSON.stringify({batch:{lot:'102300001',reportRef:'private:'+second.sha256,coaAvailable:true}}));
  assert.equal((await linkApi.coaForLabelLot(db,1389,'102300001')).report,null,'Two persisted authoritative candidates remain ambiguous');
  await assert.rejects(()=>linkApi.sendCoaLink(env,{productId:1389,email:'still-ambiguous@example.invalid',lot:'102300001'},deps),e=>e.status===404);assert.equal(sends.length,count+1);


  console.log('PASS: public COA link lookup accepts separator-only variants, serves the verified original, and sends nothing for wrong, malformed or ambiguous lots (mocked provider only)');
 } finally {sql.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
