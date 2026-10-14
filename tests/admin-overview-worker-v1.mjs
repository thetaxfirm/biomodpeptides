// Compiled admin overview routes on isolated D1. Only synthetic auth is allowed
// outbound; no production bindings, order data, or provider credentials are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { migrationStatements } from './sql-migration-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(root, 'dist/server');
const config = JSON.parse(await fs.readFile(path.join(built, 'wrangler.json'), 'utf8'));
const modules = (await fs.readdir(built, { recursive: true })).filter(name => /\.(?:m?js)$/.test(name));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trybiomod-admin-overview-worker-'));
const origin = 'https://trybiomod.com', DAY = 86400000;
const users = Object.fromEntries(['owner', 'manager', 'support', 'fulfillment', 'customer'].map(role => [role, {
  id: randomUUID(), email: `${role}@example.invalid`, email_confirmed_at: '2026-01-01',
  user_metadata: { name: `Synthetic ${role}` },
}]));
let db, forbidden = 0;
const referenceValues = [], orderIds = [];
const mf = new Miniflare({
  name: 'isolated-admin-overview', cf: false,
  modules: [config.main, ...modules.filter(name => name !== config.main)].map(name => ({ type: 'ESModule', path: path.join(built, name) })),
  modulesRoot: built, compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  // Current runtime environment intentionally differs from saved live orders.
  // Reporting must use the saved environment, never today's payment setting.
  bindings: { SUPABASE_URL: 'https://auth.example.invalid', SUPABASE_ANON_KEY: 'fixture-only', STORE_ADMIN_EMAILS: users.owner.email, AUTHORIZENET_ENVIRONMENT: 'sandbox' },
  d1Databases: { DB: 'isolated-admin-overview' }, d1Persist: path.join(temporary, 'd1'),
  outboundService: async request => {
    if (request.url === 'https://auth.example.invalid/auth/v1/user' && request.method === 'GET') {
      const role = request.headers.get('authorization')?.replace(/^Bearer fixture-/, '');
      assert(users[role], 'Only explicit synthetic auth tokens may be used');
      return Response.json(users[role]);
    }
    forbidden++;
    throw Error('Live outbound request prohibited in admin overview fixture');
  },
  log: new Log(LogLevel.ERROR),
});

const assertNoOrderDisclosure = body => {
  const text = JSON.stringify(body);
  for (const value of [...referenceValues, ...orderIds]) assert(!text.includes(value), 'Aggregate response must not disclose order IDs or payment references');
  assert(!/"(?:payment_ref|paymentRef|notification_id|notificationId|checkout_ref|checkoutRef)"\s*:/.test(text), 'Payment reference fields must not be returned');
};
const overview = async role => {
  const headers = role ? { cookie: `bm_access=fixture-${role}` } : {};
  const response = await mf.dispatchFetch(origin + '/api/store/admin-overview', { method: 'GET', headers });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assertNoOrderDisclosure(body);
  return { status: response.status, body };
};
const seedOrder = async ({ status = 'paid', total, created, data = {}, payment = true, notification = true }) => {
  const id = randomUUID(), paymentRef = payment === true ? `fixture-payment-${id}` : payment || null;
  const notificationId = notification === true ? `fixture-notification-${id}` : notification || null;
  orderIds.push(id);
  for (const value of [paymentRef, notificationId]) if (value?.trim()) referenceValues.push(value);
  await db.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,payment_ref,notification_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(id, randomUUID(), randomUUID(), status, JSON.stringify({ environment: 'authorizenet:live', items: [], ...data }), total, paymentRef, notificationId, created, created).run();
};
const sales = body => {
  assert.deepEqual(body.sales.map(window => window.label), ['Today', 'Last 7 days', 'Last 30 days']);
  for (const window of body.sales) {
    assert.deepEqual(window.live, { orders: 7, paymentRecorded: 5, grossCents: 16500, missingPaymentRecords: 2 }, 'Saved live payment evidence survives fulfillment holds and carrier failures; incomplete evidence is counted separately');
    assert.deepEqual(window.sandbox, { orders: 3, paymentRecorded: 2, grossCents: 1100, missingPaymentRecords: 1 }, 'Sandbox payments are disclosed separately and cannot inflate live gross');
    assert.deepEqual(window.unknown, { orders: 2, paymentRecorded: 2, grossCents: 1700, missingPaymentRecords: 0 }, 'Unrecognized and absent saved environments stay outside live gross');
  }
};
const outOfStock = body => body.attention.find(item => item.id === 'out_of_stock')?.count || 0;

