// Track page: carrier scans beside the shipping label, ready to copy (owner, Nov 8 2026).
// Synthetic fixtures only; no database, carrier, label host or customer data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name; m.require = id => { throw Error('Unexpected dependency ' + id); };
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { module: 1, target: 9 } }).outputText, name);
  return m.exports;
}
const p = load('lib/parcel-sheet.ts');

// Scans read as the carrier page shows them: local clock time as written, newest first, grouped by day.
const tracker = { status: 'failure', est_delivery_date: '2026-11-02T00:00:00Z', tracking_details: [
  { datetime: '2026-10-29T00:13:00Z', message: 'PROCESSED THROUGH FACILITY', tracking_location: {} },
  { datetime: '2026-11-02T06:55:00Z', message: 'ADDRESS NOT FOUND', tracking_location: { city: 'FIXTURE CITY', state: 'ZZ' } },
  { datetime: '2026-10-31T12:14:00Z', message: 'ARRIVE FACILITY', tracking_location: { city: 'HUB', state: 'ZZ' } },
  { datetime: 'not a date', message: 'dropped' },
  { datetime: '2026-10-30T09:00:00Z', message: '   ' },
  { datetime: '2026-10-28T19:59:00Z', status: 'pre_transit', tracking_location: { city: 'ORIGIN', state: 'NV' } },
] };
const history = p.trackingHistory(tracker);
assert.equal(history.status, 'Delivery failed');
assert.equal(history.estimated, 'November 2, 2026');
assert.deepEqual(history.events.map(e => [e.date, e.time, e.message, e.place]), [
  ['November 2, 2026', '6:55 AM', 'ADDRESS NOT FOUND', 'FIXTURE CITY, ZZ'],
  ['October 31, 2026', '12:14 PM', 'ARRIVE FACILITY', 'HUB, ZZ'],
  ['October 29, 2026', '12:13 AM', 'PROCESSED THROUGH FACILITY', ''],
  ['October 28, 2026', '7:59 PM', 'Label created, not scanned yet', 'ORIGIN, NV'],
]);
assert.deepEqual(p.trackingHistory(null), { status: 'No carrier status', estimated: '', events: [] }, 'Unknown shapes give an empty list');
assert.deepEqual(p.trackingHistory({ tracking_details: 'nope' }).events, []);

// The label is only ever read from EasyPost's own https file host.
assert.equal(p.labelSource('https://easypost-files.s3.us-west-2.amazonaws.com/files/postage_label/x.png'), 'https://easypost-files.s3.us-west-2.amazonaws.com/files/postage_label/x.png');
assert.equal(p.labelSource('https://easypost-files.s3.amazonaws.com/x.png') !== null, true);
for (const bad of ['http://easypost-files.s3.us-west-2.amazonaws.com/x.png', 'https://evil.example/x.png', 'https://easypost-files.s3.amazonaws.com.evil.example/x.png', 'https://other-bucket.s3.amazonaws.com/x.png', 'javascript:alert(1)', '', null])
  assert.equal(p.labelSource(bad), null, String(bad));

const order = { id: 'abcdef12-0000-4000-8000-000000000000', data: { address: { name: 'Fixture Person', city: 'Fixture City', state: 'ZZ' }, shipment: {
  service: 'USPS Priority', tracking: '9400FIXTURE', trackingUrl: 'https://track.example.invalid/t', labelUrl: 'https://easypost-files.s3.us-west-2.amazonaws.com/fixture.png', insuredCents: 5000, signature: 'SIGNATURE' } } };
const entry = p.parcelEntry(order);
assert.equal(entry.number, '#ABCDEF12');
assert.equal(entry.labelSrc, '/api/admin/parcel?id=abcdef12-0000-4000-8000-000000000000&label=png', 'The page shows the label through this site, so it can be copied');
assert.equal(entry.labelFile, 'Order ABCDEF12 label.png');
assert.equal(entry.protection, 'Insured $50.00 · Signature required');
assert.equal(p.parcelEntry({ ...order, data: { shipment: { labelUrl: 'https://evil.example/x.png' } } }).labelSrc, null);

