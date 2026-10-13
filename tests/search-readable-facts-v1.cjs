/* Render real storefront components without browser effects, network, or database calls. */
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
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
}
require.extensions['.css'] = module => { module.exports = new Proxy({ __esModule: true }, { get: (target, key) => key === '__esModule' ? true : key === 'default' ? new Proxy({}, { get: (_, name) => String(name) }) : String(key) }); };
const { products, compound, productFormat, cas, specificationNote } = require('../lib/catalog.ts');
const { packContents } = require('../lib/packs.ts');
const { batchRecords, batchStatus, certificateFor, matchingCertificateFor, reportedResult, coaOnRequest, coaRequestNotice } = require('../lib/testing.ts');
const { ProductPage } = require('../components/store/catalog.tsx');
const { BatchDetails, CertificateButton } = require('../components/store/batch-record.tsx');
const { StoreProvider } = require('../components/store/provider.tsx');
const before = JSON.stringify(products);
const escaped = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');

for (const product of products) {
  const html = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(ProductPage, { slug: product.slug })));
  const section = html.match(/<section class="product-specifications"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert(section, product.slug + ': specifications appear in initial HTML');
  assert(!/\bhidden(?:=|\s|>)/.test(section), product.slug + ': specification facts are visible');
  assert.equal((html.match(/<dl class="specs">/g) || []).length, 1, product.slug + ': one specification list');
  for (const value of [product.name, compound(product), productFormat(product), packContents(product) || 'See product label', product.sku || 'Not provided', cas(product) || 'See product documentation', 'Laboratory research only']) {
    assert(section.includes('<dd>' + escaped(value) + '</dd>'), product.slug + ': exact specification ' + value);
  }
  assert(html.indexOf('class="batch-passport"') < html.indexOf('class="product-specifications"'), product.slug + ': facts follow the batch record');
  assert(html.indexOf('class="product-specifications"') < html.indexOf('data-slot="tabs"'), product.slug + ': facts are outside tabs');
  const tabLabels = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map(match => match[1]);
  assert.deepEqual(tabLabels, ['Description', 'Shipping'], product.slug + ': existing remaining tabs preserved');
  if (specificationNote(product)) assert(html.includes(escaped(specificationNote(product))), product.slug + ': specification hold remains visible');
}
assert.equal(JSON.stringify(products), before, 'Rendering preserves product identity, pricing, stock, and branding data');

const counts = { matched: 0, mismatch: 0, pending: 0, 'on-request': 0 };
for (const record of batchRecords) {
  const status = batchStatus(record), certificate = matchingCertificateFor(record);
  counts[status]++;
  const html = renderToStaticMarkup(React.createElement(BatchDetails, { record }));
  const direct = renderToStaticMarkup(React.createElement(CertificateButton, { record }));
  if (coaOnRequest(record)) {
    assert(html.includes(escaped(coaRequestNotice)), record.product_slug + ': printed COA notice remains');
    assert(!direct.includes('Open original PDF'), record.product_slug + ': on-request document stays restricted');
    assert(!direct.includes('Read original certificate'), record.product_slug + ': no restricted preview');
    continue;
  }
  if (!certificate) {
    if (record.lot_match === 'mismatch') {
      counts.mismatch++;
      const historical = certificateFor(record);
      assert(!html.includes(historical.url) && !html.includes(historical.report_id) && !html.includes(record.certificate_lot), record.product_slug + ': no wrong-lot report metadata');
      assert(!html.includes('The available certificate identifies a different lot.'), 'No removed mismatch paragraph');
    }
    assert(!direct.includes('Open original PDF'), record.product_slug + ': missing document has no PDF link');
    assert(html.includes('The lab report for this lot is being updated.'), record.product_slug + ': missing document remains explicit');
    continue;
  }
  assert(direct.includes('href="' + escaped(certificate.url) + '"'), record.product_slug + ': actual original PDF URL is available without opening a dialog');
  assert(direct.includes('Open original PDF') && direct.includes('Read original certificate'), record.product_slug + ': direct link and preview coexist');
  for (const [field, kind] of [['Purity', 'purity'], ['Measured content', 'assay']]) assert(html.includes('<dt>' + field + '</dt><dd>' + escaped(reportedResult(certificate, kind)) + '</dd>'), record.product_slug + ': matched results and qualifiers preserved');
}
for (const [status, count] of Object.entries(counts)) assert(count > 0, 'Real records cover ' + status);
// An old document reference must not override the existing on-request restriction.
const available = batchRecords.find(record => batchStatus(record) === 'matched');
for (const record of batchRecords.filter(coaOnRequest)) {
  const restricted = { ...record, document_id: available.document_id };
  assert(certificateFor(restricted), 'The stale-reference case has an existing public document');
  const html = renderToStaticMarkup(React.createElement(CertificateButton, { record: restricted }));
  assert(!html.includes('Open original PDF') && !html.includes('Read original certificate'), record.product_slug + ': restriction takes precedence over a stale document reference');
}
console.log('PASS: all ' + products.length + ' product specifications are visible in initial HTML; exact facts and holds preserved; description/shipping tabs retained; original PDF links and preview coexist; matched, mismatched, missing, and on-request document restrictions verified');
