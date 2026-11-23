/* Indexed guides and the FAQ link to every published research vial, rendered from the real catalog.
 * HTML-only render: no network, credentials, production bindings or data writes. */
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
require.extensions['.css'] = module => { module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }); };
global.fetch = async () => { throw new Error('Network forbidden in editorial link tests'); };
const { products } = require('../lib/catalog.ts');
const { productReviewBlocks, seoConfig, sitemapPaths } = require('../lib/seo-policy.ts');
const publication = require('../lib/seo-publication-v1.json');
const { eligibleDiscovery } = require('../lib/product-discovery.ts');
const { StoreProvider } = require('../components/store/provider.tsx');
const { ContentPage } = require('../components/store/content.tsx');
const { ResearchVialIndex, OtherFormatsIndex, otherFormatsHeading } = require('../components/store/research-vial-index.tsx');
const { Shop } = require('../components/store/catalog.tsx');
const { productHeading } = require('../lib/product-discovery.ts');
const render = (child, catalog = products) => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: catalog }, child));
const productLinks = html => [...new Set([...html.matchAll(/href="\/product\/([^"#?]+)"/g)].map(m => m[1]))].sort();

const config = seoConfig({ SEO_PUBLIC_ORIGIN: publication.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') });
// Sprays, softgels and lab supplies (approved November 14, 2026) are in the sitemap too; this suite covers the vials.
const isVial = slug => products.find(p => p.slug === slug)?.categories.some(c => c.slug === 'research-compounds');
const sitemapVials = sitemapPaths(config).filter(p => p.startsWith('/product/')).map(p => p.slice(9)).filter(isVial).sort();
const vials = products.filter(p => p.categories.some(c => c.slug === 'research-compounds') && eligibleDiscovery(p)).map(p => p.slug).sort();
assert.equal(vials.length, 20);
assert.deepEqual(vials, sitemapVials, 'The linked set is exactly the sitemap product set');
// Sprays, softgel bottles and lab supplies: the shop opens on the vial list and its category buttons are not links,
// so these plain links are how the shop, the guides and the vial pages lead to them.
const sitemapOthers = sitemapPaths(config).filter(p => p.startsWith('/product/')).map(p => p.slice(9)).filter(slug => !isVial(slug)).sort();
const others = products.filter(p => !p.categories.some(c => c.slug === 'research-compounds') && eligibleDiscovery(p)).map(p => p.slug).sort();
assert.equal(others.length, 15);
assert.deepEqual(others, sitemapOthers, 'The other-format linked set is exactly the rest of the sitemap product set');
const otherHeading = 'Research sprays, softgels and lab supplies';

for (const page of ['faq', 'about', 'quality-standard', 'choosing-a-research-supplier']) {
  const html = render(React.createElement(ContentPage, { path: page }));
  assert.deepEqual(productLinks(html).filter(slug => vials.includes(slug)), vials, page + ': links every published vial');
  assert(!productLinks(html).some(slug => /heat/i.test(slug) || productReviewBlocks[slug]), page + ': no held or blocked product');
  assert.match(html, /<h2 id="research-vial-index-heading">All research peptides and compounds<\/h2>/, page + ': index sits under the page h1 as an h2');
  assert.match(html, /href="\/product\/bpc-157-10mg">BPC-157 10 mg</, page + ': sized vial label');
  assert.deepEqual(productLinks(html).filter(slug => !vials.includes(slug)), others, page + ': links every published spray, softgel and lab supply, and nothing else');
  assert(html.includes('<h2 id="other-formats-index-heading">' + otherHeading + '</h2>'), page + ': other formats sit under their own h2');
  assert.match(html, /href="\/product\/apex-semax-spray">APEX Spray 60 mg</, page + ': sized spray label');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, page + ': still one h1');
}
for (const page of ['shipping-policy', 'privacy-policy', 'terms-of-sale']) assert.deepEqual(productLinks(render(React.createElement(ContentPage, { path: page }))), [], page + ': policies stay without product links');

// Product pages keep their index of the other vials under an h3.
const bpc = products.find(p => p.slug === 'bpc-157-10mg');
const own = renderToStaticMarkup(React.createElement(ResearchVialIndex, { current: bpc, products }));
assert.deepEqual(productLinks(own), [...vials.filter(slug => slug !== 'bpc-157-10mg'), ...others].sort());
assert.match(own, /<h3 id="other-formats-index-heading">/);
// A spray page lists the other formats without itself.
const apex = products.find(p => p.slug === 'apex-semax-spray');
assert.deepEqual(productLinks(renderToStaticMarkup(React.createElement(ResearchVialIndex, { current: apex, products }))), [...vials, ...others.filter(slug => slug !== 'apex-semax-spray')].sort());

// The shop's first render (the one crawlers read) shows the vial grid and links every other published format by its heading.
const shop = render(React.createElement(Shop, {}));
assert.deepEqual(productLinks(shop).filter(slug => others.includes(slug)), others, 'shop: links every published spray, softgel and lab supply');
assert(shop.includes('<h2 id="other-formats-index-heading">' + otherHeading + '</h2>'), 'shop: other formats under an h2');
for (const slug of others) assert(shop.includes('href="/product/' + slug + '">' + productHeading(products.find(p => p.slug === slug)).replace(/&/g, '&amp;') + '</a>'), 'shop: ' + slug + ' is linked by its own page heading');
assert.equal((shop.match(/<h1\b/g) || []).length, 1, 'shop: still one h1');
assert.equal((shop.match(/id="other-formats-index-heading"/g) || []).length, 1, 'shop: one other-formats heading');
// A search or an all-products view already shows those products in the grid, so the list is not repeated.
assert(!render(React.createElement(Shop, { category: 'spray-products' })).includes('other-formats-index-heading'), 'spray view: no repeated list');
// Held or unpublished products never enter the list, and the heading names only the formats present.
const listed = renderToStaticMarkup(React.createElement(OtherFormatsIndex, { products }));
assert(!productLinks(listed).some(slug => /heat/i.test(slug) || productReviewBlocks[slug] || !publication.productSlugs.includes(slug)), 'other formats: no held, blocked or unpublished product');
assert.equal(otherFormatsHeading(products.filter(p => p.categories.some(c => c.slug === 'softgels'))), 'Research softgels');
assert.equal(renderToStaticMarkup(React.createElement(OtherFormatsIndex, { products: products.filter(p => !eligibleDiscovery(p)) })), '');
assert.match(own, /<h3 id="research-vial-index-heading">/);
// A catalog with no published vials renders nothing.
assert.equal(renderToStaticMarkup(React.createElement(ResearchVialIndex, { products: products.filter(p => !eligibleDiscovery(p)) })), '');
console.log('PASS: FAQ, About, COA and supplier guides link all 20 published vials and 15 sprays, softgels and lab supplies; shop links the 15; policies unchanged');
