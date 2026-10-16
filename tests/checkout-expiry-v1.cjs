/* Releasing an unpaid checkout. Real module, isolated SQLite, stubbed provider. No network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const { releaseUnpaidOrder, runCheckoutExpiry, readCheckoutExpiryHealth, UNPAID_HOLD_MS, RELEASABLE, HEALTH_KEY } = require('../lib/checkout-expiry.ts');

const sql = new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE orders(id TEXT PRIMARY KEY,owner TEXT,request_key TEXT,status TEXT NOT NULL,data TEXT NOT NULL,total INTEGER NOT NULL,checkout_ref TEXT,checkout_url TEXT,payment_ref TEXT,notification_id TEXT,created INTEGER NOT NULL,updated INTEGER);
  CREATE TABLE inventory_reservations(order_id TEXT,product_id INTEGER,quantity INTEGER);
  CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
class Statement {
  constructor(q, v = []) { this.q = q; this.v = v; }
  bind(...v) { return new Statement(this.q, v); }
  async first() { return sql.prepare(this.q).get(...this.v) || null; }
  async all() { return { results: sql.prepare(this.q).all(...this.v) }; }
  async run() { const r = sql.prepare(this.q).run(...this.v); return { meta: { changes: r.changes } }; }
}
let beforeBatch = null;
const db = { prepare: q => new Statement(q), async batch(list) {
  if (beforeBatch) { const fn = beforeBatch; beforeBatch = null; await fn(); }
  sql.exec('BEGIN'); try { const out = []; for (const s of list) out.push(await s.run()); sql.exec('COMMIT'); return out; }
  catch (e) { sql.exec('ROLLBACK'); throw e; } } };
const env = { DB: db, AUTHORIZENET_ENVIRONMENT: 'live' };
const ENVIRONMENT = 'authorizenet:live';
const NOW = 2000000000000;
const OLD = NOW - UNPAID_HOLD_MS - 60000;

// The provider's verdict is the only thing that may release an order, so every verdict it can
// return is exercised against the same otherwise-releasable row.
const unpaid = () => ({ state: 'pending', providerReference: null, noPaymentFound: true, message: 'No payment found.' });
const verdicts = {
  paid: { state: 'paid', providerReference: 'ref', notificationId: 'note', message: 'Paid.' },
  underReview: { state: 'pending', providerReference: 'ref', noPaymentFound: false, message: 'Reviewing.' },
  review: { state: 'review', providerReference: 'ref', noPaymentFound: false, message: 'Review.' },
  failed: { state: 'failed', providerReference: 'ref', noPaymentFound: false, message: 'Failed.' },
  pendingButFound: { state: 'pending', providerReference: 'ref', noPaymentFound: false, message: 'Pending.' },
};
let asked = [];
const verifier = verdict => async (order, reference, hints, created) => {
  asked.push({ id: order.id, totalCents: order.totalCents, currency: order.currency, reference, hints, created });
  return typeof verdict === 'function' ? verdict() : verdict;
};
let n = 0;
function seed({ status = 'awaiting_payment', created = OLD, data = {}, total = 21675, payment_ref = null, notification_id = null, reserve = 2 } = {}) {
  const id = '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
  const saved = { environment: ENVIRONMENT, items: [{ id: 753, quantity: reserve }], total, ...data };
  sql.prepare('INSERT INTO orders(id,owner,status,data,total,checkout_ref,created,updated) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, 'owner-1', status, JSON.stringify(saved), total, 'ref-' + id.slice(-4), created, created);
  sql.prepare('INSERT INTO inventory_reservations(order_id,product_id,quantity) VALUES(?,?,?)').run(id, 753, reserve);
  if (payment_ref) sql.prepare('UPDATE orders SET payment_ref=? WHERE id=?').run(payment_ref, id);
  if (notification_id) sql.prepare('UPDATE orders SET notification_id=? WHERE id=?').run(notification_id, id);
  return sql.prepare('SELECT id,status,data,total,checkout_ref,created,payment_ref,notification_id FROM orders WHERE id=?').get(id);
}
const statusOf = id => sql.prepare('SELECT status FROM orders WHERE id=?').get(id).status;
const heldFor = id => sql.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory_reservations WHERE order_id=?').get(id).q;

(async () => {
  // A verified-unpaid checkout is cancelled and its stock goes back.
  const dead = seed();
  asked = [];
  assert.equal(await releaseUnpaidOrder(db, verifier(unpaid()), dead, NOW), true);
  assert.equal(statusOf(dead.id), 'cancelled');
  assert.equal(heldFor(dead.id), 0, 'the reservation is released with the order');
  assert.deepEqual(asked, [{ id: dead.id, totalCents: dead.total, currency: 'USD', reference: dead.checkout_ref, hints: [], created: dead.created }],
    'the provider is asked about this exact order, with the saved reference and creation time');
  const savedAfter = JSON.parse(sql.prepare('SELECT data FROM orders WHERE id=?').get(dead.id).data);
  assert.equal(savedAfter.releasedReason, 'unpaid_checkout_expired');
  assert.equal(savedAfter.releasedAt, NOW);
  assert.deepEqual(savedAfter.items, [{ id: 753, quantity: 2 }], 'the saved purchase itself is not rewritten');
  // Releasing twice cannot double-act.
  assert.equal(await releaseUnpaidOrder(db, verifier(unpaid()), dead, NOW), false, 'an already released order is not released again');

  // Any answer other than a confirmed absence of payment leaves the order and its stock alone.
  for (const [name, verdict] of Object.entries(verdicts)) {
    const kept = seed();
    assert.equal(await releaseUnpaidOrder(db, verifier(verdict), kept, NOW), false, name + ' must never be released');
    assert.equal(statusOf(kept.id), 'awaiting_payment', name + ': status untouched');
    assert.equal(heldFor(kept.id), 2, name + ': stock stays reserved');
  }

  // Orders a person owns, or that already carry provider identifiers, are never touched.
  for (const [label, options] of [
    ['held for review', { status: 'review' }],
    ['already has a payment reference', { payment_ref: 'anet-123' }],
    ['already has a notification', { notification_id: 'note-123' }],
    ['contains an archived product', { data: { catalogUnavailable: true, items: [{ id: 900001, quantity: 1, unavailable: true }] } }],
  ]) {
    const kept = seed(options);
    asked = [];
    assert.equal(await releaseUnpaidOrder(db, verifier(unpaid()), kept, NOW), false, label + ' must not be released');
    assert.notEqual(statusOf(kept.id), 'cancelled', label);
    assert.equal(heldFor(kept.id), 2, label + ': stock stays reserved');
    assert.deepEqual(asked, [], label + ': the provider is not even asked');
  }
  assert(!RELEASABLE.includes('review'), 'review is never a releasable status');
  for (const status of ['creating', 'awaiting_payment', 'pending']) assert(RELEASABLE.includes(status), status + ' is releasable');

  // A payment landing between the read and the write makes the release do nothing at all.
  const raced = seed();
  beforeBatch = () => { sql.prepare("UPDATE orders SET status='paid',payment_ref='anet-late' WHERE id=?").run(raced.id); };
  assert.equal(await releaseUnpaidOrder(db, verifier(unpaid()), raced, NOW), false, 'a payment that lands first wins the race');
  assert.equal(statusOf(raced.id), 'paid');
  assert.equal(heldFor(raced.id), 2, 'a paid order keeps its reservation for settlement');
  // The same holds for an administrator edit that changes the saved order.
  const edited = seed();
  beforeBatch = () => { sql.prepare("UPDATE orders SET data=json_set(data,'$.note','edited') WHERE id=?").run(edited.id); };
  assert.equal(await releaseUnpaidOrder(db, verifier(unpaid()), edited, NOW), false, 'an edited order is not released on stale data');
  assert.equal(statusOf(edited.id), 'awaiting_payment');
  assert.equal(heldFor(edited.id), 2);

  // The sweep: only checkouts past the hold window, and never another environment's.
  sql.exec('DELETE FROM orders; DELETE FROM inventory_reservations; DELETE FROM settings;');
  const expired = seed({ created: OLD });
  const fresh = seed({ created: NOW - 60000 });
  const foreign = seed({ created: OLD, data: { environment: 'authorizenet:sandbox' } });
  const paid = seed({ created: OLD, status: 'paid' });
  asked = [];
  const health = await runCheckoutExpiry(env, { now: () => NOW, verify: verifier(unpaid()) });
  assert.equal(statusOf(expired.id), 'cancelled', 'an expired unpaid checkout is released');
  assert.equal(heldFor(expired.id), 0);
  assert.equal(statusOf(fresh.id), 'awaiting_payment', 'a checkout inside the hold window is left alone');
  assert.equal(heldFor(fresh.id), 2);
  assert.equal(statusOf(foreign.id), 'awaiting_payment', 'another payment environment is never ours to cancel');
  assert.equal(heldFor(foreign.id), 2);
  assert.equal(statusOf(paid.id), 'paid', 'a paid order is not a candidate at all');
  assert.deepEqual(asked.map(a => a.id), [expired.id], 'only the due order in this environment reaches the provider');
  assert.deepEqual(health, { status: 'completed', checkedAt: NOW, due: 2, released: 1, kept: 1, failed: 0 });
  assert.deepEqual(await readCheckoutExpiryHealth(env), health, 'the run is reported where the admin screens read it');
  assert.equal(JSON.parse(sql.prepare('SELECT value FROM settings WHERE key=?').get(HEALTH_KEY).value).released, 1);

  // While the recovery mailer is enabled it owns an unpaid checkout for its first week: it emails
  // the customer a further discount and points them back at that same order. Cancelling underneath
  // that would discount an order we had just destroyed, so the day-long hold waits for it.
  sql.exec('DELETE FROM orders; DELETE FROM inventory_reservations; DELETE FROM settings;');
  sql.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('checkout_recovery_v1', JSON.stringify({ enabled: true, startsAt: 1 }));
  const chased = seed({ created: NOW - 2 * 86400000 });
  const finished = seed({ created: NOW - 8 * 86400000 });
  await runCheckoutExpiry(env, { now: () => NOW, verify: verifier(unpaid()) });
  assert.equal(statusOf(chased.id), 'awaiting_payment', 'recovery still has a week to win this one back');
  assert.equal(heldFor(chased.id), 2);
  assert.equal(statusOf(finished.id), 'cancelled', 'past the recovery window it is released as usual');
  assert.equal(heldFor(finished.id), 0);
  // Switching recovery off hands the day-long hold back.
  sql.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify({ enabled: false }), 'checkout_recovery_v1');
  await runCheckoutExpiry(env, { now: () => NOW, verify: verifier(unpaid()) });
  assert.equal(statusOf(chased.id), 'cancelled', 'with no recovery programme the day-long hold applies');
  assert.equal(heldFor(chased.id), 0);

  // A provider that throws costs stock, never an order.
  sql.exec('DELETE FROM orders; DELETE FROM inventory_reservations;');
  const unreachable = seed({ created: OLD });
  const broken = await runCheckoutExpiry(env, { now: () => NOW, verify: async () => { throw new Error('provider unreachable'); } });
  assert.equal(statusOf(unreachable.id), 'awaiting_payment', 'a silent provider never cancels an order');
  assert.equal(heldFor(unreachable.id), 2);
  assert.deepEqual(broken, { status: 'completed', checkedAt: NOW, due: 1, released: 0, kept: 0, failed: 1 });

  // A job that cannot read what it needs says which part failed, rather than reporting a clean run.
  // A sweep that silently reports success while reading nothing is how a dead job stays invisible.
  const blind = await runCheckoutExpiry({ DB: { prepare: () => { throw new Error('no table'); } }, AUTHORIZENET_ENVIRONMENT: 'live' }, { now: () => NOW });
  assert.equal(blind.status, 'settings_unreadable');
  assert.equal(blind.released, 0);
  // Settings readable, orders table not: the run must name the part that failed.
  const queueless = { DB: { prepare(query) {
    const self = { bind: () => self, first: async () => null, run: async () => ({ meta: { changes: 1 } }),
      all: async () => { throw new Error('no orders table'); } };
    return query.includes('FROM orders') ? self : { ...self, all: async () => ({ results: [] }) };
  } }, AUTHORIZENET_ENVIRONMENT: 'live' };
  const unreadable = await runCheckoutExpiry(queueless, { now: () => NOW });
  assert.equal(unreadable.status, 'queue_unreadable');
  assert.equal(unreadable.released, 0);

  console.log('PASS: an unpaid checkout is released only on a verified absence of payment; paid, pending, under-review, held, referenced and archived orders are never cancelled; races and provider failures lose stock rather than orders; the sweep respects the hold window, the recovery window and the payment environment, and reports its health.');
})().catch(e => { console.error(e); process.exitCode = 1; });
