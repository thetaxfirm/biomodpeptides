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
const { ResearchVialIndex } = require('../components/store/research-vial-index.tsx');
const render = (child, catalog = products) => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: catalog }, child));
const productLinks = html => [...new Set([...html.matchAll(/href="\/product\/([^"#?]+)"/g)].map(m => m[1]))].sort();

const config = seoConfig({ SEO_PUBLIC_ORIGIN: publication.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') });
const sitemapVials = sitemapPaths(config).filter(p => p.startsWith('/product/')).map(p => p.slice(9)).sort();
const vials = products.filter(p => p.categories.some(c => c.slug === 'research-compounds') && eligibleDiscovery(p)).map(p => p.slug).sort();
assert.equal(vials.length, 17);
assert.deepEqual(vials, sitemapVials, 'The linked set is exactly the sitemap product set');

for (const page of ['faq', 'about', 'quality-standard', 'choosing-a-research-supplier']) {
  const html = render(React.createElement(ContentPage, { path: page }));
  assert.deepEqual(productLinks(html).filter(slug => vials.includes(slug)), vials, page + ': links every published vial');
  assert(!productLinks(html).some(slug => /heat/i.test(slug) || productReviewBlocks[slug]), page + ': no held or blocked product');
  assert.match(html, /<h2 id="research-vial-index-heading">All research compounds<\/h2>/, page + ': index sits under the page h1 as an h2');
  assert.match(html, /href="\/product\/bpc-157-10mg">BPC-157 10 mg</, page + ': sized vial label');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, page + ': still one h1');
}
for (const page of ['shipping-policy', 'privacy-policy', 'terms-of-sale']) assert.deepEqual(productLinks(render(React.createElement(ContentPage, { path: page }))), [], page + ': policies stay without product links');

// Product pages keep their index of the other vials under an h3.
const bpc = products.find(p => p.slug === 'bpc-157-10mg');
const own = renderToStaticMarkup(React.createElement(ResearchVialIndex, { current: bpc, products }));
assert.deepEqual(productLinks(own), vials.filter(slug => slug !== 'bpc-157-10mg'));
assert.match(own, /<h3 id="research-vial-index-heading">/);
// A catalog with no published vials renders nothing.
assert.equal(renderToStaticMarkup(React.createElement(ResearchVialIndex, { products: products.filter(p => !eligibleDiscovery(p)) })), '');
console.log('PASS: FAQ, About, COA and supplier guides link all 17 published vials; policies unchanged; product index unchanged');
