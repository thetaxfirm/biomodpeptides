// Exercise actual checkout parsing/fingerprints with isolated adapters and in-memory records.
// No customer data, database connection, shipping request, or payment request is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
const { products } = require('../lib/catalog.ts');
const product = { ...products.find(p => p.slug === 'bpc-157-10mg'), price: 4900, stockQuantity: 20 };
assert(product.id, 'Existing catalog fixture');
const lines = [{ id: product.id, quantity: 1 }];
const address = { name: 'Isolated fixture', line1: '1 Example Road', line2: '', city: 'Las Vegas', state: 'NV', zip: '89101', country: 'US', phone: '7025550100' };
const env = { FIXED_TAX_RATE: '8.375', FIXED_TAX_STATE: 'NV' };
let receipt, oldOrder = null, savedOrder, sequence = 0, adapterCalls = 0;
const shippingStates = [];
const now = 2000000000000;
const runtime = {
  runtime: () => env, timestamp: () => now, uid: () => 'isolated-' + ++sequence,
  parse: (value, fallback) => value ? JSON.parse(value) : fallback,
  one: async query => {
    if (query.startsWith('SELECT id,status,checkout_url,data FROM orders')) return oldOrder;
    if (query.startsWith('SELECT data,created FROM requests')) return receipt;
    throw new Error('Unexpected isolated query');
  },
  run: async (query, ...values) => {
    if (query.startsWith('INSERT INTO requests')) receipt = { data: values[3], created: values[4] };
    else assert(query.startsWith('UPDATE orders SET status='), 'Only expected order status updates');
  },
  database: () => ({
    prepare: query => ({ bind: (...values) => ({ query, values }) }),
    batch: async statements => { savedOrder = JSON.parse(statements[0].values[4]); },
  }),
};
const originalLoad = Module._load;
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network is forbidden in this test'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/checkout.ts')) {
    if (request === './runtime') return runtime;
    if (request === './commerce') return { quote: async () => ({ items: [{ ...lines[0], product, lineTotal: 4900 }], subtotal: 4900, discount: 0, total: 4900, config: { shippingCents: 500, freeShippingAt: 20000 } }) };
    if (request === './auth') return { customer: async () => ({ email: 'fixture@example.invalid' }) };
    if (request === './easypost') return { easypostReady: () => true, cheapestRate: async (_env, parsed) => { shippingStates.push(parsed.state); return { cents: 500, service: 'Isolated shipping' }; } };
    if (request === './payments') return {
      paymentEnvironment: () => 'isolated', paymentReturnUrl: () => 'https://example.invalid/return',
      createPaymentAdapter: () => ({ getStatus: () => ({ checkoutEnabled: true }), reference: id => id,
        createCheckout: async () => { adapterCalls++; return { providerReference: 'isolated-reference', url: '/isolated-payment' }; } }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { addressSchema, deliveryQuote, issueQuote, checkout } = require('../lib/checkout.ts');
(async () => {
  for (const state of ['NV', 'nv', 'nV', ' NV ', '\tnv\n']) assert.equal(addressSchema.parse({ ...address, state }).state, 'NV');
  for (const state of ['', 'N', 'Nevada', 'N V', 'N1', 'N-V', null, undefined, 12, {}, ['NV']]) assert.equal(addressSchema.safeParse({ ...address, state }).success, false, String(state));
  const invalid = addressSchema.safeParse({ ...address, state: 'Nevada' });
  assert.equal(invalid.error.issues[0].message, 'Enter a two-letter state abbreviation, such as NV.');
  assert.equal(addressSchema.safeParse({ ...address, country: 'CA' }).success, false, 'Country restriction is unchanged');
  assert.equal(addressSchema.safeParse({ ...address, zip: 'bad' }).success, false, 'ZIP validation is unchanged');
  const lower = { ...address, state: ' nv ' };
  const normalized = await deliveryQuote(lines, lower);
  const canonical = await deliveryQuote(lines, address);
  assert.deepEqual(normalized, canonical, 'Shipping and tax see the same canonical address');
  assert.deepEqual(shippingStates, ['NV', 'NV']);
  assert.equal(normalized.tax, 410, 'Existing Nevada tax calculation is retained');
  assert.equal(lower.state, ' nv ', 'Caller input is not mutated');
  const issued = await issueQuote('isolated-owner', lines, lower);
  const body = { accepted: true, requestKey: '00000000-0000-4000-8000-000000000000', address, expectedTotal: issued.total, quoteId: issued.quoteId };
  assert.deepEqual(await checkout('isolated-owner', lines, body), { id: 'isolated-2', url: '/isolated-payment' });
  assert.equal(adapterCalls, 1, 'Equivalent uppercase input reuses the normalized delivery quote');
  assert.deepEqual(savedOrder.address, address);
  assert.equal(savedOrder.fingerprint, JSON.stringify({ lines, address }));
  oldOrder = { id: 'isolated-existing', status: 'awaiting_payment', checkout_url: '/isolated-payment', data: JSON.stringify(savedOrder) };
  assert.deepEqual(await checkout('isolated-owner', lines, { ...body, address: lower }), { id: oldOrder.id, url: oldOrder.checkout_url });
  assert.equal(adapterCalls, 1, 'Case/whitespace changes do not create another payment attempt');
  await assert.rejects(checkout('isolated-owner', lines, { ...body, address: { ...address, state: 'CA' } }), /unresolved checkout/, 'A genuinely different state does not match the saved request');
  await assert.rejects(checkout('isolated-owner', lines, { ...body, accepted: false }), /21 or older/);
  await assert.rejects(checkout('isolated-owner', lines, { ...body, address: { ...address, state: 12 } }));
  assert.equal(adapterCalls, 1);
  console.log('PASS: state normalization, invalid input rejection, unchanged country/ZIP/tax rules, delivery quote consistency, checkout fingerprint reuse, and no duplicate payment attempt');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; global.fetch = originalFetch; });