// Copy text: order line, status, then each day's scans.
assert.equal(p.historyText(entry, history), [
  'Order #ABCDEF12 · USPS Priority · Tracking 9400FIXTURE', 'Carrier status: Delivery failed',
  '', 'November 2, 2026', '6:55 AM  ADDRESS NOT FOUND · FIXTURE CITY, ZZ',
  '', 'October 31, 2026', '12:14 PM  ARRIVE FACILITY · HUB, ZZ',
  '', 'October 29, 2026', '12:13 AM  PROCESSED THROUGH FACILITY',
  '', 'October 28, 2026', '7:59 PM  Label created, not scanned yet · ORIGIN, NV',
].join('\n'));
assert.match(p.historyText(entry, null), /Carrier history unavailable/);

// The page: history beside the label, copy/download/print, everything escaped.
const html = p.renderParcelSheet(entry, history);
for (const piece of ['Tracking history', 'Shipping label', 'id="copyHistory"', 'id="copyLabel"', 'Download label', 'Print or save as PDF', 'Open carrier page', 'grid-template-columns:minmax(0,1fr) minmax(300px,440px)', '<strong data-problem>Delivery failed</strong>'])
  assert(html.includes(piece), piece);
assert.match(html, /<img id="labelImage" src="\/api\/admin\/parcel\?id=abcdef12-0000-4000-8000-000000000000&amp;label=png"/);
assert.match(html, /download="Order ABCDEF12 label.png"/);
assert(!html.includes('easypost-files'), 'The saved label link itself is not written into the page');
assert(html.indexOf('ADDRESS NOT FOUND') < html.indexOf('ARRIVE FACILITY'), 'Newest scan first');
const hostile = p.renderParcelSheet({ ...entry, customer: '<script>x</script>' }, p.trackingHistory({ tracking_details: [{ datetime: '2026-11-01T01:00:00Z', message: '<img src=x onerror=alert(1)>' }] }));
assert(!hostile.includes('<script>x') && !hostile.includes('<img src=x'), 'Customer and carrier text is escaped');
assert.match(p.renderParcelSheet(entry, null, 'The carrier history could not be read just now.'), /could not be read just now/);
assert.doesNotMatch(p.renderParcelSheet(entry, null, 'x'), /id="copyHistory"/, 'No copy button without a history');

// Wiring: staff only, the saved label only, images only, read-only; every admin Track link opens this page.
const route = fs.readFileSync(path.join(root, 'app/api/admin/parcel/route.ts'), 'utf8');
assert.match(route, /requireStaff\('orders:read'\)/);
assert.match(route, /const source = labelSource\(shipment\.labelUrl\);/);
assert.match(route, /file = await fetch\(source\)/);
assert.match(route, /\['image\/png', 'image\/jpeg', 'image\/gif'\]\.includes\(type\)/);
assert.doesNotMatch(route, /\brun\(|auditRun|UPDATE |INSERT |DELETE |send[A-Z]\w*\(|method: .POST/, 'The Track page changes and sends nothing');
const easypost = fs.readFileSync(path.join(root, 'lib/easypost.ts'), 'utf8');
assert.match(easypost, /export async function readShipmentTracker[\s\S]{0,400}shipment\.mode !== 'production'/);
assert.match(fs.readFileSync(path.join(root, 'components/store/customer-orders.tsx'), 'utf8'), /href=\{trackPageUrl\(order\.id\)\}[^>]*>Track</);
assert.match(fs.readFileSync(path.join(root, 'components/store/orders-admin.tsx'), 'utf8'), /href=\{'\/api\/admin\/parcel\?id=' \+ encodeURIComponent\(o\.id\)\}[^>]*>Track</);
assert.match(fs.readFileSync(path.join(root, 'components/store/shipping-admin.tsx'), 'utf8'), /href=\{'\/api\/admin\/parcel\?id=' \+ encodeURIComponent\(order\.id\)\}[^>]*>Track</);
console.log('PASS: carrier scans as written and newest first, EasyPost-only label source, copy text, side-by-side page with copy/download/print, escaping, read-only staff route, Track links');
