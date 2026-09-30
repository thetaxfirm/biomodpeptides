// Isolated EasyPost checks. fetch is replaced with a fake; no network request is made.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import ts from 'typescript';
const source = await fs.readFile(new URL('../lib/easypost.ts', import.meta.url), 'utf8');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'biomod-easypost-v1-'));
try {
  const file = path.join(temp, 'easypost.mjs');
  await fs.writeFile(file, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const e = await import(file);
  const env = { EASYPOST_API_KEY: 'EZTK_test_key_123456' };
  const vial = { quantity: 2, product: { categories: [{ slug: 'research-compounds' }] } };
  const bottle = { quantity: 1, product: { categories: [{ slug: 'softgels' }] } };
  assert.deepEqual(e.parcelFor([vial, bottle], env), { length: 8, width: 6, height: 4, weight: 14 });
  assert.equal(e.easypostReady({}), false);
  assert.equal(e.easypostReady(env), true);
  const to = { name: 'Ada Lovelace', line1: '1 Main St', city: 'Las Vegas', state: 'NV', zip: '89118', phone: '702-498-2144' };
  const calls = [];
  const shipment = { id: 'shp_1', rates: [
    { id: 'rate_fedex', carrier: 'FedEx', service: 'Ground', rate: '5.00' },
    { id: 'rate_ups', carrier: 'UPSDAP', service: 'Ground', rate: '9.10', delivery_days: 3 },
    { id: 'rate_usps', carrier: 'USPS', service: 'GroundAdvantage', rate: '6.45', delivery_days: 4 },
  ] };
  globalThis.fetch = async (url, init) => {
    calls.push([url, init.method, init.headers.Authorization, init.body && JSON.parse(init.body)]);
    if (url.endsWith('/shipments')) return new Response(JSON.stringify(shipment), { status: 200 });
    if (url.endsWith('/shipments/shp_1/buy')) return new Response(JSON.stringify({ id: 'shp_1', tracking_code: '9400TEST', postage_label: { label_url: 'https://easypost-files/label.png' }, tracker: { public_url: 'https://track.easypost.com/x' } }), { status: 200 });
    if (url === 'https://api.resend.com/emails') return new Response('{}', { status: 200 });
    throw new Error('unexpected ' + url);
  };
  // Cheapest allowed carrier wins; FedEx is excluded by default.
  const rate = await e.cheapestRate(env, to, [vial]);
  assert.deepEqual(rate, { cents: 645, service: 'USPS Ground Advantage' });
  assert.equal(calls[0][2], 'Basic ' + btoa('EZTK_test_key_123456:'));
  assert.equal(calls[0][3].shipment.from_address.zip, '89118');
  assert.equal(calls[0][3].shipment.to_address.phone, '7024982144');
  assert.equal((await e.cheapestRate({ ...env, SHIP_HANDLING_CENTS: '150' }, to, [vial])).cents, 795);
  assert.equal((await e.cheapestRate({ ...env, EASYPOST_CARRIERS: 'UPS' }, to, [vial])).service, 'UPS Ground');
  const label = await e.buyLabel(env, to, [vial], 'BIOMOD 1234');
  assert.equal(label.tracking, '9400TEST');
  assert.equal(label.costCents, 645);
  assert.equal(calls.at(-1)[3].rate.id, 'rate_usps');
  assert.equal(await e.sendTrackingEmail({}, 'a@b.co', 'order-1', label), false, 'no key: no email');
  assert.equal(await e.sendTrackingEmail({ RESEND_API_KEY: 're_test' }, 'a@b.co', 'order-1', label, 'Ada Lovelace'), true);
  // Errors surface EasyPost's message.
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid address' } }), { status: 422 });
  await assert.rejects(e.cheapestRate(env, to, [vial]), /Invalid address/);
  globalThis.fetch = async () => { throw new TypeError('network'); };
  await assert.rejects(e.cheapestRate(env, to, [vial]), /could not be reached/);
  await assert.rejects(e.cheapestRate({}, to, [vial]), /not connected/);
  // Webhook signatures.
  const body = JSON.stringify({ description: 'tracker.updated', result: { object: 'Tracker', tracking_code: '9400TEST', status: 'delivered' } });
  const sig = 'hmac-sha256-hex=' + createHmac('sha256', 'whsec-12345').update(body).digest('hex');
  assert.equal(e.verifyEasypostWebhook(body, sig, 'whsec-12345'), true);
  assert.equal(e.verifyEasypostWebhook(body + ' ', sig, 'whsec-12345'), false);
  assert.equal(e.verifyEasypostWebhook(body, null, 'whsec-12345'), false);
  assert.equal(e.verifyEasypostWebhook(body, sig, 'other-secret'), false);
  console.log('PASS: parcel estimate, carrier filter (USPS/UPS, UPSDAP), cheapest rate, handling fee, label purchase, tracking email, error messages, webhook signatures');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
