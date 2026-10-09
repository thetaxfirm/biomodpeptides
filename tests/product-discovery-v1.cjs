/* Discovery navigation uses real catalog facts; rendering never runs browser effects. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolveFilename.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
// CSS is not evaluated by this HTML-only renderer; preserve module class names.
require.extensions['.css'] = module => { module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }); };
const { products, money } = require('../lib/catalog.ts');
const { productReviewBlocks, seoConfig, mayIndex } = require('../lib/seo-policy.ts');
const publication = require('../lib/seo-publication-v1.json');
const { eligibleDiscovery, orderHomeVials, relatedResearchProducts, otherVialSizes } = require('../lib/product-discovery.ts');
const { HomeVials } = require('../components/store/home-vials.tsx');
const { Header, nav } = require('../components/store/header.tsx');
const { StoreProvider } = require('../components/store/provider.tsx');
const before = JSON.stringify(products);
const reviewed = publication.productSlugs.filter(slug => !productReviewBlocks[slug]).sort();
assert.equal(reviewed.length, 17, 'The verified SS-31 50 mg listing joins the 16 existing reviewed targets');
const vials = products.filter(product => product.categories.some(category => category.slug === 'research-compounds'));
const ordered = orderHomeVials(products);
assert.equal(products.length, 52, 'SS-31 50 mg and the unavailable Wolverine 20 mg have independent catalog records');
assert.equal(ordered.length, 33);
assert.deepEqual(ordered.map(product => product.id).sort((a, b) => a - b), vials.map(product => product.id).sort((a, b) => a - b), 'All original vial members remain present');
assert.deepEqual(ordered.slice(0, reviewed.length).map(product => product.slug).sort(), reviewed);
assert(ordered.slice(reviewed.length).every(product => !eligibleDiscovery(product)), 'Unreviewed products remain after the reviewed group');
assert(ordered.every(product => products.includes(product)), 'Home order preserves the supplied product objects');
assert.deepEqual(orderHomeVials(products), ordered, 'Ordering is deterministic');
for (const product of products) {
  assert.equal(eligibleDiscovery(product), publication.productSlugs.includes(product.slug) && !productReviewBlocks[product.slug]);
  const related = relatedResearchProducts(product, products);
  assert(related.length <= 3);
  assert(related.every(candidate => candidate.id !== product.id && eligibleDiscovery(candidate) && candidate.categories[0]?.slug === product.categories[0]?.slug));
  assert(!related.some(candidate => /heat/i.test(candidate.slug)), product.slug + ': no held HEAT recommendation');
  assert.deepEqual(relatedResearchProducts(product, products), related, product.slug + ': deterministic links');
  assert.deepEqual(relatedResearchProducts(product, products, 0), []);
}
const ten = products.find(product => product.slug === 'mots-c-10mg');
const forty = products.find(product => product.slug === 'mots-c-40mg');
for (const [current, sibling] of [[ten, forty], [forty, ten]]) {
  assert.deepEqual(otherVialSizes(current, products), [ten, forty], 'Explicit sizes have stable 10/40 order');
  assert.equal(relatedResearchProducts(current, products)[0], sibling, 'Exact MOTS size sibling comes first');
  assert.deepEqual(otherVialSizes(current, products.filter(product => product.id !== sibling.id)), [], 'Incomplete size pairs are not offered');
}
const ssTen = products.find(product => product.slug === 'ss-31-10mg');
const ssFifty = products.find(product => product.slug === 'ss-31-50mg');
assert(ssTen && ssFifty);
for (const [current, sibling] of [[ssTen, ssFifty], [ssFifty, ssTen]]) {
  assert.deepEqual(otherVialSizes(current, products), [ssTen, ssFifty], 'Confirmed SS-31 sizes have stable 10/50 order');
  assert.equal(relatedResearchProducts(current, products)[0], sibling, 'Exact SS-31 size sibling comes first');
  assert.deepEqual(otherVialSizes(current, products.filter(product => product.id !== sibling.id)), [], 'Incomplete SS-31 pairs are not offered');
}
const heldFamilies = [['wolverine-10mg', 'wolverine-20mg'], ['heat-r-20mg', 'heat-r-30mg']].map(slugs => slugs.map(slug => products.find(product => product.slug === slug)));
const indexConfig = seoConfig({ SEO_PUBLIC_ORIGIN: 'https://trybiomod.com', SEO_INDEXING_ENABLED: 'true', SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: products.map(product => product.slug).join(',') });
for (const family of heldFamilies) {
  assert(family.every(Boolean), 'Each confirmed size has an independent catalog record');
  for (const current of family) {
    assert.deepEqual(otherVialSizes(current, products), family, current.slug + ': ordinary size browsing works independently of organic review');
    assert(!eligibleDiscovery(current), current.slug + ': size navigation does not approve organic promotion');
    assert(!mayIndex('/product/' + current.slug, new URLSearchParams(), indexConfig), current.slug + ': the existing review hold still prevents indexing');
    assert(relatedResearchProducts(current, products).every(eligibleDiscovery), current.slug + ': related recommendations remain reviewed');
    assert.deepEqual(otherVialSizes(current, products.filter(product => product.id !== family.find(candidate => candidate.id !== current.id).id)), [], 'Incomplete held families are not guessed');
  }
}
const familyIds = [ten, forty, ssTen, ssFifty, ...heldFamilies.flat()].map(product => product.id);
for (const product of products.filter(product => !familyIds.includes(product.id))) assert.deepEqual(otherVialSizes(product, products), [], product.slug + ': no inferred equivalence');
// Deliberately altered in-memory values stand for a current runtime catalog snapshot.
// Returning source-file prices or stock here would erase the runtime values.
const dynamic = products.map(product => ({ ...product, price: product.price + 1, inStock: false, stockQuantity: 0 }));
const dynamicSizes = otherVialSizes(ten, dynamic);
assert.equal(dynamicSizes[0], dynamic.find(product => product.id === ten.id));
assert.equal(dynamicSizes[1], dynamic.find(product => product.id === forty.id));
assert.equal(dynamicSizes[1].stockQuantity, 0);
assert.equal(relatedResearchProducts(ten, dynamic)[0], dynamicSizes[1]);

const render = child => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, child));
const home = render(React.createElement(HomeVials, { products: ordered }));
const initialLinks = [...new Set([...home.matchAll(/href="\/product\/([^"]+)"/g)].map(match => match[1]))].sort();
const homeCards = [...home.matchAll(/<article class="product-card">([\s\S]*?)<\/article>/g)].map(match => match[1]);
assert.equal(homeCards.length, 16, 'Homepage retains its 16-card initial page');
assert.deepEqual(homeCards.map(card => card.match(/<h3><a href="\/product\/([^"]+)"/)?.[1]), ordered.slice(0, 16).map(product => product.slug));
assert(initialLinks.every(slug => reviewed.includes(slug)), 'Initial cards and alternate-size links exclude held products');
assert(home.includes('Showing 16 of 33 lyophilized peptides'));
assert(home.includes('Load more lyophilized peptides'), 'The remaining vial members retain the existing Load more control');
assert(nav.some(([label, href]) => label === 'Research Vials' && href === '/shop'));
assert(nav.some(([label, href]) => label === 'COAs & testing' && href === '/testing'));
const header = render(React.createElement(Header));
assert(!header.includes('/shop?category=research-compounds'));
assert(header.includes('href="/shop"') && header.includes('COAs &amp; testing'));
assert.equal(JSON.stringify(products), before, 'Discovery and rendering leave all 52 product records unchanged');
// Render the actual homepage route too, so a missing helper call cannot pass merely
// because HomeVials was handed a preordered list by this test. Only request-specific
// SEO and the unrelated home FAQ are isolated from server/browser dependencies.
const pageFilename = path.join(root, 'app/page.tsx');
const pageModule = new Module(pageFilename, module);
pageModule.filename = pageFilename;
pageModule.paths = Module._nodeModulePaths(root);
const pageRequire = pageModule.require.bind(pageModule);
pageModule.require = name => name === '@/lib/seo' ? {
  requestSEO: async () => ({}), routeStructuredData: async () => null, jsonLd: JSON.stringify,
} : name === '@/components/store/content' ? { FAQ: () => null } : pageRequire(name);
pageModule._compile(ts.transpileModule(fs.readFileSync(pageFilename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, pageFilename);
(async () => {
  const page = render(await pageModule.exports.default({ searchParams: Promise.resolve({}) }));
  const featured = [...new Set([...page.matchAll(/href="\/product\/([^"]+)"/g)].map(match => match[1]))].sort();
  assert(featured.every(slug => reviewed.includes(slug)), 'Actual homepage cards and size links remain reviewed');
  assert(page.includes('Showing 16 of 33 lyophilized peptides'));
  const cards = [...page.matchAll(/<article class="product-card">([\s\S]*?)<\/article>/g)].map(match => match[1]);
  assert.equal(cards.length, 16, 'Actual homepage retains 16 cards before Load more');
  const tenIndex = cards.findIndex(card => card.includes('<h3><a href="/product/mots-c-10mg">'));
  const fortyIndex = cards.findIndex(card => card.includes('<h3><a href="/product/mots-c-40mg">'));
  assert(tenIndex >= 0 && fortyIndex === tenIndex + 1, 'MOTS-c sizes are adjacent on the actual homepage');
  const ssTenIndex = cards.findIndex(card => card.includes('<h3><a href="/product/ss-31-10mg">'));
  const ssFiftyIndex = cards.findIndex(card => card.includes('<h3><a href="/product/ss-31-50mg">'));
  assert(ssTenIndex > fortyIndex, 'Both SS-31 sizes appear in the initial homepage selection');
  assert.equal(ssFiftyIndex, ssTenIndex + 1, 'SS-31 sizes are adjacent on the homepage');
  for (const [index, current, sibling] of [[tenIndex, ten, forty], [fortyIndex, forty, ten], [ssTenIndex, ssTen, ssFifty], [ssFiftyIndex, ssFifty, ssTen]]) {
    assert(cards[index].includes('class="card-other-size" href="/product/' + sibling.slug + '"'), 'Each size-family card links directly to the other size');
    assert(cards[index].includes('aria-label="Save ' + current.name + ' to wishlist"'), 'Wishlist retains the current card SKU');
    assert(cards[index].includes(money(current.price)), 'The size cross-link cannot replace this card price');
  }
  assert(!page.includes('/shop?category=research-compounds'), 'Actual home research links use the canonical catalog');
  assert.equal(JSON.stringify(products), before);
  console.log('PASS: actual homepage renders 16 of 33 vials with adjacent MOTS-c 10/40 and SS-31 10/50 pairs; all 17 reviewed targets lead held items; held pairs remain noindex while available for size browsing; Load more retained; explicit size links and live values preserved; canonical navigation; no catalog mutation');
})().catch(error => { console.error(error); process.exitCode = 1; });
