/* The "never ship without a COA" rule (Oct 13, 2026) was removed by the owner on Oct 14, 2026. Nothing is held for a missing COA. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, f);
const shipping = require(path.join(__dirname, '../lib/coa-shipping.ts'));
const noCoa = { id: 784, name: 'Lipo-C w/B12', resolvedBatch: { coa_available: false, product_lot: '706-10-0001' } };
const bare = { id: 5, name: 'No record' };
assert.equal(shipping.COA_REQUIRED_TO_SHIP, false);
assert.deepEqual(shipping.coaBlockedItems([{ id: 784 }, { id: 5 }, { id: 999 }], [noCoa, bare]), [], 'No product is held for a missing COA');
assert.deepEqual(shipping.noCoaProducts([noCoa, bare], [{ items: [{ id: 784 }] }]), [], 'No "cannot ship" list');
console.log('PASS: no-COA shipping rule is off: products without a COA ship, and admin shows no blocked list.');
