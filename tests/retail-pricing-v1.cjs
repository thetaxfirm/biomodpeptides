const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
const { products } = require('../lib/catalog.ts');
const { fixedPackPrice } = require('../lib/packs.ts');
const source = require('../lib/catalog-facts-v2.json');
const competitive = require('../lib/competitive-pricing-v3.json');
const retail = require('../lib/retail-pricing-v1.json');

const approved = [
  { slug: 'c-heat-s-10mg', id: 746, sku: 'BM-LYO-003', size: '10mg', prices: [4999, 13497, 21246, 39992] },
  { slug: '5-amino-1mq-50mg', id: 783, sku: 'BM-LYO-025', size: '50mg / vial', prices: [4999, 13497, 21246, 39992] },
  { slug: 'softgel-methylene-blue-usp', id: 779, sku: 'BM-SOF-005', size: '60 caps', prices: [10999, 29697, 46746, 87992] },
];
assert.deepEqual(Object.keys(retail).sort(), approved.map(p => p.slug).sort());
assert.equal(products.length, source.length, 'No product is added or removed by a price update');
for (const item of approved) {
  const p = products.find(p => p.slug === item.slug);
  const original = source.find(p => p.slug === item.slug);
  assert(p && original);
  assert.deepEqual([p.id, p.sku, p.sizes[0]], [item.id, item.sku, item.size], 'Match the exact listing');
  assert.deepEqual(Object.keys(retail[item.slug]).sort(), ['packPrices', 'price']);
  for (const key of ['regularPrice', 'currency', 'inStock', 'purchasable', 'stockQuantity', 'maxQuantity', 'sale']) {
    assert.deepEqual(p[key], original[key], item.slug + ': preserve ' + key);
  }
  [1, 3, 5, 10].forEach((count, i) => {
    assert.equal(fixedPackPrice(p, count), item.prices[i], item.slug + ': ' + count + '-pack total');
    const base = item.prices[0] * count;
    const discount = ({ 1: 0, 3: 10, 5: 15, 10: 20 })[count];
    assert.equal(fixedPackPrice(p, count), base - Math.round(base * discount / 100));
  });
}
for (const p of products.filter(p => !retail[p.slug])) {
  const original = source.find(s => s.slug === p.slug);
  const prior = { ...original, ...competitive[p.slug] };
  assert.deepEqual([p.price, p.packPrices], [prior.price, prior.packPrices], p.slug + ': keep unrelated prices');
}
assert.equal(competitive['5-amino-1mq-50mg'].price, 9000, 'The old competitive snapshot remains intact');
assert.equal(products.find(p => p.slug === '5-amino-1mq-50mg').price, 4999, 'Owner pricing wins over the old competitive price');
console.log('PASS: 3 exact owner prices, all 12 single/fixed-pack totals, historical competitive precedence, unchanged catalog membership, availability and unrelated prices');
