// Real catalog and batch records; isolated rendering only. No network or customer writes.
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
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.css'] = module => { module.exports = new Proxy({ __esModule: true }, { get: (_, key) => key === '__esModule' ? true : key === 'default' ? new Proxy({}, { get: (_, name) => String(name) }) : String(key) }); };
const { products } = require('../lib/catalog.ts');
const { batchRecords, laboratoryDocuments, certificateFor, batchStatus, coaOnRequest } = require('../lib/testing.ts');
const { batchMatchesSearch } = require('../lib/batch-search.ts');
const { eligibleDiscovery } = require('../lib/product-discovery.ts');
const { productReviewBlocks } = require('../lib/seo-policy.ts');
const { BatchDetails } = require('../components/store/batch-record.tsx');
const before = JSON.stringify({ products, batchRecords, laboratoryDocuments });
const product = record => products.find(p => p.id === record.product_id);
const record = slug => { const r = batchRecords.find(r => r.product_slug === slug); assert(r, slug); return r; };
const rows = (query, { selected = 'all', status = 'all', lot = '' } = {}) => batchRecords.filter(r =>
  (selected === 'all' || String(r.product_id) === selected) && (!lot || r.record_id === lot || r.product_lot === lot) &&
  (status === 'all' || batchStatus(r) === status) && batchMatchesSearch(r, product(r), query));
const matches = query => rows(query).map(r => r.product_slug).sort();
const bpc = record('bpc-157-10mg'), ss10 = record('ss-31-10mg'), ss50 = record('ss-31-50mg');
const bpcReport = certificateFor(bpc).report_id, ss10Report = certificateFor(ss10).report_id;

for (const query of ['BPC157', 'BPC 157', '  bPc-157  ', 'BPC157 10mg peptide', 'BPC 157 10 mg']) {
  assert(matches(query).includes(bpc.product_slug), query);
}
assert.deepEqual(matches('MOTS C'), ['mots-c-10mg', 'mots-c-40mg']);
assert.deepEqual(matches('SS31'), ['ss-31-10mg', 'ss-31-50mg']);
assert.deepEqual(matches('SS31 50mg'), [ss50.product_slug]);
assert.deepEqual(matches('SS31 10 mg peptide'), [ss10.product_slug]);
assert.deepEqual(matches('Epithalon 50mg'), ['epitalon-50mg']);
assert.deepEqual(matches('MOTS C 40mg'), ['mots-c-40mg']);
assert.deepEqual(matches('Wolverine 10mg'), ['wolverine-10mg']);
assert.deepEqual(matches('Wolverine 20mg'), ['wolverine-20mg']);

for (const query of [bpcReport, 'v2603046010', 'V260304 6 010', 'BPC157 ' + bpcReport,
  bpcReport + ' BPC157 10mg', bpc.product_lot, 'BPC157 10mg ' + bpc.product_lot,
  '201100001 BPC157', product(bpc).sku, 'bm lyo 010', product(bpc).sku + ' ' + bpc.product_lot + ' BPC157 10mg']) {
  assert.deepEqual(matches(query), [bpc.product_slug], query);
}
for (const query of ['BPC157 20mg ' + bpcReport, 'SS31 50mg ' + ss10Report,
  'SS31 21mg', 'SS31 31mg', 'SS31 017mg', 'BM-LYO-017 50mg', 'BM-LYO-017mg',
  '408100001mg', 'MOTS C 64mg', 'BPC157 10mg spray', 'BPC157 10mg softgel',
  'SS31 50ml', 'BPC157 10mg 20mg', 'NAD peptide', 'V260304-6 999', '260304',
  'BPC157 201-10-9999', 'BPC157 ' + ss10Report, bpcReport + ' ' + ss10Report]) {
  assert.deepEqual(matches(query), [], query);
}

