/* Owner rule: never mail out a product without a COA for the lot being sold. Pure functions, synthetic products. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, f);
const { coaBlockedItems, noCoaProducts, coaBlockMessage, hasCoa } = require(path.join(__dirname, '../lib/coa-shipping.ts'));
const heat = { id: 1389, name: 'HEAT-R 20mg', resolvedBatch: { coa_available: true, product_lot: '102-20-0001' } };
const lipo = { id: 784, name: 'Lipo-C w/B12', resolvedBatch: { coa_available: false, product_lot: '706-10-0001' } };
const spray = { id: 770, name: 'APEX', resolvedBatch: { coa_available: false, product_lot: null } };
const bare = { id: 5, name: 'No record' };
const products = [heat, lipo, spray, bare];
assert.equal(hasCoa(heat), true); assert.equal(hasCoa(lipo), false); assert.equal(hasCoa(bare), false, 'No COA record is never treated as cleared'); assert.equal(hasCoa(undefined), false);
assert.deepEqual(coaBlockedItems([{ id: 1389, quantity: 2 }], products), [], 'HEAT with its COA ships');
assert.deepEqual(coaBlockedItems([{ id: 1389 }, { id: 784 }, { id: 784 }, { product: { id: 770 } }], products), ['Lipo-C w/B12', 'APEX'], 'Each missing product named once');
assert.deepEqual(coaBlockedItems([{ id: 999, product: { name: 'Removed product' } }], products), ['Removed product'], 'An unknown product is held, not shipped');
assert.deepEqual(coaBlockedItems(null, products), []);
const list = noCoaProducts(products, [{ items: [{ id: 784 }] }, { items: [{ id: 784 }, { id: 1389 }] }, { items: [{ id: 770 }] }]);
assert.deepEqual(list.map(p => [p.name, p.lot, p.waitingOrders]), [['Lipo-C w/B12', '706-10-0001', 2], ['APEX', null, 1], ['No record', null, 0]]);
assert(!list.some(p => p.id === 1389), 'Products with a COA are not listed');
// Clearing: once the COA is attached the same order ships.
assert.deepEqual(coaBlockedItems([{ id: 784 }], [{ ...lipo, resolvedBatch: { coa_available: true } }]), []);
assert.match(coaBlockMessage(['APEX']), /Do not ship yet: no COA on file for APEX/);
// Every path that mails an order enforces the rule.
const route = fs.readFileSync(path.join(__dirname, '../app/api/store/[action]/route.ts'), 'utf8');
const label = fs.readFileSync(path.join(__dirname, '../app/api/admin/shipping/route.ts'), 'utf8');
assert(/coaBlocked = coaBlockedItems[\s\S]{0,200}No label was bought[\s\S]*record\('shipping.label_purchase', 'attempted'/.test(label), 'Label purchase checks COA before any provider call');
assert(/status === 'shipped' && o.status === 'paid'[\s\S]{0,400}coaBlockedItems[\s\S]{0,300}coaBlockMessage/.test(route), 'Mark shipped checks COA');
assert(/noCoa: noCoaProducts\(products, waiting\)/.test(route), 'Orders queue lists products that cannot ship');
console.log('PASS: no-COA shipping rule: HEAT with COA ships, missing/unknown COA held and named once, admin list with waiting counts, clears when attached, label purchase and mark-shipped both enforce it.');
