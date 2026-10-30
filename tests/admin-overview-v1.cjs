/* "Today" home: attention items, sales and setup reuse the tab rules. Pure functions, synthetic orders/products. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
const original = Module._load;
let overdue = [];
Module._load = function (request, parent, isMain) {
  if (parent?.filename.endsWith('admin-overview.ts') && request === './reply-overdue') return { overdueCustomers: async () => { if (overdue === 'fail') throw Error('db'); return overdue; } };
  return original.call(this, request, parent, isMain);
};
const { adminOverview, orderAttention, productAttention, salesWindows, setupAttention } = require(path.join(__dirname, '../lib/admin-overview.ts'));
const { applyAvailability, sourcePublicationHold } = require('../lib/availability.ts');
const catalogProducts = require('../lib/catalog.ts').products;
const normalized = fields => applyAvailability({ ...catalogProducts.find(p => p.slug === 'bpc-157-10mg'), inStock: true, purchasable: true, availability: 'available', ...fields });
const DAY = 86400000, now = Date.parse('2026-10-14T19:00:00Z'); // 12:00 Pacific
const withCoa = normalized({ id: 1, name: 'BPC-157', stockQuantity: 40, resolvedBatch: { coa_available: true } } );
const noCoa = normalized({ id: 2, name: 'Lipo-C w/B12', stockQuantity: null, resolvedBatch: { coa_available: false } } );
const low = normalized({ id: 3, name: 'KPV', stockQuantity: 3, resolvedBatch: { coa_available: true } } );
const gone = normalized({ id: 4, name: 'NAD+', stockQuantity: 0, resolvedBatch: { coa_available: true } } );
const hidden = normalized({ id: 5, name: 'Retired', stockQuantity: 0, purchasable: false, resolvedBatch: { coa_available: false } } );
const products = [withCoa, noCoa, low, gone, hidden];
const order = (status, created, extra = {}) => ({ id: Math.random().toString(16).slice(2), status, total: 10000, created, payment_ref: 'fixture-payment', notification_id: 'fixture-notification', data: { environment: 'authorizenet:live', items: [{ id: 1 }], ...extra } });
const orders = [
  order('paid', now - 3 * DAY), order('paid', now - 1000, { items: [{ id: 2 }] }),
  order('paid', now - 2 * DAY, { shipment: { status: 'pre_transit' } }),
  order('shipped', now - 5 * DAY), order('delivered', now - 20 * DAY), order('awaiting_payment', now - DAY), order('awaiting_payment', now - 10 * DAY),
  order('paid', now - DAY, { hold: { issue: 'out_of_stock' } }), order('paid', now - 100, { internalTest: true }),
  order('delivered', now - 2 * DAY, { environment: 'authorizenet:sandbox' }),
];
(async () => {
  const work = orderAttention(orders, products, now);
  const byId = Object.fromEntries(work.map(w => [w.id, w]));
  assert.equal(byId.to_ship.count, 3); assert.equal(byId.to_ship.tone, 'urgent', 'Oldest paid order waiting 3 days is urgent'); assert.match(byId.to_ship.detail, /3 days/); assert(!/COA/.test(byId.to_ship.detail), 'COA shipping rule removed Oct 14: no blocked count');
  assert.equal(byId.label, undefined, 'label-ready orders belong to the same Pack & ship count');
  // Owner, Oct 30 2026: an out-of-stock hold is a back order, with its own card, not attention.
  assert.equal(byId.review, undefined, 'the held order is no longer counted as attention');
  assert.equal(byId.backorder.count, 1, 'it is counted as waiting on stock'); assert.match(byId.backorder.title, /waiting on stock/);
  assert.equal(byId.unpaid.count, 2, 'Dashboard and queue include the same unarchived checkouts'); assert.match(byId.unpaid.title, /abandoned cart/);
  assert(!work.some(w => w.id === 'test'), 'Internal tests never count');
  const { queryOrders } = require('../lib/order-queue.ts');
  const mixed = [...orders,
    order('paid', now - DAY, { shipment: { status: 'pre_transit' }, handoff: { at: now - 1000 } }),
    order('paid', now - DAY, { archivedAt: now - 1000 }),
    order('paid', now - DAY, { paymentVerified: { at: now, state: 'failed' } }),
    order('shipped', now - 6 * DAY, { shipment: { status: 'return_to_sender' }, dismissed: { at: now, carrierStatus: 'return_to_sender' } }),
  ];
  const sharedCounts = queryOrders(mixed, { tab: 'all' }, now).counts;
  for (const card of orderAttention(mixed, products, now)) assert.equal(card.count, sharedCounts[card.id], card.id + ' dashboard count matches order queue');
  const items = productAttention(products, [{ items: [{ id: 2 }] }]);
  const p = Object.fromEntries(items.map(i => [i.id, i]));
  assert.equal(p.coa_blocked, undefined, 'COA shipping rule removed: nothing held'); assert.equal(p.out_of_stock.count, 1); assert.match(p.low_stock.detail, /KPV \(3\)/); assert.equal(p.no_coa, undefined, 'COA shipping rule removed: no can\'t-ship warning');
  const sales = salesWindows(orders, now);
  assert.deepEqual(sales.map(s => [s.label, s.live.paymentRecorded, s.live.grossCents]), [['Today', 1, 10000], ['Last 7 days', 5, 50000], ['Last 30 days', 6, 60000]], 'Recorded live payment states count even when fulfillment is held; sandbox and internal tests stay out');
  // Real normalized availability, including zero stock and an explicitly sold-out product.
  const sold = normalized({ id: 90001, name: 'Explicit sold out', availability: 'sold_out', stockQuantity: 12 });
  const notInStock = normalized({ id: 90002, name: 'Out of stock', inStock: false, stockQuantity: 12 });
  const coming = normalized({ id: 90003, name: 'Coming soon', availability: 'coming_soon', stockQuantity: 0 });
  const held = normalized({ ...catalogProducts.find(sourcePublicationHold), stockQuantity: 0 });
  assert.equal(gone.inStock, false, 'The fixture passes through the production catalog normalization');
  assert.equal(sold.purchasable, false);
  const normalizedWork = productAttention([gone, sold, notInStock, coming, held, hidden, low], []);
  assert.equal(normalizedWork.find(w => w.id === 'out_of_stock').count, 3, 'Normalized sold-out products count; holds, coming soon and unavailable do not');
  assert.equal(normalizedWork.find(w => w.id === 'low_stock').count, 1);

  // Payment status and saved evidence are independent of carrier progress and today's provider.
  const paidToday = status => order(status, now - 1000);
  const classified = [
    order('paid', now - 1000, { hold: { issue: 'out_of_stock' } }),
    paidToday('labeling'), order('shipped', now - 1000, { shipment: { status: 'failure' } }), paidToday('delivered'),
    order('paid', now - 1000, { environment: 'live' }),
    ...['cancelled', 'canceled', 'refunded', 'failed', 'awaiting_payment', 'pending', 'review'].map(paidToday),
    order('paid', now - 1000, { internalTest: true }),
    { ...paidToday('paid'), payment_ref: ' ' }, { ...paidToday('paid'), notification_id: null },
    order('paid', now - 1000, { environment: 'sandbox' }), order('paid', now - 1000, { environment: 'authorizenet:sandbox' }),
    order('paid', now - 1000, { environment: undefined }), order('paid', now - 1000, { environment: 'unrecognized' }),
    order('paid', now + 1), order('paid', now - 31 * DAY),
  ];
  const savedBefore = JSON.stringify(classified);
  const classifiedSales = salesWindows(classified, now)[2];
  assert.deepEqual(classifiedSales.live, { orders: 7, paymentRecorded: 5, grossCents: 50000, missingPaymentRecords: 2 });
  assert.equal(classifiedSales.orders, classifiedSales.live.paymentRecorded, 'Already-open admin bundles retain the evidenced live count');
  assert.equal(classifiedSales.revenue, classifiedSales.live.grossCents, 'Already-open admin bundles retain evidenced live gross');
  assert.deepEqual(classifiedSales.sandbox, { orders: 2, paymentRecorded: 2, grossCents: 20000, missingPaymentRecords: 0 });
  assert.deepEqual(classifiedSales.unknown, { orders: 2, paymentRecorded: 2, grossCents: 20000, missingPaymentRecords: 0 });
  assert.equal(JSON.stringify(classified), savedBefore, 'Historical order and receipt snapshots remain immutable');
  // Cross-check against the established Sales diagnostics SQL, not a second copy of the classifier.
  const { DatabaseSync } = require('node:sqlite');
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE orders(status TEXT,total INTEGER,created INTEGER,data TEXT,payment_ref TEXT,notification_id TEXT)');
  for (const o of classified) sql.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(o.status, o.total, o.created, JSON.stringify(o.data), o.payment_ref ?? null, o.notification_id ?? null);
  const { diagnosticSql } = require('../lib/sales-diagnostics.ts');
  const diagnosticRows = sql.prepare(diagnosticSql.orders).all(now - 30 * DAY, now + 1);
  for (const environment of ['live', 'sandbox', 'unknown']) {
    const rows = diagnosticRows.filter(row => row.environment === environment);
    for (const key of ['paymentRecorded', 'grossCents', 'missingPaymentRecords']) assert.equal(classifiedSales[environment][key], rows.reduce((sum, row) => sum + row[key], 0), environment + ' ' + key + ' agrees with Sales diagnostics');
  }
  sql.close();
  for (const [instant, midnight] of [['2026-03-08T20:00:00Z', '2026-03-08T08:00:00Z'], ['2026-11-01T20:00:00Z', '2026-11-01T07:00:00Z']]) {
    const at = Date.parse(instant), start = Date.parse(midnight);
    const bounded = salesWindows([order('paid', start - 1), order('paid', start), order('paid', at), order('paid', at + 1)], at);
    assert.equal(bounded[0].live.paymentRecorded, 2, 'Pacific midnight remains correct on the DST transition day; future records excluded');
  }
  const boundary = salesWindows([order('paid', now - 7 * DAY), order('paid', now - 7 * DAY - 1), order('paid', now - 30 * DAY), order('paid', now - 30 * DAY - 1)], now);
  assert.deepEqual(boundary.map(w => w.live.paymentRecorded), [0, 1, 3], 'Rolling window lower boundaries are inclusive');
  assert.equal(setupAttention({ carriers: [] }, 'authorizenet:live')[0].id, 'shipping', 'Shipping not set up is flagged');
  assert.equal(setupAttention({ services: [{ enabled: false }] }, 'authorizenet:live')[0].id, 'shipping_off');
  assert.deepEqual(setupAttention({ services: [{ enabled: true }] }, 'authorizenet:live'), [], 'Live payments and set-up shipping raise nothing');
  assert.equal(setupAttention({ services: [{ enabled: true }] }, 'authorizenet:sandbox')[0].id, 'payments');
  // Whole overview: role limits, overdue customers from the reply desk's own rule, urgent first.
  overdue = [{ name: 'Albert', email: 'a@example.invalid', since: now - 6 * DAY, count: 3 }, { name: '', email: 'r@example.invalid', since: now - 5 * DAY, count: 1 }];
  let o = await adminOverview({}, { orders, products, shipping: { services: [{ enabled: true }] }, environment: 'authorizenet:live', access: { orders: true, requests: true, reports: true, store: true }, now });
  assert.equal(o.attention[0].tone, 'urgent'); assert.match(o.attention.find(a => a.id === 'requests').detail, /Albert \(6 days\), r@example.invalid \(5 days\)/);
  assert(o.sales && o.attention.some(a => a.tab === 'products'));
  o = await adminOverview({}, { orders, products, shipping: {}, environment: 'authorizenet:live', access: { orders: true, requests: false, reports: false, store: false }, now });
  assert.equal(o.sales, null, 'Fulfillment and support never see sales'); assert(!o.attention.some(a => a.tab === 'products' || a.tab === 'requests')); assert.deepEqual(o.setup, []);
  overdue = 'fail'; o = await adminOverview({}, { orders: [], products: [], shipping: { services: [{ enabled: true }] }, environment: 'authorizenet:live', access: { orders: true, requests: true, reports: true, store: true }, now });
  assert.equal(o.attention[0].id, 'requests_error', 'A failed request check is said, never shown as all clear');
  overdue = []; o = await adminOverview({}, { orders: [], products: [], shipping: { services: [{ enabled: true }] }, environment: 'authorizenet:live', access: { orders: true, requests: true, reports: true, store: true }, now });
  assert.deepEqual(o.attention, []); assert.deepEqual(o.sales.map(s => s.live.paymentRecorded), [0, 0, 0]);
  assert.deepEqual(o.sales.map(s => [s.orders, s.revenue]), [[0, 0], [0, 0], [0, 0]], 'Legacy aliases remain numeric in empty windows');
  console.log('PASS: normalized stock alerts, payment evidence/environment cohorts match Sales diagnostics, immutable history, Pacific DST and bounded windows; Today home: order work from queue buckets (tests excluded, oldest age, COA-blocked count), product attention (COA holding orders, out/low stock, unsold excluded), live-only paid sales windows from Pacific midnight, setup gaps, role-limited sections, reply desk overdue list, failure never shown as all clear.');
})().catch(e => { console.error(e); process.exit(1); });
