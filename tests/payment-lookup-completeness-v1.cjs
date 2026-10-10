/* Actual Authorize.net adapter + actual GET pay handler, using only local fixtures.
 * All HTTP is injected; live network, database writes and order mutation are forbidden. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const originalTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const originalFetch = global.fetch, originalLoad = Module._load, originalError = console.error;
let liveCalls = 0;
global.fetch = async () => { liveCalls++; throw new Error('Live network is forbidden'); };
const anet = require(path.join(root, 'lib/authorizenet-payments.ts'));
const payment = require(path.join(root, 'lib/payments.ts'));
const visibility = require(path.join(root, 'lib/catalog-visibility.ts'));
const summary = require(path.join(root, 'lib/order-summary.ts'));
const { products } = require(path.join(root, 'lib/catalog.ts'));
const env = {
  PAYMENT_PROVIDER: 'authorizenet', AUTHORIZENET_ENVIRONMENT: 'sandbox',
  AUTHORIZENET_API_LOGIN_ID: 'fixtureLogin', AUTHORIZENET_TRANSACTION_KEY: 'A'.repeat(16),
  AUTHORIZENET_SIGNATURE_KEY: 'B'.repeat(128), AUTHORIZENET_RETURN_URL: 'https://store.example.invalid/payment/return',
  AUTHORIZENET_CONNECTION_VERIFIED: 'true', COMMERCE_MODE: 'sandbox',
};
const now = Date.now(), created = now - 2 * 86400000;
const order = { id: '00000000-0000-4000-8000-000000000041', totalCents: 4900, currency: 'USD' };
const reference = anet.anetOrderReference(order.id);
const match = (id = '1001') => ({ transId: id, invoiceNumber: reference });
const fullPage = () => Array.from({ length: 1000 }, (_, index) => ({ transId: String(index + 20000), invoiceNumber: 'UNRELATED_FIXTURE' }));
const details = (id, status = 'settledSuccessfully') => ({
  transId: id, transactionType: 'authCaptureTransaction', transactionStatus: status,
  responseCode: status === 'declined' ? 2 : 1, settleAmount: '49.00', authAmount: '49.00', order: { invoiceNumber: reference },
});
function gateway({ batchCount = 1, page = () => [], unsettled = [], transaction = id => details(id) } = {}) {
  const calls = [];
  const ok = body => new Response(JSON.stringify({ ...body, messages: { resultCode: 'Ok' } }), { status: 200 });
  const request = async (url, init) => {
    assert.equal(url, anet.ANET_API.sandbox, 'Only the sandbox-shaped injected fixture is addressed');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body), keys = Object.keys(body);
    assert.equal(keys.length, 1);
    const kind = keys[0], value = body[kind];
    calls.push({ kind, batchId: value.batchId, offset: value.paging?.offset });
    if (kind === 'getUnsettledTransactionListRequest') return ok({ transactions: unsettled });
    if (kind === 'getSettledBatchListRequest') return ok({ batchList: Array.from({ length: batchCount }, (_, i) => ({ batchId: String(i + 1) })) });
    if (kind === 'getTransactionListRequest') {
      assert.equal(value.paging.limit, 1000, 'Keep the existing per-page bound');
      assert(value.paging.offset >= 1 && value.paging.offset <= 5, 'Keep the existing page bound');
      return ok({ transactions: page(Number(value.batchId), value.paging.offset) });
    }
    if (kind === 'getTransactionDetailsRequest') return ok({ transaction: transaction(value.transId) });
    if (kind === 'getHostedPaymentPageRequest') return ok({ token: 'ISOLATED_HOSTED_TOKEN' });
    throw new Error('Unexpected provider operation: ' + kind);
  };
  return { calls, request, adapter: anet.createAnetAdapter(env, request) };
}
const verify = fixture => fixture.adapter.verifyPayment(order, reference, [], created);
const lists = fixture => fixture.calls.filter(call => call.kind === 'getTransactionListRequest');
async function incomplete(fixture) {
  await assert.rejects(verify(fixture), error => {
    assert(error instanceof anet.AnetPaymentError);
    assert.equal(error.code, 'TOO_MANY_RESULTS');
    assert.equal(error.message, 'Authorize.net results require manual reconciliation.');
    assert.equal(Object.hasOwn(error, 'state'), false, 'No paid, failed or pending state is inferred from an incomplete search');
    return true;
  });
  assert(!fixture.calls.some(call => call.kind === 'getTransactionDetailsRequest'), 'Do not classify a partial set of candidate transactions');
  assert(!fixture.calls.some(call => call.kind === 'getHostedPaymentPageRequest'));
}

(async () => {
  // The complete 40-batch boundary must still search the last batch.
  const forty = gateway({ batchCount: 40, page: batch => batch === 40 ? [match()] : [] });
  assert.equal((await verify(forty)).state, 'paid');
  assert.equal(lists(forty).length, 40);
  assert.equal(lists(forty).at(-1).batchId, '40');

  // A 41st batch must not be silently discarded, even if a candidate capture is
  // already present in the unsettled list; the omitted data may contain another.
  const fortyOne = gateway({ batchCount: 41, unsettled: [match()] });
  await incomplete(fortyOne);
  assert.equal(lists(fortyOne).length, 0, 'Reject known batch truncation before scanning a subset');

  const capped = gateway({ page: (_batch, offset) => { const rows = fullPage(); if (offset === 1) rows[0] = match(); return rows; } });
  await incomplete(capped);
  assert.deepEqual(lists(capped).map(call => call.offset), [1, 2, 3, 4, 5]);

  const laterCap = gateway({ batchCount: 2, page: (batch) => batch === 1 ? [match()] : fullPage() });
  await incomplete(laterCap);
  assert.equal(lists(laterCap).length, 6, 'A later truncated batch prevents classifying an earlier capture');

  // Four full pages followed by a shorter fifth are complete; classification
  // must include a match appearing only at the very end of that terminal page.
  const shorter = gateway({ page: (_batch, offset) => offset < 5 ? fullPage() : [...fullPage().slice(0, 998), match()] });
  assert.equal((await verify(shorter)).state, 'paid');
  assert.deepEqual(lists(shorter).map(call => call.offset), [1, 2, 3, 4, 5]);
  const emptyTerminal = gateway({ page: (_batch, offset) => offset < 5 ? fullPage() : [] });
  assert.equal((await verify(emptyTerminal)).state, 'pending');
  assert.equal(lists(emptyTerminal).length, 5);
  const shortFirst = gateway({ page: () => [match()] });
  assert.equal((await verify(shortFirst)).state, 'paid');
  assert.equal(lists(shortFirst).length, 1);
  assert.equal((await verify(gateway({ batchCount: 0 }))).state, 'pending');
  assert.equal((await verify(gateway({ page: () => [match()], transaction: id => details(id, 'declined') }))).state, 'failed');
  const review = await verify(gateway({ page: () => [match()], transaction: id => details(id, 'FDSPendingReview') }));
  assert.equal(review.state, 'pending'); assert.equal(review.underReview, true);
  assert.equal((await verify(gateway({ page: () => [match('1001'), match('1002')] }))).state, 'review', 'Complete duplicate captures retain manual review');

  // Run the actual GET route against the real adapter that raises the cap error.
  // Runtime/auth/order are isolated and every database mutation is forbidden.
  const user = { id: 'isolated-owner', email: 'fixture@example.invalid' };
  const product = products.find(item => item.slug === 'bpc-157-10mg');
  assert(product);
  const saved = {
    id: order.id, total: order.totalCents, status: 'awaiting_payment', checkout_ref: reference, created,
    data: JSON.stringify({ environment: 'authorizenet:sandbox', items: [{ id: product.id, quantity: 1, lineTotal: order.totalCents, product: { name: product.name, price: order.totalCents } }], tax: 0, shipping: 0 }),
  };
  const before = JSON.stringify(saved);
  let activeFixture, orderReads = 0, writes = 0, logs = [];
  const forbidden = name => () => { writes++; throw new Error('Forbidden route dependency: ' + name); };
  class TestResponse extends Response {
    static json(value, options = {}) { return new TestResponse(JSON.stringify(value), options); }
  }
  const dependencies = {
    '@/lib/auth': { customer: async () => user },
    '@/lib/runtime': {
      runtime: () => env, timestamp: () => now, parse: (value, fallback) => value ? JSON.parse(value) : fallback,
      one: async (query, ...values) => {
        assert.equal(query, 'SELECT id,status,total,checkout_ref,data,created FROM orders WHERE id=? AND owner=?');
        assert.deepEqual(values, [order.id, user.id]); orderReads++; return { ...saved };
      },
      all: forbidden('all'), run: forbidden('run'), database: forbidden('database'),
    },
    '@/lib/payments': payment,
    '@/lib/catalog-visibility': visibility,
    '@/lib/order-summary': summary,
    '@/lib/authorizenet-payments': { ...anet, createAnetAdapter: config => anet.createAnetAdapter(config, activeFixture.request) },
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
  console.error = (...args) => logs.push(args);
  const { GET } = require(path.join(root, 'app/api/store/[action]/route.ts'));
  async function pay(fixture) {
    activeFixture = fixture; logs = [];
    const req = new Request('https://store.example.invalid/api/store/pay?id=' + order.id);
    req.nextUrl = new URL(req.url);
    const response = await GET(req, { params: Promise.resolve({ action: 'pay' }) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    return { status: response.status, html: await response.text() };
  }
  for (const fixture of [gateway({ batchCount: 41 }), gateway({ page: () => fullPage() })]) {
    const result = await pay(fixture);
    assert.equal(result.status, 502);
    assert(result.html.includes('We could not confirm the payment status.'));
    assert(result.html.includes('Authorize.net results require manual reconciliation.'));
    assert(result.html.includes('href="/account/orders"'));
    assert(!result.html.includes('<form') && !result.html.includes('ISOLATED_HOSTED_TOKEN'));
    assert(!fixture.calls.some(call => call.kind === 'getHostedPaymentPageRequest'), 'Incomplete lookup must not request another hosted payment token');
    assert.equal(logs.length, 1);
  }
  const completeEmpty = gateway();
  const open = await pay(completeEmpty);
  assert.equal(open.status, 200); assert(open.html.includes('<form'));
  assert.equal(completeEmpty.calls.filter(call => call.kind === 'getHostedPaymentPageRequest').length, 1, 'Complete no-match search preserves existing hosted-form behavior in fixtures only');
  for (const fixture of [gateway({ page: () => [match()] }), gateway({ page: () => [match()], transaction: id => details(id, 'FDSPendingReview') })]) {
    const result = await pay(fixture);
    assert(!result.html.includes('<form'));
    assert(!fixture.calls.some(call => call.kind === 'getHostedPaymentPageRequest'), 'Paid or under-review orders still cannot receive another form');
  }
  assert.equal(orderReads, 5);
  assert.equal(writes, 0);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(liveCalls, 0);
  console.log('PASS: settled lookup rejects >40 batches and a full fifth page; complete boundaries retain classification; actual GET pay issues no hosted token on real adapter cap errors; no live requests or order writes');
})().catch(error => { originalError(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch; Module._load = originalLoad; console.error = originalError;
  if (originalTs) require.extensions['.ts'] = originalTs; else delete require.extensions['.ts'];
});
