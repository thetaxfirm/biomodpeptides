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
for (const bad of ['', '  ', 'lot:', '<b>102</b>', 'x'.repeat(61), 12, null]) assert.equal(delivery.normalizeLot(bad), null, String(bad));
assert.equal(delivery.labelLotOf({ labelLot: 'lot: 102-30-0001' }), '102-30-0001');
assert.equal(delivery.labelLotOf({ subject: 'COA request: HEAT-R 20mg / 102-20-0001' }), null, 'A subject line is never treated as the vial lot');

// The case that went wrong: the vial says 102-30-0001, the report was 102-20-0001.
assert.match(delivery.labelLotMismatch('102-30-0001', '102-20-0001'), /vial says lot 102-30-0001, but this report is for lot 102-20-0001/);
assert.equal(delivery.labelLotMismatch('102-30-0001', '102-30-0001'), null);
assert.equal(delivery.labelLotMismatch('102-30-0001', ' 102-30-0001 '), null);
assert.equal(delivery.labelLotMismatch(null, '102-20-0001'), null, 'No vial lot given: the other guards decide');

// The vial lot picks the report, whatever product page the customer asked from.
const heatR30 = registry.reports.find(r => r.lot === '102-30-0001');
assert.equal(delivery.reportForLabelLot('102-30-0001', registry.reports)?.sha256, heatR30.sha256);
assert.equal(delivery.reportForLabelLot('999-20-0001', registry.reports), null, 'Unknown lots are never guessed');
const twins = [...registry.reports, { ...heatR30, sha256: 'f'.repeat(64) }];
assert.equal(delivery.reportForLabelLot('102-30-0001', twins), null, 'Two reports for one lot need a person');

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
console.log('PASS: vial lot parsing, mismatch refusal, report chosen by vial lot (unknown and duplicate lots go to a person), and the rule wired into Request by email, contact form, COA automation and the reply desk');
