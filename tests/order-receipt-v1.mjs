// Order receipt checks: the store email and Authorize.net details carry every item. No network request is made.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'biomod-receipt-v1-'));
try {
  for (const name of ['order-summary', 'private-presentation']) {
    const source = await fs.readFile(new URL('../lib/' + name + '.ts', import.meta.url), 'utf8');
    const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from '\.\/private-presentation'/g, "from './private-presentation.mjs'");
    await fs.writeFile(path.join(temp, name + '.mjs'), out);
  }
  const s = await import(path.join(temp, 'order-summary.mjs'));
  const order = {
    email: 'buyer@example.com',
    items: [
      { id: 7, quantity: 2, lineTotal: 9000, product: { name: 'BPC-157 10mg', price: 4500 } },
      { id: 9, quantity: 3, lineTotal: 10000, packId: 'p1', packSize: 3, packKind: 'mixed', product: { name: 'TB-500 5mg', price: 4000 } },
    ],
    subtotal: 21000, discount: 2000, promo: { code: 'BM10', savings: 1000 }, shipping: 565, shippingService: 'USPS Ground Advantage', tax: 1591, total: 21156,
    address: { name: 'Ada Lovelace', line1: '1 Main St', city: 'Las Vegas', state: 'NV', zip: '89118', phone: '702-555-0100' },
  };
  const items = s.summaryItems(order);
  assert.equal(items.length, 2);
  assert.deepEqual(items[1], { id: 9, name: 'TB-500 5mg', detail: 'Mixed 3-pack', quantity: 3, unitCents: 4000, lineTotalCents: 10000 });
  const anet = s.anetOrderDetails(order);
  assert.equal(anet.items.length, 2);
  assert.equal(anet.taxCents, 1591);
  assert.equal(anet.shippingCents, 565);
  assert.equal(anet.shippingName, 'USPS Ground Advantage');
  assert.equal(anet.note, 'Promo BM10 saved $10.00');
  const html = s.orderEmailHtml('6f1d2c3b-0000-4000-8000-000000000001', order);
  for (const text of ['New paid order 6f1d2c3b', 'BPC-157 10mg', 'TB-500 5mg', 'Mixed 3-pack', '$90.00', '$100.00', 'Subtotal', '$210.00', '-$20.00', 'promo BM10', 'USPS Ground Advantage', '$5.65', '$15.91', '$211.56', 'Ada Lovelace', '702-555-0100', 'buyer@example.com'])
    assert.ok(html.includes(text), 'email shows ' + text);
  assert.ok(!s.orderEmailHtml('x', { ...order, address: { ...order.address, name: '<script>' } }).includes('<script>'), 'customer text is escaped');
  // Recipients: ORDER_NOTIFY_EMAILS wins, otherwise the store admins; malformed addresses are dropped.
  assert.deepEqual(s.orderNotifyRecipients({ STORE_ADMIN_EMAILS: 'chris@biomodcompounds.com, nope' }), ['chris@biomodcompounds.com']);
  assert.deepEqual(s.orderNotifyRecipients({ STORE_ADMIN_EMAILS: 'a@b.co', ORDER_NOTIFY_EMAILS: 'orders@trybiomod.com' }), ['orders@trybiomod.com']);
  // Sending: off without a key or recipients; one Resend call with the full order otherwise; failures never throw.
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response('{}', { status: 200 }); };
  assert.equal(await s.sendOrderNotification({ STORE_ADMIN_EMAILS: 'a@b.co' }, 'id', order), false);
  assert.equal(await s.sendOrderNotification({ RESEND_API_KEY: 're_test_key_123' }, 'id', order), false);
  assert.equal(calls.length, 0);
  assert.equal(await s.sendOrderNotification({ RESEND_API_KEY: 're_test_key_123', STORE_ADMIN_EMAILS: 'chris@biomodcompounds.com' }, '6f1d2c3b-0000', order), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(calls[0].body.to, ['chris@biomodcompounds.com']);
  assert.equal(calls[0].body.reply_to, 'buyer@example.com');
  assert.equal(calls[0].body.subject, 'New order 6f1d2c3b - $211.56 - 5 items');
  assert.ok(calls[0].body.html.includes('TB-500 5mg'));
  globalThis.fetch = async () => { throw new Error('down'); };
  assert.equal(await s.sendOrderNotification({ RESEND_API_KEY: 're_test_key_123', STORE_ADMIN_EMAILS: 'a@b.co' }, 'id', order), false);
  console.log('PASS: item summary with packs, Authorize.net receipt details, escaped store email with totals and ship-to, recipients, Resend send and failure handling');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
