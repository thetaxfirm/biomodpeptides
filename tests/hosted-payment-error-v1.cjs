/* Actual GET pay handler with isolated auth/order/provider fixtures. No network or database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const root = path.resolve(__dirname, '..');
const { products } = require('../lib/catalog.ts');
const visibility = require('../lib/catalog-visibility.ts');
const summary = require('../lib/order-summary.ts');
const product = products.find(item => item.slug === 'bpc-157-10mg');
assert(product, 'Use an existing catalog identity without changing its source data');
const clock = 2000000000000;
const orderId = '00000000-0000-4000-8000-000000000001';
const user = { id: 'isolated-owner', email: 'fixture@example.invalid' };
const data = {
  environment: 'isolated', items: [{ id: product.id, quantity: 1, lineTotal: 1000, product: { name: product.name, price: 1000 } }],
  tax: 50, shipping: 100, shippingService: 'Isolated shipping',
};
const savedOrder = { id: orderId, status: 'awaiting_payment', total: 1150, checkout_ref: 'isolated-reference', data: JSON.stringify(data), created: clock - 1000 };
const before = JSON.stringify(savedOrder);
const expectedOrder = { id: orderId, totalCents: savedOrder.total, currency: 'USD' };
const form = { action: 'https://payments.example.invalid/hosted', token: 'ISOLATED_TOKEN<&"' };
const uncertain = 'The payment page could not be opened. We could not confirm the payment status. Check your orders or contact Biomod before paying again.';
let scenario = {}, calls = [], logs = [], networkCalls = 0;
const originalLoad = Module._load, originalFetch = global.fetch, originalError = console.error;
const forbidden = name => () => { throw new Error('Unexpected isolated dependency: ' + name); };
class TestResponse extends Response {
  static json(value, options = {}) { return new TestResponse(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }); }
}
global.fetch = async () => { networkCalls++; throw new Error('Network is forbidden in this test'); };
console.error = (...args) => logs.push(args);
const dependencies = {
  '@/lib/auth': { customer: async () => { calls.push('customer'); return scenario.signedOut ? null : user; } },
  '@/lib/runtime': {
    runtime: () => ({}), timestamp: () => clock,
    parse: (value, fallback) => value ? JSON.parse(value) : fallback,
    one: async (query, ...values) => {
      calls.push('order');
      assert.equal(query, 'SELECT id,status,total,checkout_ref,data,created FROM orders WHERE id=? AND owner=?');
      assert.deepEqual(values, [orderId, user.id], 'The saved order is read only for the signed-in owner');
      return scenario.order === null ? null : { ...savedOrder, ...scenario.order };
    },
    all: forbidden('database all'), run: forbidden('database write'), database: forbidden('database connection'),
  },
  '@/lib/payments': { paymentProvider: () => 'authorizenet', paymentEnvironment: () => 'isolated' },
  '@/lib/catalog-visibility': visibility,
  '@/lib/order-summary': summary,
  '@/lib/authorizenet-payments': {
    createAnetAdapter: () => ({
      verifyPayment: async (...args) => {
        calls.push('verify');
        assert.deepEqual(args, [expectedOrder, savedOrder.checkout_ref, [], savedOrder.created]);
        if (scenario.verifyError) throw scenario.verifyError;
        return scenario.verification || { state: 'pending', underReview: false };
      },
      hostedForm: async (...args) => {
        assert.equal(calls.at(-1), 'verify', 'Always verify a prior payment before issuing a new form');
        calls.push('form');
        assert.deepEqual(args, [expectedOrder, { email: user.email, customerId: user.id }, summary.anetOrderDetails(data)], 'Saved totals and itemized receipt details are unchanged');
        if (scenario.formError) throw scenario.formError;
        return form;
      },
    }),
  },
};
Module._load = function(name, parent, isMain) {
  if (parent?.filename === path.join(root, 'app/api/store/[action]/route.ts')) {
    if (name === 'next/server') return { NextResponse: TestResponse };
    if (name === 'next/headers') return { cookies: forbidden('cookies') };
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith('@/')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : forbidden(name + ':' + String(key)) });
  }
  return originalLoad.call(this, name, parent, isMain);
};

(async () => {
  const { GET } = require('../app/api/store/[action]/route.ts');
  async function pay(options = {}) {
    scenario = options; calls = []; logs = [];
    const req = new Request('https://store.example.invalid/api/store/pay?id=' + orderId);
    req.nextUrl = new URL(req.url);
    const response = await GET(req, { params: Promise.resolve({ action: 'pay' }) });
    const html = await response.text();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert(html.includes('<meta name="robots" content="noindex,nofollow">'));
    return { status: response.status, html };
  }
  function assertUncertain(result, expectedCalls) {
    assert.equal(result.status, 502);
    assert(result.html.includes(uncertain));
    assert(result.html.includes('href="/account/orders"'));
    assert(!result.html.includes('No payment has been taken') && !result.html.includes('<form') && !result.html.includes('ISOLATED_TOKEN'));
    assert.deepEqual(calls, expectedCalls);
    assert.equal(logs.length, 1, 'Existing diagnostic logging remains in place');
  }

  const timeout = new Error('ISOLATED_PRIVATE_TIMEOUT_DETAIL');
  const verificationFailure = await pay({ verifyError: timeout });
  assertUncertain(verificationFailure, ['customer', 'order', 'verify']);
  assert(!verificationFailure.html.includes(timeout.message), 'An ordinary provider exception is not exposed');

  const formFailure = await pay({ formError: timeout });
  assertUncertain(formFailure, ['customer', 'order', 'verify', 'form']);
  assert(!formFailure.html.includes(timeout.message));

  // The existing named provider error remains visible only through HTML escaping.
  const providerError = new Error('ISOLATED_CODE: <unsafe> & "quoted"');
  providerError.name = 'AnetPaymentError';
  for (const options of [{ verifyError: providerError }, { formError: providerError }]) {
    const result = await pay(options);
    assertUncertain(result, ['customer', 'order', 'verify', ...(options.formError ? ['form'] : [])]);
    assert(result.html.includes('ISOLATED_CODE: &#60;unsafe&#62; &#38; &#34;quoted&#34;'));
    assert(!result.html.includes('<unsafe>'));
  }

  const paid = await pay({ verification: { state: 'paid' } });
  assert.equal(paid.status, 200);
  assert(paid.html.includes('We already have a payment for this order.') && paid.html.includes('href="/payment/return"'));
  assert(!paid.html.includes('<form') && !paid.html.includes(uncertain));
  assert.deepEqual(calls, ['customer', 'order', 'verify']);
  for (const verification of [{ state: 'review' }, { state: 'pending', underReview: true }]) {
    const result = await pay({ verification });
    assert.equal(result.status, 400);
    assert(result.html.includes('Please do not pay again.') && !result.html.includes('<form'));
    assert.deepEqual(calls, ['customer', 'order', 'verify']);
  }

  const ready = await pay();
  assert.equal(ready.status, 200);
  assert.deepEqual(calls, ['customer', 'order', 'verify', 'form']);
  assert(ready.html.includes('method="post" action="' + form.action + '"'));
  assert(ready.html.includes('value="ISOLATED_TOKEN&#60;&#38;&#34;"') && !ready.html.includes(uncertain));
  assert.equal(logs.length, 0);
  for (const order of [null, { status: 'paid' }, { status: 'review' }, { data: JSON.stringify({ ...data, environment: 'wrong-environment' }) }, { data: JSON.stringify({ ...data, items: [] }) }]) {
    const result = await pay({ order });
    assert.equal(result.status, 400);
    assert(result.html.includes('This payment requires review.') && !result.html.includes('<form'));
    assert.deepEqual(calls, ['customer', 'order'], 'Ineligible saved orders cannot reach the provider');
  }
  assert.equal((await pay({ signedOut: true })).status, 401);
  assert.deepEqual(calls, ['customer'], 'Signed-out requests do not read saved orders or contact a provider');
  assert.equal(JSON.stringify(savedOrder), before, 'The saved order fixture remains unchanged');
  assert.equal(networkCalls, 0);
  console.log('PASS: actual GET pay handler reports uncertainty for verification/form errors; no form after failed verification or paid/review status; escaped provider detail, owner checks, receipt arguments and security headers preserved; no network or order writes');
})().catch(error => { originalError(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad; global.fetch = originalFetch; console.error = originalError;
});