// Identifier queries stay attached to their own records, including mismatches.
for (const r of batchRecords) {
  assert(batchMatchesSearch(r, product(r), ''), r.product_slug);
  if (r.product_lot) assert(rows(r.product_lot).includes(r), 'listed lot: ' + r.product_slug);
  const document = certificateFor(r);
  if (!coaOnRequest(r) && document?.report_id) {
    assert(rows(document.report_id).includes(r), 'public report: ' + r.product_slug);
  }
}
const mismatch = record('selank');
assert.equal(batchStatus(mismatch), 'mismatch');
assert(rows(certificateFor(mismatch).report_id, { status: 'mismatch' }).includes(mismatch));
assert(!rows(certificateFor(mismatch).report_id, { status: 'matched' }).includes(mismatch));
assert.equal(rows(bpcReport, { selected: String(ss10.product_id) }).length, 0);
assert.equal(rows(bpcReport, { lot: ss10.product_lot }).length, 0);
assert.deepEqual(rows(bpcReport, { selected: String(bpc.product_id), lot: bpc.product_lot }), [bpc]);

// Search does not upgrade pending or mismatched records or borrow a sibling PDF.
assert.equal(batchStatus(ss50), 'pending');
assert.equal(certificateFor(ss50), undefined);
const pendingHTML = renderToStaticMarkup(React.createElement(BatchDetails, { record: rows('SS31 50mg')[0] }));
assert(pendingHTML.includes('not available in the published documents yet'));
assert(!pendingHTML.includes('Open original PDF') && !pendingHTML.includes(certificateFor(ss10).url));
const mismatchHTML = renderToStaticMarkup(React.createElement(BatchDetails, { record: rows('Selank 10mg')[0] }));
assert(!mismatchHTML.includes('The available certificate identifies a different lot.') && mismatchHTML.includes('Not verified for this lot'));
assert(mismatchHTML.includes(mismatch.product_lot) && mismatchHTML.includes(mismatch.certificate_lot));

// The new path inherits publication holds for contextual peptide terms and aliases.
for (const r of batchRecords.filter(r => !eligibleDiscovery(product(r)))) {
  assert.equal(batchMatchesSearch(r, product(r), product(r).name + ' peptide'), false, r.product_slug);
}
const epitalon = record('epitalon-50mg');
try {
  productReviewBlocks[epitalon.product_slug] = 'Isolated test hold';
  assert.equal(batchMatchesSearch(epitalon, product(epitalon), 'epithalon'), false);
  assert.equal(batchMatchesSearch(epitalon, product(epitalon), 'epitalon peptide'), false);
} finally { delete productReviewBlocks[epitalon.product_slug]; }

// An isolated restricted-record fixture must not expose a attached document's
// hidden lot, report, sample identity, historical facts or notes.
const restricted = batchRecords.find(coaOnRequest);
const hiddenDocument = { ...certificateFor(bpc), document_id: 'isolated-private-document', report_id: 'PRIVATE-REF-8462' };
try {
  laboratoryDocuments.push(hiddenDocument);
  const r = { ...restricted, document_id: hiddenDocument.document_id, certificate_lot: 'PRIVATE-LOT-9527',
    public_identity: 'Privateoldidentity', product_facts: { hidden: 'Privatehistoricalfact' }, review_issues: ['Privatereviewnote'] };
  for (const q of ['PRIVATE-REF-8462', 'PRIVATE-LOT-9527', 'Privateoldidentity', 'Privatehistoricalfact', 'Privatereviewnote']) {
    assert.equal(batchMatchesSearch(r, product(restricted), q), false, q);
  }
} finally { laboratoryDocuments.pop(); }
assert.equal(batchMatchesSearch(bpc, undefined, 'BPC157'), false, 'Missing catalog entry does not throw or search stale source fields');
assert.equal(batchMatchesSearch(bpc, product(ss10), bpcReport), false, 'Do not mix another product with the record');
assert.equal(JSON.stringify({ products, batchRecords, laboratoryDocuments }), before, 'No record, document, stock or product mutation');
const component = fs.readFileSync(path.join(root, 'components/store/testing.tsx'), 'utf8');
assert(component.includes('batchMatchesSearch(r,store.products.find(p=>p.id===r.product_id),q)'), 'The real Testing filter uses the helper');
assert(component.includes('maxLength={200}') && component.includes('lot, SKU or report'), 'The field describes and bounds identifier lookup');
console.log('PASS: real-catalog batch search, product notation and reviewed alias, whole public identifiers and combined queries, exact strengths/forms, pending/mismatch display, filters, publication holds, restricted metadata and unchanged source records.');
