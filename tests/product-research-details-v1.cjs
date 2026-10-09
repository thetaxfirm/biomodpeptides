/* Real SSR integration with isolated catalog fixtures. No network, database or orders. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.css'] = module => { module.exports = new Proxy({ __esModule: true }, { get: (target, key) => key === '__esModule' ? true : key === 'default' ? new Proxy({}, { get: (_, name) => String(name) }) : String(key) }); };

const { products, money } = require('../lib/catalog.ts');
const { packContents, packSizes } = require('../lib/packs.ts');
const { eligibleDiscovery } = require('../lib/product-discovery.ts');
const { batchFor, batchStatus, batchStatusLabel } = require('../lib/testing.ts');
const { VialSizeLinks, ProductResearchDetails } = require('../components/store/product-research-details.tsx');
const { ProductPage } = require('../components/store/catalog.tsx');
const { Experience } = require('../components/store/experience.tsx');
const { StoreProvider } = require('../components/store/provider.tsx');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const asText = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const before = JSON.stringify(products);
const ten = products.find(product => product.slug === 'mots-c-10mg');
const forty = products.find(product => product.slug === 'mots-c-40mg');
assert(ten && forty);
assert.equal(batchStatus(batchFor(ten.id)), 'matched');
assert.equal(batchStatus(batchFor(forty.id)), 'pending');

// Deliberately differ from saved values to prove that the live provider catalog
// controls displayed prices/stock rather than a statically imported price list.
const fixture = products.map(product => product.id === ten.id ? { ...product, price: 4321, inStock: false } : product.id === forty.id ? { ...product, price: 12345, inStock: true, purchasable: true, stockQuantity: 8 } : product);
const currentForty = fixture.find(product => product.id === forty.id);
const sizeHTML = render(VialSizeLinks, { product: currentForty, products: fixture });
const items = [...sizeHTML.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => match[1]);
assert.equal(items.length, 2);
assert(items[0].includes('href="/product/mots-c-10mg"') && items[0].includes('$43.21') && items[0].includes('Out of stock'));
assert(items[0].includes('Matching-lot certificate'));
assert(items[1].includes('href="/product/mots-c-40mg" aria-current="page"') && items[1].includes('$123.45') && items[1].includes('In stock'));
assert(items[1].includes('Documentation pending') && !items[1].includes('Matching-lot certificate'), '40mg must never borrow10mg documentation');
assert.equal((sizeHTML.match(/aria-current="page"/g) || []).length, 1);
assert(!sizeHTML.includes('.pdf'), 'size navigation does not reuse a sibling certificate');
assert.equal(render(VialSizeLinks, { product: ten, products: fixture.filter(product => product.id !== forty.id) }), '', 'partial families are not guessed');
const held = products.find(product => product.slug === 'tb500-10mg');
assert.equal(render(VialSizeLinks, { product: held, products }), '');

let eligibleCount = 0;
for (const product of products) {
  const html = render(ProductResearchDetails, { product });
  if (!eligibleDiscovery(product)) {
    assert.equal(html, '', product.slug + ': held/unreviewed items receive no new FAQ promotion');
    continue;
  }
  eligibleCount++;
  assert.equal((html.match(/<h3\b/g) || []).length, 2);
  assert(html.includes(escape(product.name)) && html.includes(escape(packContents(product))));
  if (product.sku) assert(html.includes(escape(product.sku)));
  assert(asText(html).includes('Pack sizes of ' + packSizes.slice(0, -1).join(', ') + ' or ' + packSizes.at(-1) + ' count complete vials.'));
  assert(html.includes('href="/testing?product=' + product.id + '"'));
  assert(html.includes('href="/quality-standard#read-the-results"'));
  assert(!/<(?:button|details|script)\b|\bhidden=|aria-hidden=/.test(html), 'answers remain readable in initial HTML');
  const status = batchStatus(batchFor(product.id));
  if (status === 'matched') assert(html.includes('lot number matching this listing'));
  else if (status === 'mismatch') assert(html.includes('results do not verify the listed product lot'));
  else assert(html.includes('Pending documentation is not a completed test result.') && !html.includes('lot number matching this listing'));
}
assert.equal(eligibleCount, 16);

const renderPage = (slug, catalog = products) => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: catalog }, React.createElement(ProductPage, { slug })));
const productHTML = renderPage(forty.slug, fixture);
assert(productHTML.includes(sizeHTML), 'actual product route includes live size navigation');
assert(productHTML.indexOf('other-vial-sizes-heading') < productHTML.indexOf('class="detail-description"'), 'size navigation is near product metadata');
assert(productHTML.indexOf('class="product-specifications"') < productHTML.indexOf('product-questions-heading'), 'questions follow specifications');
assert(productHTML.includes('Add to cart') && productHTML.includes('Pack size'), 'existing purchase controls remain');
const relatedHTML = productHTML.match(/<section class="related">([\s\S]*?)<\/section>/)?.[1];
assert(relatedHTML?.includes('/product/mots-c-10mg'), 'related products include the actual same-compound sibling');
for (const [, slug] of relatedHTML.matchAll(/href="\/product\/([^"]+)"/g)) assert(eligibleDiscovery(products.find(product => product.slug === slug)), 'research recommendations remain publication-eligible');
const softgel = products.find(product => product.categories[0]?.slug === 'softgels');
const softgelHTML = renderPage(softgel.slug);
assert(!softgelHTML.includes('product-questions-heading') && !softgelHTML.includes('other-vial-sizes-heading'));
const softgelRelated = softgelHTML.match(/<section class="related">([\s\S]*?)<\/section>/)?.[1];
const expectedSoftgelSlugs = products.filter(product => product.id !== softgel.id && product.categories[0]?.slug === 'softgels').slice(0, 3).map(product => product.slug);
assert.deepEqual([...new Set([...softgelRelated.matchAll(/href="\/product\/([^"]+)"/g)].map(match => match[1]))], expectedSoftgelSlugs, 'existing nonresearch recommendation order is preserved');
for (const [query, heading] of [[{}, 'Research peptides &amp; compounds'], [{ category: 'softgels' }, 'Softgels'], [{ category: 'spray-products' }, 'Spray Products'], [{ q: 'MOTS' }, 'The BIOMOD collection.']]) {
  const html = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(Experience, { path: 'shop', query })));
  assert(html.includes('<h1>' + heading + '</h1>'), 'full shop route heading reflects current query/category');
}
assert.equal(JSON.stringify(products), before, 'rendering never mutates source product identity, price, inventory or contents');
console.log('PASS: real ProductPage and Experience SSR preserve current purchase controls; live size pricing/stock and independent COA states;16 factual FAQs only; eligible research links; unchanged nonresearch links and accurate shop headings');
