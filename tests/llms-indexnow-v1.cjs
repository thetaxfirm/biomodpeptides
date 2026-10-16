/* llms.txt and IndexNow tests. No network, credentials, or live configuration. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { seoConfig, sitemapPaths, productReviewBlocks } = require('../lib/seo-policy.ts');
const { llmsText } = require('../lib/llms-text.ts');
const base = { SEO_PUBLIC_ORIGIN: 'https://trybiomod.com', SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: ['bpc-157-10mg', ...Object.keys(productReviewBlocks)].join(',') };
const live = seoConfig(base);
const text = llmsText(live.publicOrigin, sitemapPaths(live));
assert(text.startsWith('# Biomod Peptides (TryBiomod)'));
assert.match(text, /not for human or animal use/i);
assert(text.includes('(https://trybiomod.com/product/bpc-157-10mg)'));
assert(text.includes('(https://trybiomod.com/quality-standard)'));
for (const slug of Object.keys(productReviewBlocks)) assert(!text.includes('/product/' + slug + ')'), 'held product leaked: ' + slug);
for (const p of ['/cart', '/checkout', '/account', '/admin', '/locations', '/softgels']) assert(!text.includes('trybiomod.com' + p + ')'), p);
assert.equal(text.split('\n').filter(l => l.startsWith('- [')).length, sitemapPaths(live).length);
assert.equal(sitemapPaths(seoConfig()).length, 0);
const keyFiles = fs.readdirSync(path.join(__dirname, '../public')).filter(f => /^[0-9a-f]{32}\.txt$/.test(f));
assert.equal(keyFiles.length, 1);
const key = keyFiles[0].slice(0, -4);
assert.equal(fs.readFileSync(path.join(__dirname, '../public', keyFiles[0]), 'utf8'), key);
assert(fs.readFileSync(path.join(__dirname, '../scripts/indexnow-submit-v1.mjs'), 'utf8').includes(`'${key}'`));
const { certificateProperties } = require('../lib/certificate-schema.ts');
const { products } = require('../lib/catalog.ts');
const { batchFor, batchStatus } = require('../lib/testing.ts');
const id = slug => products.find(p => p.slug === slug).id;

// The rule: a product publishes laboratory results only when the certificate's lot is the lot being
// sold. Asserted against every product rather than a fixed list, and by comparing the published lot
// with the selling lot rather than by repeating today's purity figures — a renewed certificate must
// not turn this suite red, but publishing results for the wrong lot always must.
let published = 0;
for (const product of products) {
  const record = batchFor(product.id, product);
  const properties = certificateProperties(product.id);
  if (!record || batchStatus(record) !== 'matched') {
    assert.deepEqual(properties, [], 'only a matched lot may publish results: ' + product.slug);
    continue;
  }
  published += 1;
  const lot = properties.find(x => x.name === 'Certificate lot');
  assert.equal(lot && lot.value, record.product_lot, 'the published certificate lot is the lot being sold: ' + product.slug);
  const coa = properties.find(x => x.name === 'Certificate of analysis');
  assert(coa, 'a matched product names its certificate: ' + product.slug);
  if (coa.url) assert.match(coa.url, /^https:\/\//, 'certificate links are https: ' + product.slug);
}
assert(published >= 2, 'at least some products publish results, or this suite proves nothing');

// Spot checks on the two long-standing matched lots. Lot identity only: purity and assay figures
// belong to whichever certificate is current, and are reconciled against their source elsewhere.
assert.equal(certificateProperties(id('bpc-157-10mg')).find(x => x.name === 'Certificate lot').value, '201-10-0001');
assert.equal(certificateProperties(id('tesamorelin-10mg')).find(x => x.name === 'Certificate lot').value, '301-10-0001');
assert.deepEqual(certificateProperties(id('selank')), [], 'a pending lot still publishes nothing');
console.log('PASS: llms.txt lists exactly the sitemap-eligible pages, excludes held and private routes, keeps research-use language; certificate results are published in Product data only for matching lots; IndexNow key file matches the submit script');
