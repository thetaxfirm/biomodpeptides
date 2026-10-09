// Aggregate fixtures only. No production data, database writes or network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename);
const { salesDiagnosticsExport } = require('../lib/sales-diagnostics-export.ts');
const secret = 'FIXTURE_PRIVATE_VALUE_MUST_NOT_EXPORT';
const report = {
  asOf: Date.parse('2026-10-09T18:32:15.123Z'),
  window: { days: 7, start: Date.parse('2026-10-02T00:00:00Z'), end: Date.parse('2026-10-09T00:00:00Z'), timeZone: 'UTC' },
  classification: 'unclassified',
  orders: [
    { dayUtc: '2026-10-02', environment: 'live', status: 'paid', orders: 3, paymentRecorded: 2, grossCents: 12345, missingPaymentRecords: 1, email: secret, data: { address: secret } },
    { dayUtc: '2026-10-03', environment: 'sandbox', status: 'review', orders: 1, paymentRecorded: 0, grossCents: 0, missingPaymentRecords: 0 },
    { dayUtc: '2026-10-04', environment: 'unknown', status: 'unknown', orders: 1, paymentRecorded: 0, grossCents: 0, missingPaymentRecords: 0 },
  ],
  requests: [{ dayUtc: '2026-10-05', kind: 'quote', records: 5, owner: secret }],
  unresolvedOrders: [{ environment: 'live', status: 'review', records: 1, oldestCreated: Date.parse('2026-08-01T03:04:05Z') }],
  cartConflicts: { records: 2, oldestCreated: Date.parse('2026-10-09T02:00:00Z'), sessionId: secret },
  customer: secret,
};
const before = JSON.stringify(report);
function parseCsv(input) {
  const result = [], row = []; let cell = '', quoted = false;
  input = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && c === '\r' && input[i + 1] === '\n') { row.push(cell); result.push([...row]); row.length = 0; cell = ''; i++; }
    else cell += c;
  }
  assert.equal(quoted, false); assert.equal(cell, '');
  const header = result.shift();
  assert(result.every(row => row.length === header.length), 'CSV retains one rectangular schema');
  return result.map(row => Object.fromEntries(header.map((column, index) => [column, row[index]])));
}
const file = salesDiagnosticsExport(report);
assert.equal(file.filename, 'biomod-sales-diagnostics-20261009T183215123Z-v1.csv');
assert(file.csv.startsWith('\uFEFF'), 'Excel-friendly UTF-8 BOM');
assert.equal(JSON.stringify(report), before, 'export never mutates the fetched report');
assert(!file.csv.includes(secret), 'unknown fields and raw private data are never serialized');
const rows = parseCsv(file.csv);
const metadata = Object.fromEntries(rows.filter(r => r.record_type === 'metadata').map(r => [r.metadata_key, r.metadata_value]));
assert.equal(metadata.window_start_utc_inclusive, '2026-10-02T00:00:00.000Z');
assert.equal(metadata.window_end_utc_exclusive, '2026-10-09T00:00:00.000Z');
assert.equal(metadata.as_of_utc, '2026-10-09T18:32:15.123Z');
assert.equal(metadata.period_days, '7'); assert.equal(metadata.time_zone, 'UTC'); assert.equal(metadata.currency, 'USD');
assert.equal(metadata.classification, 'unclassified');
assert.match(metadata.measurement_scope, /No visitor, people, traffic-source or conversion-rate/);
assert.match(metadata.order_cohort, /not daily sales/);
assert.match(metadata.customer_test_classification, /live payment can still be an internal test/);
assert.match(metadata.gross_scope, /includes tax and shipping.*not net revenue.*refunds/);
assert.match(metadata.request_scope, /Failed quotes are not recorded/);
assert.match(metadata.unresolved_scope, /all dates, including today/);
const orderRows = rows.filter(r => r.record_type === 'orders');
assert.deepEqual(orderRows.map(r => r.environment), ['live', 'sandbox', 'unknown']);
assert.equal(orderRows[0].orders, '3'); assert.equal(orderRows[0].payment_recorded, '2');
assert.equal(orderRows[0].gross_cents, '12345'); assert.equal(orderRows[0].missing_payment_records, '1');
assert(rows.every(r => r.classification === 'unclassified'));
assert.equal(rows.find(r => r.record_type === 'requests').records, '5');
assert.equal(rows.find(r => r.record_type === 'unresolved_orders').oldest_created_utc, '2026-08-01T03:04:05.000Z');
assert.equal(rows.find(r => r.record_type === 'cart_conflicts').oldest_created_utc, '2026-10-09T02:00:00.000Z');
const empty = parseCsv(salesDiagnosticsExport({ ...report, orders: [], requests: [], unresolvedOrders: [], cartConflicts: { records: 0, oldestCreated: null } }).csv);
assert.equal(empty.filter(r => r.record_type === 'orders').length, 0);
assert.equal(empty.find(r => r.record_type === 'cart_conflicts').records, '0');
assert.equal(empty.find(r => r.record_type === 'cart_conflicts').oldest_created_utc, '');
for (const value of ['=HYPERLINK("https://example.invalid","x")', ' +1+1', '-2+3', '@SUM(1,2)', '\t=1+1', '\rabc', '\nabc', ' \t@SUM(1)']) {
  const altered = { ...report, orders: [{ ...report.orders[0], status: value }] };
  assert.equal(parseCsv(salesDiagnosticsExport(altered).csv).find(r => r.record_type === 'orders').status_or_kind, "'" + value, 'spreadsheet formula is inert');
}
const escaped = 'value with "quotes", commas\nand a newline';
assert.equal(parseCsv(salesDiagnosticsExport({ ...report, orders: [{ ...report.orders[0], status: escaped }] }).csv).find(r => r.record_type === 'orders').status_or_kind, escaped);

