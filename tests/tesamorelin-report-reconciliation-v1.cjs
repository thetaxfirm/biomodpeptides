/* Real data, batch/product components and certificate controls; isolated fixtures.
 * No network, database, inventory, order or payment calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
const compile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (m, filename) => m._compile(compile(filename), filename);
require.extensions['.css'] = m => { m.exports = new Proxy({ __esModule: true }, { get: (_, key) => key === '__esModule' ? true : key === 'default' ? new Proxy({}, { get: (_, name) => String(name) }) : String(key) }); };
global.fetch = async () => { throw Error('Network forbidden'); };
assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'lib/coas-source-v1.json'))).digest('hex'), 'c5aeed52bfeade3f054094d252c84789350d42f86fdce9db0df2ab12cceb7599', 'Versioned original source JSON remains byte-for-byte unchanged');
const source = require('../lib/coas-source-v1.json');
const additions = require('../lib/coas-additions-v1.json');
const reconciliations = require('../lib/coas-reconciliations-v1.json');
const { products } = require('../lib/catalog.ts');
const policy = require('../lib/seo-publication-v1.json');
const { productReviewBlocks } = require('../lib/seo-policy.ts');
const before = JSON.stringify({ source, additions, reconciliations, products, policy, productReviewBlocks });
const { batchRecords, laboratoryDocuments, batchFor, batchStatus, batchStatusLabel, certificateFor, batchPath, reportedResult } = require('../lib/testing.ts');
const { batchMatchesSearch } = require('../lib/batch-search.ts');
const { certificateProperties } = require('../lib/certificate-schema.ts');
const { BatchDetails } = require('../components/store/batch-record.tsx');
const { Experience } = require('../components/store/experience.tsx');
const { StoreProvider } = require('../components/store/provider.tsx');
const current = batchFor(755), product = products.find(p => p.id === 755), historical = source.records.find(r => r.product_id === 755);
const doc = certificateFor(current), oldDoc = source.documents.find(d => d.document_id === historical.document_id);
const url = 'https://alphagradepeptides.com/wp-content/uploads/2026/09/biomod-tesamorelin-10mg-coa.pdf';
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
assert.equal(historical.document_id, 'coa-d3dcb0813151');
assert.equal(historical.certificate_lot, '001-B');
assert.equal(historical.lot_match, 'mismatch');
assert.equal(oldDoc.report_id, 'COA-2026-956704');
assert.equal(reportedResult(oldDoc, 'purity'), '99.76%');
assert.equal(reportedResult(oldDoc, 'assay'), '10.43 mg');
assert.deepEqual(laboratoryDocuments.slice(0, source.documents.length), source.documents, 'Every historical laboratory document is retained without rewriting');
assert.equal(laboratoryDocuments.length, source.documents.length + reconciliations.documents.length);
assert.equal(batchRecords.length, [...source.records, ...additions].filter(r => products.some(p => p.id === r.product_id)).length, 'No extra product record or duplicate current row');
// Other reviewed label-lot reconciliations have their own regression; every other record stays as sourced.
const reconciledIds = new Set(reconciliations.reconciliations.map(item => item.product_id));
for (const r of batchRecords.filter(r => !reconciledIds.has(r.product_id))) {
  assert.deepEqual(r, [...source.records, ...additions].find(s => s.product_id === r.product_id), 'Unrelated batch record unchanged: ' + r.product_id);
}
for (const key of ['product_id', 'product_slug', 'public_identity', 'sku', 'cas', 'product_lot', 'manufactured_date', 'expiration_date', 'product_facts']) {
  assert.deepEqual(current[key], historical[key], key + ': original listed product facts are not rewritten');
}
assert.equal(current.previous_document_id, oldDoc.document_id);
assert.equal(current.certificate_lot, '301-10-0001');
assert.equal(batchStatus(current), 'matched');
assert.equal(batchStatusLabel(current), 'Matching-lot certificate');
assert.equal(doc.url, url);
assert.equal(doc.report_id, 'V260304-6 012');
assert.equal(doc.report_date, '4/2/2026');
assert.equal(doc.sha256, '74b2229680929a30771287e4ae1caa838e6749e550a184d55fc68e97628d92fb');
assert.equal(doc.source_hosting, 'supplier');
assert.equal(doc.verification_checked, false);
assert.deepEqual(current.verification_urls, [], 'The previous ILS verifier must not authenticate a Vanguard report');
assert.equal(current.certificate_dates.test_date, null, 'The previous report date must not be borrowed');
assert.equal(reportedResult(doc, 'purity'), '96.28% + 0.18%');
assert.equal(reportedResult(doc, 'assay'), '9.92 mg');
assert.deepEqual(doc.results.map(r => [r.kind, r.result, r.unit, r.method, r.loq || null, r.page]), [
  ['purity', '96.28% + 0.18%', '%', 'HPLC-UV/VIS', null, 1],
  ['assay', '9.92', 'mg', 'HPLC-UV/VIS', null, 1],
  ['heavy_metals', '0.02', 'ppm', 'ICP-MS', '0.01', 2],
  ['heavy_metals', 'ND', 'ppm', 'ICP-MS', '0.01', 2],
  ['heavy_metals', '0.03', 'ppm', 'ICP-MS', '0.02', 2],
  ['heavy_metals', 'ND', 'ppm', 'ICP-MS', '0.005', 2],
  ['endotoxins', 'Pass - <5.00 EU/mg*', 'EU/mg', 'LAL', null, 2],
  ['sterility', 'Pass - No Growth Detected', null, 'USP <71>', null, 2],
]);
assert(!JSON.stringify(doc).includes('99.76') && !JSON.stringify(doc).includes('10.43'), 'Different-lot values are not merged');
const properties = certificateProperties(755);
for (const [name, value] of [['Certificate lot', '301-10-0001'], ['Purity (reported)', '96.28% + 0.18%'], ['Measured content (reported)', '9.92 mg'], ['Certificate report date', '4/2/2026']]) {
  assert.equal(properties.find(p => p.name === name).value, value);
}
assert.equal(properties.find(p => p.name === 'Certificate of analysis').url, url);
for (const slug of ['selank', 'semax', 'kpv-10mg', 'mots-c-40mg', 'ss-31-50mg']) assert.deepEqual(certificateProperties(products.find(p => p.slug === slug).id), [], slug + ': unresolved evidence still publishes no certificate results');
const findRows = q => batchRecords.filter(r => batchMatchesSearch(r, products.find(p => p.id === r.product_id), q));
for (const q of ['V260304-6 012', 'Tesamorelin 10mg V260304-6 012', '301-10-0001', 'BM-LYO-012']) assert.deepEqual(findRows(q).map(r => r.product_id), [755], q);
assert(!findRows('COA-2026-956704').includes(current), 'Historical report ID does not masquerade as the current certificate');
assert(!findRows('Tesamorelin 20mg V260304-6 012').includes(current));

const render = (route, query = {}) => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products.map(product => ({ ...product, resolvedBatch: batchFor(product.id) || null })) }, React.createElement(Experience, { path: route, query })));
for (const [route, query] of [['product/tesamorelin-10mg', {}], ['testing', { product: '755' }], ['testing/301-10-0001', { product: '755' }]]) {
  const html = render(route, query);
  for (const value of ['Matching-lot certificate', '96.28% + 0.18%', '9.92 mg', 'V260304-6 012', 'Supplier-hosted report matching the listed lot.', 'Results apply to the submitted sample.', 'Confirm the lot supplied with your order.', 'Record updated October 10, 2026 (Pacific).']) assert(html.includes(escape(value)), route + ': ' + value);
  assert(html.includes('href="' + url + '"'), route + ': uses exact original source URL');
  assert(!html.includes(oldDoc.url) && !html.includes('99.76%') && !html.includes('10.43 mg'), route + ': no earlier report values in current record');
  if (route.startsWith('testing')) assert(html.includes('Original source import September 11, 2026; later updates appear with their records.'));
}
assert.equal(batchPath(current), '/testing/301-10-0001?product=755', 'Existing public record path remains stable');
const ordinary = batchFor(753);
assert(ordinary);
assert(!renderToStaticMarkup(React.createElement(BatchDetails, { record: ordinary })).includes('Supplier-hosted report matching the listed lot.'), 'The source disclosure is specific to this reconciliation');

// Re-evaluate the real overlay against changed in-memory inputs: no inherited
// certificate when a source association, identity, size or listed lot changes.
const clone = value => JSON.parse(JSON.stringify(value));
function evaluate(change) {
  const fixtures = { source: clone(source), additions: clone(additions), reconciliations: clone(reconciliations), products: clone(products) };
  change(fixtures);
  const filename = path.join(root, 'lib/testing.ts'), m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(root);
  m.require = name => {
    if (name === './coas-source-v1.json') return fixtures.source;
    if (name === './coas-additions-v1.json') return fixtures.additions;
    if (name === './coas-reconciliations-v1.json') return fixtures.reconciliations;
    if (name === './catalog') return { products: fixtures.products };
    throw Error('Unexpected isolated import ' + name);
  };
  m._compile(compile(filename), filename);
  return { testing: m.exports, fixtures };
}
const originalRecord = f => f.source.records.find(r => r.product_id === 755);
for (const [label, change] of [
  ['source lot', f => { originalRecord(f).product_lot = '301-10-0002'; }],
  ['source document', f => { originalRecord(f).document_id = 'different-new-source'; }],
  ['source slug', f => { originalRecord(f).product_slug = 'different-product'; }],
  ['source identity', f => { originalRecord(f).public_identity = 'Other compound'; }],
  ['catalog identity', f => { f.products.find(p => p.id === 755).identity = 'Other compound'; }],
  ['catalog size', f => { f.products.find(p => p.id === 755).sizes = ['20mg']; }],
  ['multiple sizes', f => { f.products.find(p => p.id === 755).sizes = ['10mg', '20mg']; }],
  ['report missing', f => { f.reconciliations.documents = []; }],
  ['report lot', f => { f.reconciliations.documents[0].batch_number = '001-B'; }],
  ['report recipient', f => { f.reconciliations.documents[0].report_to = 'Other brand'; }],
  ['report compound', f => { f.reconciliations.documents[0].compound = 'Other compound'; }],
  ['report strength', f => { f.reconciliations.documents[0].nominal_amount = '20 mg'; }],
]) {
  const { testing, fixtures } = evaluate(change);
  assert.deepEqual(testing.batchFor(755), originalRecord(fixtures), label + ': reviewed association must fail closed');
  assert.notEqual(testing.batchStatus(testing.batchFor(755)), 'matched', label);
}
const missing = evaluate(f => { f.products = f.products.filter(p => p.id !== 755); });
assert.equal(missing.testing.batchFor(755), undefined, 'No certificate row revives a removed product');

// Exercise the actual certificate-button open handler using only presentation
// stubs for the portal. The source, methods and scope notes render after opening.
let state = [], cursor = 0;
const hooks = { ...React, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } };
const filename = path.join(root, 'components/store/batch-record.tsx'), m = new Module(filename, module);
m.filename = filename; m.paths = Module._nodeModulePaths(root);
const normalRequire = m.require.bind(m);
m.require = name => {
  if (name === 'react') return hooks;
  if (name === '@/components/ui/dialog') return {
    Dialog: ({ open, children }) => open ? React.createElement('div', { role: 'dialog' }, children) : null,
    DialogContent: ({ children }) => React.createElement('div', null, children),
    DialogTitle: ({ children }) => React.createElement('h2', null, children),
    DialogDescription: ({ children }) => React.createElement('p', null, children),
  };
  return normalRequire(name);
};
m._compile(compile(filename), filename);
const draw = () => { cursor = 0; return m.exports.CertificateButton({ record: current }); };
const walk = (node, found = []) => { if (!node || typeof node !== 'object') return found; if (node.type) found.push(node); for (const child of React.Children.toArray(node.props?.children)) walk(child, found); return found; };
let tree = draw();
assert(!renderToStaticMarkup(tree).includes('role="dialog"'));
const button = walk(tree).find(n => n.type === 'button' && n.props.className === 'document-button');
assert(button); button.props.onClick(); tree = draw();
const opened = renderToStaticMarkup(tree);
assert(opened.includes('role="dialog"') && opened.includes('src="' + url + '#page=1&amp;zoom=100"'));
for (const value of ['96.28% + 0.18%', '9.92 mg', 'HPLC-UV/VIS', '0.02 ppm', '0.03 ppm', 'ND ppm', 'LOQ: 0.005 ppm', 'Pass - <5.00 EU/mg*', 'USP <71>']) assert(opened.includes(escape(value)), value);
for (const note of doc.report_scope_notes) assert(opened.includes(escape(note)), 'Retain every report-specific caveat');
assert(!opened.includes('±') && !opened.includes(oldDoc.url));
assert.equal(JSON.stringify({ source, additions, reconciliations, products, policy, productReviewBlocks }), before, 'Reads and rendering do not mutate source records, identities, inventory or publication policy');
console.log('PASS: exact Tesamorelin lot reconciliation, immutable ILS history, all reported values/methods/caveats, future-change guards, actual product/testing/batch SSR, current report search, structured-data evidence and actual certificate open handler with no network.');