try {
  await mf.ready; db = await mf.getD1Database('DB');
  for (const name of (await fs.readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) {
    await db.batch(migrationStatements(await fs.readFile(path.join(root, 'drizzle', name), 'utf8')).map(sql => db.prepare(sql)));
  }
  const now = Date.now();
  for (const role of ['manager', 'support', 'fulfillment']) {
    await db.prepare('INSERT INTO staff(email,name,role,active,created,updated,updated_by) VALUES(?,?,?,?,?,?,?)')
      .bind(users[role].email, `Synthetic ${role}`, role, 1, now, now, users.owner.email).run();
  }
  const facts = JSON.parse(await fs.readFile(path.join(root, 'lib/catalog-facts-v2.json'), 'utf8'));
  const product = facts.find(item => item.slug === 'semax');
  assert(product?.purchasable && product.inStock, 'Fixture uses a source-published, normally in-stock product');
  const setStock = quantity => db.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
    .bind(product.id, JSON.stringify({ stockQuantity: quantity, inStock: true, purchasable: true, availability: 'available' })).run();
  await setStock(25);

  // One paid, one held, one carrier-failed, one labeling and one delivered order.
  // The old fulfillment-bucket approach dropped the held and carrier-failed rows.
  for (const fixture of [
    { total: 1100, data: { environment: 'live' } },
    { total: 2200, data: { hold: { issue: 'out_of_stock' } } },
    { status: 'shipped', total: 3300, data: { shipment: { status: 'failure' } } },
    { status: 'labeling', total: 4400 },
    { status: 'delivered', total: 5500 },
    { total: 90000, payment: false },
    { total: 80000, notification: '   ' },
    { total: 99999, data: { internalTest: true } },
    { total: 500, data: { environment: 'sandbox' } },
    { total: 600, data: { environment: 'authorizenet:sandbox' } },
    { total: 700, data: { environment: 'sandbox' }, notification: false },
    { total: 800, data: { environment: 'unrecognized-fixture-environment' } },
    { total: 900, data: { environment: null } },
    { status: 'pending', total: 70000 },
    { status: 'failed', total: 60000 },
  ]) await seedOrder({ ...fixture, created: now });
  await seedOrder({ total: 50000, created: now + DAY });
  await seedOrder({ total: 40000, created: now - 40 * DAY });
  const before = await db.prepare('SELECT COUNT(*) records,SUM(total) gross FROM orders').first();

  let result = await overview();
  assert.equal(result.status, 400); assert.match(result.body.error, /sign in/i);
  assert.deepEqual(Object.keys(result.body), ['error'], 'Anonymous readers receive no overview data');
  result = await overview('customer');
  assert.equal(result.status, 400); assert.match(result.body.error, /administrator access/i);
  assert.deepEqual(Object.keys(result.body), ['error'], 'Customers receive no overview data');

  result = await overview('owner');
  assert.equal(result.status, 200, JSON.stringify(result.body)); sales(result.body);
  const stockBefore = outOfStock(result.body);
  assert(result.body.attention.some(item => item.id === 'review' && item.count >= 2), 'Held and carrier-failed paid orders remain operational review work');
  // Exercise catalog() normalization in the actual route: quantity zero changes
  // inStock to false even though the persisted override says inStock=true.
  await setStock(0);
  result = await overview('owner');
  assert.equal(result.status, 200, JSON.stringify(result.body)); sales(result.body);
  assert.equal(outOfStock(result.body), stockBefore + 1, 'Normalized zero-stock product must appear in product attention');
  result = await overview('manager');
  assert.equal(result.status, 200, JSON.stringify(result.body)); sales(result.body);
  assert.equal(outOfStock(result.body), stockBefore + 1, 'Managers receive the same normalized stock warning');
  for (const role of ['support', 'fulfillment']) {
    result = await overview(role);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.sales, null, `${role} cannot read financial reports`);
    assert.deepEqual(result.body.setup, [], `${role} cannot read store setup`);
    assert(!result.body.attention.some(item => item.tab === 'products'), `${role} cannot read product administration`);
    assert(result.body.attention.some(item => item.tab === 'orders'), `${role} retains authorized order work`);
  }
  assert.deepEqual(await db.prepare('SELECT COUNT(*) records,SUM(total) gross FROM orders').first(), before, 'Overview GETs cannot modify fixture orders');
  assert.equal(forbidden, 0, 'No payment, shipping, email, or other outbound provider was contacted');
  console.log('PASS: built Worker overview auth/roles; saved live payment evidence independent of fulfillment holds and carrier failures; tests, sandbox, unknown and missing evidence separated; normalized zero stock flagged; no order/payment references disclosed. Isolated D1 and synthetic auth only, no production bindings or provider calls.');
} finally {
  await mf.dispose();
  await fs.rm(temporary, { recursive: true, force: true });
}