// Exercise the actual Download CSV click handler with browser primitives stubbed locally.
const originalLoad = Module._load;
const realReact = require('react');
let hookValues, emittedBlob, clicked = 0, removed = 0, revoked = 0, scheduled;
const anchor = { href: '', download: '', click() { clicked++; }, remove() { removed++; } };
const originals = { document: global.document, setTimeout: global.setTimeout, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
Module._load = function(name, parent, isMain) {
  if (name === 'react') return { ...realReact, useState: () => [hookValues.shift(), () => {}], useEffect: () => {} };
  if (name === '@/lib/sales-diagnostics-export') return { salesDiagnosticsExport };
  if (name === '@/lib/catalog') return { money: value => String(value) };
  if (name === './provider') return { api: () => { throw Error('No network in export test'); } };
  if (name === '@/components/ui/table') return Object.fromEntries(['Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell'].map(name => [name, name]));
  if (name.endsWith('.module.css')) return {};
  return originalLoad.call(this, name, parent, isMain);
};
function findExportButton(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button' && node.props.children === 'Download CSV') return node;
  for (const child of [node.props?.children].flat(Infinity)) { const match = findExportButton(child); if (match) return match; }
  return null;
}
try {
  global.document = { createElement: tag => { assert.equal(tag, 'a'); return anchor; }, body: { appendChild: link => assert.equal(link, anchor) } };
  global.setTimeout = (fn, delay) => { assert.equal(delay, 1000); scheduled = fn; return 1; };
  URL.createObjectURL = blob => { emittedBlob = blob; return 'blob:fixture'; };
  URL.revokeObjectURL = url => { assert.equal(url, 'blob:fixture'); revoked++; };
  const { SalesDiagnostics } = require('../components/store/sales-diagnostics.tsx');
  hookValues = ['7', 0, null, true, ''];
  assert.equal(findExportButton(SalesDiagnostics()).props.disabled, true, 'no export while loading or without an authorized report');
  hookValues = ['7', 0, report, false, ''];
  const button = findExportButton(SalesDiagnostics());
  assert.equal(button.props.disabled, false); button.props.onClick();
  assert.equal(clicked, 1); assert.equal(removed, 1); assert.equal(revoked, 0);
  assert.equal(anchor.download, file.filename); assert.equal(anchor.href, 'blob:fixture');
  assert.equal(emittedBlob.type, 'text/csv;charset=utf-8');
  scheduled(); assert.equal(revoked, 1);
} finally {
  Module._load = originalLoad;
  global.document = originals.document; global.setTimeout = originals.setTimeout;
  URL.createObjectURL = originals.createObjectURL; URL.revokeObjectURL = originals.revokeObjectURL;
}
console.log('PASS: diagnostic CSV preserves reporting windows, environments, unclassified status, evidence limitations, cents and empty states; excludes private fields; escapes CSV/formulas; real download handler and Blob cleanup');
