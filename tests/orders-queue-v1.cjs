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

// A reported problem holds an order in Needs review, but never hides a test, a refund or a delivery.
const held = { issue: 'out_of_stock', note: 'fixture', by: 'fixture', at: 1 };
assert.equal(q.orderBucket(order('hold1', 'paid', { hold: held })), 'review');
assert.equal(q.orderBucket(order('hold2', 'paid', { hold: held, shipment: { status: 'in_transit' } })), 'review');
assert.equal(q.orderBucket(order('hold3', 'paid', { hold: held, internalTest: true })), 'test');
assert.equal(q.orderBucket(order('hold4', 'refunded', { hold: held })), 'closed');
assert.equal(q.orderBucket(order('hold5', 'delivered', { hold: held })), 'delivered');
assert.equal(q.orderBucket(order('hold6', 'paid', { hold: null })), 'to_ship', 'a cleared hold returns the order to its queue');

// A carrier problem outranks a delivery that already happened: a parcel delivered back to us is a
// return and a refund, and must not sit quietly in Delivered where nobody looks at it again.
assert.equal(q.orderBucket(order('rts1', 'delivered', { shipment: { status: 'return_to_sender' } })), 'review');
assert.equal(q.orderBucket(order('rts2', 'shipped', { shipment: { status: 'failure' } })), 'review');
assert.equal(q.orderBucket(order('rts3', 'paid', { shipment: { status: 'delivered' } })), 'delivered', 'a clean delivery still reads as delivered');

// A label bought but never scanned by the carrier is a parcel still on the bench. Automatic purchase
// makes that likelier, because nobody handled the order by hand and noticed.
const stale = Date.now() - fulfillment.STALLED_LABEL_MS - 60000, fresh = Date.now() - 3600000;
assert.equal(q.orderBucket(order('stall1', 'paid', { shipment: { status: 'pre_transit' }, labelCreatedAt: stale })), 'review');
assert.equal(q.orderBucket(order('stall2', 'paid', { shipment: { status: 'unknown' }, labelCreatedAt: stale })), 'review');
assert.equal(q.orderBucket(order('stall3', 'paid', { shipment: { status: 'pre_transit' }, labelCreatedAt: fresh })), 'label', 'a fresh label is not a stall');
assert.equal(q.orderBucket(order('stall4', 'shipped', { shipment: { status: 'in_transit' }, labelCreatedAt: stale })), 'shipped', 'a moving parcel is not a stall');
assert.equal(q.orderBucket(order('stall5', 'paid', { shipment: { status: 'delivered' }, labelCreatedAt: stale })), 'delivered', 'an arrival is not a stall');
assert.equal(q.orderBucket(order('stall6', 'paid', { labelCreatedAt: stale })), 'to_ship', 'no label, no stall');
assert.equal(q.orderBucket(order('stall7', 'paid', { shipment: { status: 'pre_transit' } })), 'label', 'an older label with no recorded purchase time is left alone');
assert.equal(fulfillment.stalledLabel(order('stall8', 'paid', { shipment: { status: 'pre_transit' }, labelCreatedAt: 'nonsense' })), false, 'a corrupt timestamp never raises a stall');

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
// The queue is a POST: the search term is a customer's email, phone or street address, and a query
// string is written to every proxy log and browser history in front of this app. The GET name is kept
// only to answer old bookmarks with a 405, and must not read a single order row.
const getBlock = route.slice(route.indexOf("action === 'admin-orders'"), route.indexOf("action === 'admin'"));
assert.match(getBlock, /405/);
assert(!/FROM orders/.test(getBlock), 'the retired GET never reads orders');
const postBlock = route.slice(route.indexOf("action === 'admin-orders'", route.indexOf("action.startsWith('admin-')")), route.indexOf("action === 'admin-staff'"));
assert.match(route, /'admin-orders': 'orders:read'/, 'the queue is gated on orders:read');
assert.match(route, /requireStaff\(adminActionPermission\[action\]/, 'every admin POST is gated before it runs');
assert.match(postBlock, /adminOrderView/);
assert.match(postBlock, /queryOrders\(rows, \{ tab: text\(b\.tab\), q: text\(b\.q\)/, 'the search term arrives in the body');
const admin = fs.readFileSync(path.join(root, 'components/store/admin.tsx'), 'utf8');
assert.match(admin, /<OrdersAdmin /);
const ui = fs.readFileSync(path.join(root, 'components/store/orders-admin.tsx'), 'utf8');
assert.match(ui, /allowed\('orders:fulfill'\)/); assert.match(ui, /change\('reconcile', \{ id: o\.id \}, d => toast\.info\(d\.message \|\| d\.status\)\)/); assert.match(ui, /submit\(e, 'order', d => \(\{ \.\.\.d, id: order\.id \}\), key\)/); assert.match(ui, /onChangeCapture=\{\(\) => markDraft\(key\)\}/); assert.match(ui, /allowed\('orders:reconcile'\)/);
console.log('PASS: order queue buckets, counts, search, ordering, paging, lookup and wiring');
