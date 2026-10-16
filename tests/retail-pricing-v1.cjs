/* Owner-approved retail pricing: every approved price is what the catalog actually charges, the
 * pack ladder is arithmetic rather than typed figures, and no unrelated product's price moves.
 * Driven from the price file the catalog imports, so approving another price never makes this stale. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
const { products } = require('../lib/catalog.ts');
const { fixedPackPrice } = require('../lib/packs.ts');
const source = require('../lib/catalog-facts-v2.json');
const competitive = require('../lib/competitive-pricing-v3.json');

// The same file lib/catalog.ts imports. Reading it from there means this suite can never drift onto
// a retired price list while the storefront charges from a newer one.
const imported = /from '\.\/(retail-pricing-v\d+\.json)'/.exec(fs.readFileSync(require.resolve('../lib/catalog.ts'), 'utf8'));
assert(imported, 'lib/catalog.ts must import a retail price file');
const retail = require('../lib/' + imported[1]);
assert(Object.keys(retail).length > 0, 'the approved price list is not empty');

assert.equal(products.length, source.length, 'No product is added or removed by a price update');

const ladder = { 1: 0, 3: 10, 5: 15, 10: 20 };
for (const [slug, approved] of Object.entries(retail)) {
  const p = products.find(p => p.slug === slug);
  assert(p, 'every approved price names a real product: ' + slug);
  assert.deepEqual(Object.keys(approved).sort(), ['packPrices', 'price'], slug + ': an approved entry sets exactly a price and its packs');
  // What the customer is charged is exactly what was approved.
  assert.equal(p.price, approved.price, slug + ': single price');
  assert.deepEqual(p.packPrices, approved.packPrices, slug + ': pack prices');
  // Availability and the listing itself are never changed by a price update.
  const original = source.find(s => s.slug === slug);
  assert(original, slug + ': still in the catalog facts');
  for (const key of ['regularPrice', 'currency', 'inStock', 'purchasable', 'stockQuantity', 'maxQuantity', 'sale']) {
    assert.deepEqual(p[key], original[key], slug + ': preserve ' + key);
  }
  // Every pack total is the single price times the count, less the standard discount.
  for (const count of [1, 3, 5, 10]) {
    const base = approved.price * count;
    assert.equal(fixedPackPrice(p, count), base - Math.round(base * ladder[count] / 100), slug + ': ' + count + '-pack total');
  }
}

// Anything the owner has not repriced keeps exactly the price it had before.
for (const p of products.filter(p => !retail[p.slug])) {
  const original = source.find(s => s.slug === p.slug);
  const prior = { ...original, ...competitive[p.slug] };
  assert.deepEqual([p.price, p.packPrices], [prior.price, prior.packPrices], p.slug + ': keep unrelated prices');
}
assert.equal(competitive['5-amino-1mq-50mg'].price, 9000, 'The old competitive snapshot remains intact');
assert.equal(products.find(p => p.slug === '5-amino-1mq-50mg').price, retail['5-amino-1mq-50mg'].price, 'Owner pricing wins over the old competitive price');
console.log('PASS: ' + Object.keys(retail).length + ' owner prices applied exactly, every single/fixed-pack total derived from the discount ladder, historical competitive precedence, unchanged catalog membership, availability and unrelated prices');
