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
const DAY = 86400000, now = Date.parse('2026-10-14T19:00:00Z'); // 12:00 Pacific
const withCoa = { id: 1, name: 'BPC-157', stockQuantity: 40, resolvedBatch: { coa_available: true } };
const noCoa = { id: 2, name: 'Lipo-C w/B12', stockQuantity: null, resolvedBatch: { coa_available: false } };
const low = { id: 3, name: 'KPV', stockQuantity: 3, resolvedBatch: { coa_available: true } };
const gone = { id: 4, name: 'NAD+', stockQuantity: 0, resolvedBatch: { coa_available: true } };
const hidden = { id: 5, name: 'Retired', stockQuantity: 0, purchasable: false, resolvedBatch: { coa_available: false } };
const products = [withCoa, noCoa, low, gone, hidden];
const order = (status, created, extra = {}) => ({ id: Math.random().toString(16).slice(2), status, total: 10000, created, data: { environment: 'authorizenet:live', items: [{ id: 1 }], ...extra } });
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
  assert.equal(byId.to_ship.count, 2); assert.equal(byId.to_ship.tone, 'urgent', 'Oldest paid order waiting 3 days is urgent'); assert.match(byId.to_ship.detail, /3 days/); assert(!/COA/.test(byId.to_ship.detail), 'COA shipping rule removed Oct 14: no blocked count');
  assert.equal(byId.label.count, 1); assert.equal(byId.review.count, 1, 'Held order needs review'); assert.equal(byId.unpaid.count, 1, 'Only this week\'s unfinished checkouts');
  assert(!work.some(w => w.id === 'test'), 'Internal tests never count');
  const items = productAttention(products, [{ items: [{ id: 2 }] }]);
  const p = Object.fromEntries(items.map(i => [i.id, i]));
  assert.equal(p.coa_blocked, undefined, 'COA shipping rule removed: nothing held'); assert.equal(p.out_of_stock.count, 1); assert.match(p.low_stock.detail, /KPV \(3\)/); assert.equal(p.no_coa, undefined, 'COA shipping rule removed: no can\'t-ship warning');
  const sales = salesWindows(orders, now, 'authorizenet:live');
  assert.deepEqual(sales.map(s => [s.label, s.orders, s.revenue]), [['Today', 1, 10000], ['Last 7 days', 4, 40000], ['Last 30 days', 5, 50000]], 'Paid buckets only, live payments only, tests and holds excluded');
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
  assert.deepEqual(o.attention, []); assert.deepEqual(o.sales.map(s => s.orders), [0, 0, 0]);
  console.log('PASS: Today home: order work from queue buckets (tests excluded, oldest age, COA-blocked count), product attention (COA holding orders, out/low stock, unsold excluded), live-only paid sales windows from Pacific midnight, setup gaps, role-limited sections, reply desk overdue list, failure never shown as all clear.');
})().catch(e => { console.error(e); process.exit(1); });
