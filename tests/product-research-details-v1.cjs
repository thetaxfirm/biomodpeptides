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
const { ProductPage, ProductCard } = require('../components/store/catalog.tsx');
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
assert(items[0].includes('href="/product/mots-c-10mg"') && items[0].includes('10 mg') && items[0].includes('Out of stock'));
assert(items[1].includes('href="/product/mots-c-40mg" aria-current="page"') && items[1].includes('40 mg') && items[1].includes('In stock'));
assert(!sizeHTML.includes('$') && !sizeHTML.includes('/testing'), 'compact navigation leaves the price and documents to the selected product');
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
assert.equal(eligibleCount, 17);

const renderPage = (slug, catalog = products) => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: catalog }, React.createElement(ProductPage, { slug })));
const productHTML = renderPage(forty.slug, fixture);
assert(productHTML.includes(sizeHTML), 'actual product route includes live size navigation');
assert(productHTML.indexOf('other-vial-sizes-heading') < productHTML.indexOf('class="detail-price"'), 'choose the vial size before reading the selected price');
assert(productHTML.includes('$123.45'), 'selected product price comes from live catalog');
const passport = productHTML.match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
assert(passport?.includes('Documentation pending') && !passport.includes('Matching-lot certificate') && !passport.includes('.pdf'), '40mg retains its own documentation; never borrows the10mg COA');
const tenPassport = renderPage(ten.slug, fixture).match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
assert(tenPassport?.includes('Matching-lot certificate') && tenPassport.includes('MOTS-C_10-mg.pdf'), '10mg keeps its original matching report');
const ssTen = products.find(product => product.slug === 'ss-31-10mg');
const ssFifty = products.find(product => product.slug === 'ss-31-50mg');
assert(ssTen && ssFifty);
assert.equal(batchStatus(batchFor(ssTen.id)), 'matched');
assert.equal(batchStatus(batchFor(ssFifty.id)), 'pending');
for (const current of [ssTen, ssFifty]) {
  const sizeNav = render(VialSizeLinks, { product: current, products });
  assert(sizeNav.includes('href="/product/ss-31-10mg"') && sizeNav.includes('href="/product/ss-31-50mg"'));
  assert(sizeNav.includes('href="/product/' + current.slug + '" aria-current="page"'));
  assert(!sizeNav.includes('$') && !sizeNav.includes('.pdf'), 'SS-31 size navigation keeps selected-price and batch details separate');
  const currentPage = renderPage(current.slug);
  assert(currentPage.includes(sizeNav), 'Actual SS-31 product page includes both confirmed sizes');
  assert(currentPage.indexOf('other-vial-sizes-heading') < currentPage.indexOf('class="detail-price"'));
  assert(currentPage.includes(money(current.price)), 'SS-31 page retains its own price');
}
const ssTenPassport = renderPage(ssTen.slug).match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
const ssFiftyPassport = renderPage(ssFifty.slug).match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
assert(ssTenPassport?.includes('Matching-lot certificate') && ssTenPassport.includes('SS-31_10-mg.pdf'), 'SS-31 10 mg retains its own matching COA');
assert(ssFiftyPassport?.includes('Documentation pending') && !ssFiftyPassport.includes('.pdf') && !ssFiftyPassport.includes('408-10-0001'), 'SS-31 50 mg cannot inherit the 10 mg certificate or lot');
for (const slugs of [['wolverine-10mg', 'wolverine-20mg'], ['heat-r-20mg', 'heat-r-30mg']]) {
  for (const slug of slugs) {
    const current = products.find(product => product.slug === slug);
    assert(current, slug + ': listing exists');
    const currentPage = renderPage(slug);
    const sizeNav = render(VialSizeLinks, { product: current, products });
    assert(currentPage.includes(sizeNav) && sizeNav.includes('other-vial-sizes-heading'), slug + ': actual product page includes explicit sibling browsing');
    for (const sibling of slugs) assert(sizeNav.includes('href="/product/' + sibling + '"'));
    assert(sizeNav.includes('href="/product/' + slug + '" aria-current="page"'));
    assert(!sizeNav.includes('.pdf') && !sizeNav.includes('$'), 'Size navigation does not reuse price or testing evidence');
    assert(!currentPage.includes('product-questions-heading'), slug + ': browsing does not enable organic FAQ promotion');
    assert(currentPage.includes(money(current.price)), slug + ': each selected listing keeps its own price');
  }
}
const wolverineTwenty = products.find(product => product.slug === 'wolverine-20mg');
assert.equal(wolverineTwenty.purchasable, false, 'Wolverine 20 mg cannot be purchased before the current batch is confirmed');
assert.equal(wolverineTwenty.inStock, false);
assert.equal(wolverineTwenty.stockQuantity, null, 'Unavailable listing invents no stock count');
const wolverineHTML = renderPage(wolverineTwenty.slug);
assert(wolverineHTML.includes('<h1>Wolverine 20 mg</h1>'));
assert(wolverineHTML.includes(wolverineTwenty.availabilityLabel));
const detailAddButton = wolverineHTML.match(/<button class="button button-gold"[^>]*>([\s\S]*?)<\/button>/)?.[0];
assert(detailAddButton?.includes('disabled=""') && detailAddButton.includes(wolverineTwenty.availabilityLabel), 'The unavailable size has an honest disabled purchase CTA');
const wolverinePassport = wolverineHTML.match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
assert(wolverinePassport && !wolverinePassport.includes('.pdf'), 'No sibling or historical certificate is assigned to the new unavailable size');
const shopHTML = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(Experience, { path: 'shop', query: {} })));
const shopCards = [...shopHTML.matchAll(/<article class="product-card">([\s\S]*?)<\/article>/g)].map(match => match[1]);
for (const slugs of [['ss-31-10mg', 'ss-31-50mg'], ['wolverine-10mg', 'wolverine-20mg'], ['heat-r-20mg', 'heat-r-30mg']]) {
  for (const slug of slugs) {
    const product = products.find(product => product.slug === slug);
    const sibling = slugs.find(candidate => candidate !== slug);
    const card = shopCards.find(html => html.includes('<h3><a href="/product/' + slug + '">'));
    assert(card, slug + ': shop shows a separate card');
    const title = product.name.replace(/\s+\d+(?:\.\d+)?\s*mg$/i, '') + ' ' + packContents(product).replace(/(\d)\s*mg\b/gi, '$1 mg');
    assert(card.includes('<h3><a href="/product/' + slug + '">' + escape(title) + '</a></h3>'), slug + ': card title states its actual strength');
    assert(card.includes('class="card-other-size" href="/product/' + sibling + '"'), slug + ': shop links directly to the other strength');
    assert(card.includes(money(product.price)), slug + ': shop preserves the independent price');
  }
}
for (const [query, expected] of [
  ['ss31', ['ss-31-10mg', 'ss-31-50mg']],
  ['wolverine', ['wolverine-10mg', 'wolverine-20mg']],
  ['heat-r', ['heat-r-20mg', 'heat-r-30mg']],
  ['ss31 50mg', ['ss-31-50mg']],
  ['wolverine 20mg', ['wolverine-20mg']],
  ['heat-r 30mg', ['heat-r-30mg']],
]) {
  const results = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(Experience, { path: 'shop', query: { q: query } })));
  const listedSlugs = [...results.matchAll(/<h3><a href="\/product\/([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(listedSlugs.sort(), expected.sort(), query + ': the actual shop search finds exact sizes without substituting a different strength');
}
const bundleCard = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(ProductCard, { product: ssTen, onAdd: () => {} })));
assert(!bundleCard.includes('card-other-size'), 'Bundle selection cards keep their existing interaction and do not gain size links');
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
for (const [query, heading] of [[{}, 'Research peptides &amp; compounds'], [{ category: 'softgels' }, 'Softgels'], [{ category: 'spray-products' }, 'Nasal &amp; spray products'], [{ q: 'MOTS' }, 'The BIOMOD collection.']]) {
  const html = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(Experience, { path: 'shop', query })));
  assert(html.includes('<h1>' + heading + '</h1>'), 'full shop route heading reflects current query/category');
}
assert.equal(JSON.stringify(products), before, 'rendering never mutates source product identity, price, inventory or contents');
console.log('PASS: real ProductPage and Experience SSR preserve current purchase controls; compact size navigation, live selected price/stock and independent COA states;17 factual FAQs only; six explicit shop variants with reciprocal size links and unavailable W20 purchase controls; eligible research links; unchanged nonresearch links and accurate shop headings');
