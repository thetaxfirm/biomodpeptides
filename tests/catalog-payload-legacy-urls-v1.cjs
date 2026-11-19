/* Every page sends the storefront catalog to the browser as page data. The imported record's former-store
 * product address and image addresses must not ride along: they put old-domain URLs in the HTML of every
 * page search engines crawl. Reads the merged runtime catalog; no network, credentials or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolveFilename.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
global.fetch = async () => { throw new Error('Network forbidden in catalog payload tests'); };

const source = require('../lib/catalog-facts-v2.json');
const { products, imagePath } = require('../lib/catalog.ts');

assert(source.some(p => /biomodpeptides\.com/.test(JSON.stringify(p))), 'Fixture check: the import record still holds former-store addresses');
assert.equal(products.length, source.length, 'No product is dropped');
const payload = JSON.stringify(products);
assert(!/biomodpeptides\.com/i.test(payload), 'Catalog sent to the browser holds no former-store URL');
assert(!/wp-content/i.test(payload), 'Catalog sent to the browser holds no former-store upload path');
for (const product of products) {
  const original = source.find(p => p.id === product.id);
  assert(!('permalink' in product) && !('gallery' in product), product.slug + ' drops import-only fields');
  assert.deepEqual(Object.keys(product.image).sort(), ['alt', 'filename', 'height', 'width'], product.slug + ' image keeps only what the store draws');
  assert.equal(product.image.filename, original.image.filename, product.slug + ' keeps its image file');
  assert.equal(product.image.alt, original.image.alt, product.slug + ' keeps its image description');
  assert(imagePath(product).startsWith('/products/'), product.slug + ' image still resolves to a local file');
  for (const key of ['id', 'slug', 'name', 'sku', 'currency']) assert.equal(product[key], original[key], product.slug + ' keeps ' + key);
  assert.deepEqual(product.sizes, original.sizes, product.slug + ' keeps sizes');
}
console.log('catalog payload legacy urls v1: ' + products.length + ' products, no former-store URLs');
