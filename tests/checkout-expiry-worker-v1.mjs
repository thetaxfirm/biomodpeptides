// The deployed five-minute cron releasing an unpaid checkout, against the built Worker and a local
// D1. Synthetic orders only; the payment provider is intercepted and reports no payment.
import { migrationStatements } from './sql-migration-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { createHash } from 'node:crypto';

// Authorize.net is asked about an order by the reference the checkout saved for it, and a reference
// that is neither that nor a transaction id is reported as needing review rather than as unpaid.
// The fixture therefore stores the real reference, the way a genuine checkout would.
const orderReference = id => createHash('sha256').update('biomod:authorizenet:order:' + id).digest('hex').slice(0, 20).toUpperCase();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(root, 'dist/server');
const config = JSON.parse(await fs.readFile(path.join(built, 'wrangler.json'), 'utf8'));
assert(config.triggers?.crons?.includes('*/5 * * * *'), 'Built configuration must retain the five-minute cron');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trybiomod-checkout-expiry-'));
const names = (await fs.readdir(built, { recursive: true })).filter(n => /\.(?:m?js)$/.test(n));
const now = Date.now();
const HOLD = 24 * 3600000;
let lookups = 0, forbidden = 0;
const mf = new Miniflare({
  name: 'isolated-checkout-expiry',
  cf: false,
  unsafeTriggerHandlers: true,
  modules: [config.main, ...names.filter(n => n !== config.main)].map(n => ({ type: 'ESModule', path: path.join(built, n) })),
  modulesRoot: built,
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags,
  bindings: {
    AUTHORIZENET_ENVIRONMENT: 'live', AUTHORIZENET_API_LOGIN_ID: 'fixtureLogin',
    AUTHORIZENET_TRANSACTION_KEY: 'A'.repeat(16), AUTHORIZENET_SIGNATURE_KEY: 'B'.repeat(128),
    AUTHORIZENET_RETURN_URL: 'https://trybiomod.com/payment/return', AUTHORIZENET_CONNECTION_VERIFIED: 'true',
    COMMERCE_MODE: 'live', COMMERCE_FULFILLMENT_VERIFIED: 'true',
  },
  d1Databases: { DB: 'isolated-checkout-expiry' },
  d1Persist: path.join(temporary, 'd1'),
  // The provider is asked, and truthfully answers that it is holding nothing for these orders.
  outboundService: async request => {
    if (request.url === 'https://api.authorize.net/xml/v1/request.api' && request.method === 'POST') {
      const body = await request.json(), kind = Object.keys(body)[0];
      if (kind === 'getUnsettledTransactionListRequest') { lookups++; return Response.json({ messages: { resultCode: 'Ok' }, transactions: [] }); }
      if (kind === 'getSettledBatchListRequest') { lookups++; return Response.json({ messages: { resultCode: 'Ok' }, batchList: [] }); }
    }
    forbidden++;
    throw new Error('External request prohibited in this fixture');
  },
  log: new Log(LogLevel.ERROR),
});
// orders_owner_active is a partial unique index: one unresolved order per customer. That is the
// invariant the lockout enforces, so each fixture order below belongs to a different customer.
const ENVIRONMENT = 'authorizenet:live';
const saved = extra => JSON.stringify({ environment: ENVIRONMENT, items: [{ id: 753, quantity: 2 }], total: 21675, ...extra });
try {
  await mf.ready;
  const db = await mf.getD1Database('DB');
  for (const name of (await fs.readdir(path.join(root, 'drizzle'))).filter(n => n.endsWith('.sql')).sort())
    await db.batch(migrationStatements(await fs.readFile(path.join(root, 'drizzle', name), 'utf8')).map(sql => db.prepare(sql)));

  const order = (id, status, created, data = {}) => ({ id, status, created, data });
  const rows = [
    order('00000000-0000-4000-8000-00000000ab01', 'awaiting_payment', now - HOLD - 60000),
    order('00000000-0000-4000-8000-00000000ab02', 'awaiting_payment', now - 3600000),
    order('00000000-0000-4000-8000-00000000ab03', 'paid', now - HOLD - 60000),
    order('00000000-0000-4000-8000-00000000ab04', 'review', now - HOLD - 60000),
    order('00000000-0000-4000-8000-00000000ab05', 'awaiting_payment', now - HOLD - 60000, { environment: 'authorizenet:sandbox' }),
  ];
  for (const row of rows) {
    await db.prepare('INSERT INTO orders(id,owner,request_key,status,data,total,checkout_ref,created,updated) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(row.id, 'owner-' + row.id.slice(-2), row.id, row.status, saved(row.data), 21675, orderReference(row.id), row.created, row.created).run();
    await db.prepare('INSERT INTO inventory_reservations(order_id,product_id,quantity) VALUES(?,?,?)').bind(row.id, 753, 2).run();
  }

  const scheduled = await mf.dispatchFetch('http://localhost/cdn-cgi/handler/scheduled?cron=*%2F5%20*%20*%20*%20*');
  assert.equal(scheduled.status, 200, 'The built scheduled handler must complete: ' + (await scheduled.text()).slice(0, 400));

  const statusOf = async id => (await db.prepare('SELECT status FROM orders WHERE id=?').bind(id).first()).status;
  const heldFor = async id => (await db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory_reservations WHERE order_id=?').bind(id).first()).q;

  assert.equal(await statusOf(rows[0].id), 'cancelled', 'an unpaid checkout past the hold window is released');
  assert.equal(await heldFor(rows[0].id), 0, 'and its stock goes back on sale');
  const released = JSON.parse((await db.prepare('SELECT data FROM orders WHERE id=?').bind(rows[0].id).first()).data);
  assert.equal(released.releasedReason, 'unpaid_checkout_expired');
  assert.deepEqual(released.items, [{ id: 753, quantity: 2 }], 'the saved purchase is recorded, not rewritten');

  assert.equal(await statusOf(rows[1].id), 'awaiting_payment', 'a checkout still inside the hold window is untouched');
  assert.equal(await heldFor(rows[1].id), 2);
  assert.equal(await statusOf(rows[2].id), 'paid', 'a paid order is never a candidate');
  assert.equal(await heldFor(rows[2].id), 2, 'a paid order keeps its reservation for settlement');
  assert.equal(await statusOf(rows[3].id), 'review', 'an order held for review waits for a person, not a timer');
  assert.equal(await heldFor(rows[3].id), 2);
  assert.equal(await statusOf(rows[4].id), 'awaiting_payment', 'another payment environment is never ours to cancel');
  assert.equal(await heldFor(rows[4].id), 2);

  const health = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='checkout_expiry_health_v1'").first()).value);
  assert.equal(health.status, 'completed');
  assert.equal(health.released, 1, 'the run reports exactly what it released');
  assert.equal(health.failed, 0);
  assert(health.checkedAt >= now, 'the run stamps when it last looked');
  assert(lookups > 0, 'the provider was actually asked before anything was cancelled');
  assert.equal(forbidden, 0, 'no other outbound call was attempted');

  // A second run has nothing left to do and must not disturb what it already settled.
  const again = await mf.dispatchFetch('http://localhost/cdn-cgi/handler/scheduled?cron=*%2F5%20*%20*%20*%20*');
  assert.equal(again.status, 200);
  assert.equal(await statusOf(rows[0].id), 'cancelled');
  assert.equal(await statusOf(rows[2].id), 'paid');
  assert.equal(JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='checkout_expiry_health_v1'").first()).value).released, 0, 'the second run releases nothing');

  console.log('PASS: the built Worker five-minute cron releases an unpaid checkout past the hold window and returns its stock, while paid, in-window, held-for-review and foreign-environment orders are untouched; the provider is asked before any cancellation and the run reports its health. Local synthetic orders only, no live payment.');
} finally {
  await mf.dispose();
  await fs.rm(temporary, { recursive: true, force: true });
}
