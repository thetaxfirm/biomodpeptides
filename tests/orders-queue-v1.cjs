// Admin order queue: buckets, counts, search, ordering, paging and single-order lookup.
// Synthetic fixtures only; no database, provider, payment or customer data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, deps = {}) {
  const filename = path.join(root, relative), m = new Module(filename, module);
  m.filename = filename;
  m.require = id => { if (deps[id]) return deps[id]; throw Error('Unexpected dependency ' + id); };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
const fulfillment = load('lib/fulfillment.ts');
const q = load('lib/order-queue.ts', { './fulfillment': fulfillment });

let t = 1000;
const order = (id, status, data = {}) => ({ id: id.padEnd(12, '0'), owner: 'fixture', status, total: 1000, created: ++t, data: { address: { name: 'Fixture ' + id, city: 'Reno', state: 'NV' }, email: id + '@example.invalid', items: [{ quantity: 2, product: { name: 'Fixture vial' } }], ...data } });
const rows = [
  order('paid1', 'paid'),
  order('paid2', 'paid', { address: { name: 'Avery Stone', city: 'Boise', state: 'ID' } }),
  order('label1', 'paid', { shipment: { status: 'pre_transit', tracking: '9400FIXTURE1', labelUrl: 'https://example.invalid/l1' } }),
  order('labeling', 'labeling'),
  order('moving', 'shipped', { shipment: { status: 'in_transit', tracking: '9400FIXTURE2', trackingUrl: 'https://example.invalid/t2' } }),
  order('storeship', 'shipped'),
  order('dlv1', 'paid', { shipment: { status: 'delivered' } }),
  order('dlv2', 'delivered'),
  order('unpaid1', 'awaiting_payment'),
  order('pend1', 'pending'),
  order('rev1', 'review'),
  order('lost1', 'shipped', { shipment: { status: 'return_to_sender' } }),
  order('refund1', 'refunded'),
  order('test1', 'paid', { internalTest: true }),
].reverse(); // the route supplies newest first

const expected = { paid1: 'to_ship', paid2: 'to_ship', label1: 'label', labeling: 'label', moving: 'shipped', storeship: 'shipped', dlv1: 'delivered', dlv2: 'delivered', unpaid1: 'unpaid', pend1: 'unpaid', rev1: 'review', lost1: 'review', refund1: 'closed', test1: 'test' };
for (const [prefix, bucket] of Object.entries(expected)) assert.equal(q.orderBucket(rows.find(o => o.id.startsWith(prefix))), bucket, prefix);

// Counts cover every bucket; All excludes internal tests.
const all = q.queryOrders(rows, { tab: 'all' });
assert.deepEqual(all.counts, { to_ship: 2, label: 2, shipped: 2, delivered: 2, unpaid: 2, review: 2, closed: 1, all: 13, test: 1 });
assert.equal(all.total, 13);
assert(all.orders.every(o => o.bucket !== 'test'), 'internal tests stay out of All');
assert.equal(all.orders[0].id.startsWith('refund1'), true, 'All is newest first');

// Default tab is To ship, oldest first so nothing waits behind newer orders.
const ship = q.queryOrders(rows, {});
assert.deepEqual(ship.orders.map(o => o.id.slice(0, 5)), ['paid1', 'paid2']);
assert.equal(q.queryOrders(rows, { tab: 'test' }).orders.length, 1);
assert.equal(q.queryOrders(rows, { tab: 'nonsense' }).orders.length, 2, 'unknown tabs fall back to To ship');

// Search: every word must match name, email, city, order number, tracking or item.
assert.deepEqual(q.queryOrders(rows, { tab: 'to_ship', q: 'avery boise' }).orders.map(o => o.id.slice(0, 5)), ['paid2']);
assert.equal(q.queryOrders(rows, { tab: 'all', q: '9400FIXTURE2' }).total, 1, 'tracking number');
assert.equal(q.queryOrders(rows, { tab: 'all', q: '#UNPAID1' }).total, 1, 'order number with # and any case');
assert.equal(q.queryOrders(rows, { tab: 'all', q: 'nobody-here' }).total, 0);
assert.equal(q.queryOrders(rows, { tab: 'all', q: 'avery' }).counts.all, 13, 'tab counts ignore the search');

// Paging.
const p1 = q.queryOrders(rows, { tab: 'all', limit: 5 }), p3 = q.queryOrders(rows, { tab: 'all', limit: 5, offset: 10 });
assert.equal(p1.orders.length, 5); assert.equal(p1.hasMore, true);
assert.equal(p3.orders.length, 3); assert.equal(p3.hasMore, false);
assert.equal(q.queryOrders(rows, { tab: 'all', limit: 1000 }).limit, 100, 'page size is capped');

// Single-order lookup ignores the tab so the details panel follows a changed order.
const one = q.queryOrders(rows, { tab: 'to_ship', id: rows.find(o => o.id.startsWith('moving')).id });
assert.equal(one.orders.length, 1); assert.equal(one.orders[0].bucket, 'shipped');
assert.equal(q.queryOrders(rows, { id: 'bad id!' }).orders.length, 2, 'invalid ids are ignored');

// Scan limit is reported, never silent.
const many = Array.from({ length: q.scanLimit + 1 }, (_, n) => ({ id: 'bulk' + String(n).padStart(8, '0'), status: 'paid', total: 1, created: n, data: {} }));
const capped = q.queryOrders(many, { tab: 'all' });
assert.equal(capped.truncated, true); assert.equal(capped.scanned, q.scanLimit);

// Customer labels never claim more than the carrier reported.
assert.equal(q.customerOrderStatus(rows.find(o => o.id.startsWith('label1'))).label, 'Preparing shipment');
assert.equal(q.customerOrderStatus(rows.find(o => o.id.startsWith('paid1'))).label, 'Processing');
assert.equal(q.customerOrderStatus(rows.find(o => o.id.startsWith('refund1'))).label, 'Refunded');
assert.equal(q.customerOrderStatus(rows.find(o => o.id.startsWith('unpaid1'))).label, 'Awaiting payment');

// Wiring: the route checks order access, and the admin tab uses the queue.
const route = fs.readFileSync(path.join(root, 'app/api/store/[action]/route.ts'), 'utf8');
const block = route.slice(route.indexOf("action === 'admin-orders'"), route.indexOf("action === 'admin'"));
assert.match(block, /requireStaff\('orders:read'\)/);
assert.match(block, /adminOrderView/);
const admin = fs.readFileSync(path.join(root, 'components/store/admin.tsx'), 'utf8');
assert.match(admin, /<OrdersAdmin /);
const ui = fs.readFileSync(path.join(root, 'components/store/orders-admin.tsx'), 'utf8');
assert.match(ui, /allowed\('orders:fulfill'\)/); assert.match(ui, /change\('reconcile', \{ id: o\.id \}, d => toast\.info\(d\.message \|\| d\.status\)\)/); assert.match(ui, /submit\(e, 'order', d => \(\{ \.\.\.d, id: order\.id \}\), key\)/); assert.match(ui, /onChangeCapture=\{\(\) => markDraft\(key\)\}/); assert.match(ui, /allowed\('orders:reconcile'\)/);
console.log('PASS: order queue buckets, counts, search, ordering, paging, lookup and wiring');
