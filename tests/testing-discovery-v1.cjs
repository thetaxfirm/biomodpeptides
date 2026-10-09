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


const { products } = require('../lib/catalog.ts');
const { batchRecords, batchStatus, certificateFor, coaOnRequest, coaRequestNotice } = require('../lib/testing.ts');
const { Testing } = require('../components/store/testing.tsx');
const { StoreProvider } = require('../components/store/provider.tsx');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const render = (props = {}) => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(Testing, props)));
const html = render();
const records = [...html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)];
assert.equal(records.length, batchRecords.length, 'all original records have native disclosures in initial HTML');
const counts = { publicPDF: 0, pending: 0, mismatch: 0, restricted: 0 };
for (let i = 0; i < records.length; i++) {
  const [, attributes, body] = records[i], record = batchRecords[i];
  assert(!/\bopen=/.test(attributes), 'unfiltered records start collapsed');
  assert(body.includes('<summary') && body.includes(escape(record.product_name)), 'the native summary names the product');
  assert(body.includes('href="/product/' + record.product_slug + '"'), 'product links exist before hydration');
  const certificate = certificateFor(record);
  if (coaOnRequest(record)) {
    counts.restricted++;
    assert(body.includes(escape(coaRequestNotice)) && !body.includes('Open original PDF'), 'existing document restrictions take precedence');
  } else if (!certificate) {
    counts.pending++;
    assert(body.includes('An original certificate for this listed lot is not available') && !body.includes('Open original PDF'), 'pending is explicit, no fabricated link');
  } else {
    counts.publicPDF++;
    assert(body.includes('href="' + escape(certificate.url) + '"'), 'the original source URL is in the initial response');
    if (batchStatus(record) === 'mismatch') {
      counts.mismatch++;
      assert(body.includes('The available certificate identifies a different lot.') && body.includes('Not verified for this lot'), 'mismatch remains explicit');
    }
  }
}
for (const record of batchRecords) {
  const selected = render({ product: String(record.product_id) });
  assert.equal((selected.match(/<details\b/g) || []).length, 1, 'product filter keeps one record');
  assert(/<details[^>]* open=""/.test(selected), 'selected records are open without JavaScript');
}
const lotRecord = batchRecords.find(record => record.product_lot);
assert(render({ product: String(lotRecord.product_id), lot: lotRecord.product_lot }).includes('open=""'), 'deep product-lot links open the record');
assert(!html.includes('data-slot="accordion"'), 'documentation no longer depends on an accordion hydration step');
for (const count of Object.values(counts)) assert(count > 0);
console.log('PASS: testing library initial HTML exposes ' + records.length + ' native records, ' + counts.publicPDF + ' original PDF links; missing, mismatch and restricted states preserved; product and lot filters render open.');
