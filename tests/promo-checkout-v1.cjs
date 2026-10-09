/* Actual promo/cart/checkout code over isolated in-memory SQLite.
 * Shipping and payment adapters are mocked; no network, live database, or real orders. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const root = path.resolve(__dirname, '..');
const sql = new DatabaseSync(':memory:');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
class Statement {
  constructor(query, values = []) { this.query = query; this.values = values; }
  bind(...values) { return new Statement(this.query, values); }
  async first() { return sql.prepare(this.query).get(...this.values) || null; }
  async all() { return { results: sql.prepare(this.query).all(...this.values) }; }
  async run() { const result = sql.prepare(this.query).run(...this.values); return { meta: { changes: result.changes } }; }
}
const db = {
  prepare: query => new Statement(query),
  async batch(statements) {
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
};
let clock = Date.now();
const env = { FIXED_TAX_RATE: '8.375', FIXED_TAX_STATE: 'NV' };
const runtime = {
  runtime: () => env, database: () => db, timestamp: () => clock, uid: randomUUID,
  parse: (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } },
  all: async (query, ...values) => (await db.prepare(query).bind(...values).all()).results,
  one: async (query, ...values) => db.prepare(query).bind(...values).first(),
  run: async (query, ...values) => db.prepare(query).bind(...values).run(),
  setting: async (key, fallback) => { const row = sql.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; },
};
const paymentRequests = [];
const originalLoad = Module._load, originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Network is forbidden in this test'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/checkout.ts') || parent?.filename.endsWith('/lib/commerce.ts')) {
    if (request === './runtime') return runtime;
    if (request === './auth') return { customer: async () => ({ email: 'fixture@example.invalid' }) };
    if (request === './easypost') return { easypostReady: () => false, cheapestRate: async () => { throw new Error('Shipping network must not be called'); } };
    if (request === './payments') return {
      paymentEnvironment: () => 'isolated', paymentReturnUrl: () => 'https://example.invalid/return',
      createPaymentAdapter: () => ({ getStatus: () => ({ checkoutEnabled: true }), reference: id => 'isolated-' + id,
        createCheckout: async order => { paymentRequests.push(order); return { providerReference: 'isolated-' + order.id, url: '/isolated-payment/' + order.id }; } }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { products } = require('../lib/catalog.ts');
const { quote, validateLines } = require('../lib/commerce.ts');
const { deliveryQuote, issueQuote, checkout } = require('../lib/checkout.ts');
const bpc = products.find(product => product.slug === 'bpc-157-10mg');
const mots = products.find(product => product.slug === 'mots-c-10mg');
const semax = products.find(product => product.slug === 'semax');
assert(bpc && mots && semax, 'Existing product identities are used only as isolated fixtures');
const originals = JSON.stringify(products);
function productOverride(product, price, extra = {}) {
  sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(product.id, JSON.stringify({ price, inStock: true, purchasable: true, stockQuantity: 100, maxQuantity: 100, sale: null, packPrices: {}, ...extra }));
}
function storeConfig(extra = {}) {
  sql.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('store', JSON.stringify({ shippingCents: 500, freeShippingAt: 10000, presalesEnabled: true, packDiscounts: { '1': 0, '3': 10, '5': 15, '10': 20 }, ...extra }));
}
const one = [{ id: bpc.id, quantity: 1 }];
const fixed = [{ id: bpc.id, quantity: 3, packId: 'fixed-promo-test', packSize: 3, packKind: 'fixed' }];
const address = { name: 'Isolated fixture', line1: '1 Example Road', line2: '', city: 'Las Vegas', state: 'NV', zip: '89101', country: 'US', phone: '7025550100' };
const orderRows = () => Number(sql.prepare('SELECT COUNT(*) AS n FROM orders').get().n);
function reconcile(q) {
  assert(Number.isSafeInteger(q.total) && q.total >= 0);
  assert.equal(q.items.reduce((sum, item) => sum + item.lineTotal, 0), q.total, 'Every discounted cent is allocated to a line');
  assert.equal(q.subtotal - q.discount, q.total);
  assert.equal(q.packDiscount + q.promoDiscount, q.discount);
  assert.equal(q.promo?.savings || 0, q.promoDiscount);
  for (const item of q.items) assert(Number.isSafeInteger(item.lineTotal) && item.lineTotal >= 0, 'No fractional/negative line amount');
}
function requestBody(q, extra = {}) { return { accepted: true, requestKey: randomUUID(), address, expectedTotal: q.total, quoteId: q.quoteId, ...extra }; }
async function denied(action, pattern) {
  const beforeOrders = orderRows(), beforePayments = paymentRequests.length;
  await assert.rejects(action, pattern);
  assert.equal(orderRows(), beforeOrders, 'Rejected input creates no order');
  assert.equal(paymentRequests.length, beforePayments, 'Rejected input starts no payment');
}
// Exercise the real API entry points, cookie contract, and cart-import guards.
// Only framework cookies/auth/payment status are mocked; routes, SQL, quote and
// checkout all execute their production implementations against this memory DB.
async function apiCookieIntegration() {
  const inheritedLoad = Module._load;
  const cookieValues = new Map(), cookieWrites = [];
  const cookieJar = {
    get: name => cookieValues.has(name) ? { name, value: cookieValues.get(name) } : undefined,
    set: (name, value, options) => { cookieValues.set(name, value); cookieWrites.push({ name, value, options }); },
    delete: name => { cookieValues.delete(name); },
  };
  let user = null, sessionId = randomUUID();
  let rateLimited = 0, expectedRates = 0;
  const sessionRow = () => sql.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  const seedSession = cart => sql.prepare('INSERT INTO sessions(id,cart,updated) VALUES(?,?,?)').run(sessionId, JSON.stringify(cart), clock);
  seedSession(one);
  Module._load = function(request, parent, isMain) {
    if (parent?.filename.endsWith('/app/api/store/[action]/route.ts')) {
      if (request === 'next/headers') return { cookies: async () => cookieJar };
      if (request === 'next/server') return { NextResponse: { json: (value, options) => new Response(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }) } };
      if (request === '@/lib/runtime') return runtime;
      if (request === '@/lib/auth') return {
        customer: async () => user, requireCustomer: async () => { if (!user) throw new Error('Please sign in.'); return user; },
        session: async () => sessionRow(), authReady: () => true,
        requireAdmin: async () => { throw new Error('No admin access in promo tests'); },
        rateLimit: async (key, limit) => { assert.equal(limit, 120); assert(key.endsWith(sessionId)); rateLimited++; },
        authCall: async () => { throw new Error('No external auth in promo tests'); },
        storeAuth: async () => { throw new Error('No external auth in promo tests'); },
      };
      if (request === '@/lib/payments') return { getPaymentStatus: () => ({ state: 'ready', checkoutEnabled: true }), paymentEnvironment: () => 'isolated' };
      if (request === '@/lib/authorizenet-payments') return { createAnetAdapter: () => { throw new Error('No payment network in API tests'); } };
    }
    return inheritedLoad.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain);
  };
  try {
    const { GET, POST } = require('../app/api/store/[action]/route.ts');
    async function api(action, body, options = {}) {
      const url = 'https://example.invalid/api/store/' + action;
      const req = new Request(url, body === undefined ? {} : { method: 'POST', headers: { origin: options.origin || 'https://example.invalid', 'content-type': 'application/json' }, body: JSON.stringify(body) });
      req.nextUrl = new URL(url);
      if (body !== undefined && (!options.origin || options.origin === 'https://example.invalid')) expectedRates++;
      const response = await (body === undefined ? GET : POST)(req, { params: Promise.resolve({ action }) });
      assert.equal(rateLimited, expectedRates, action + ' preserves rate limiting after the origin guard');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, data: await response.json() };
    }
    const applied = await api('promo', { code: ' biomod15 ', percentOff: 100, savings: 999999 });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    assert.equal(applied.data.totals.total, 8500);
    assert.deepEqual(applied.data.promo, { code: 'BIOMOD15', percentOff: 15, savings: 1500 });
    assert.deepEqual(cookieWrites.at(-1), { name: 'bm_promo', value: 'BIOMOD15', options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 2592000 } });
    for (const code of ['BIOMOD99', '__proto__', 'constructor', ['BIOMOD20'], { code: 'BIOMOD20' }, 'BIOMOD10,BIOMOD20']) {
      const rejected = await api('promo', { code });
      assert.equal(rejected.status, 400); assert.equal(cookieValues.get('bm_promo'), 'BIOMOD15', 'A failed code must preserve the applied code');
    }
    const crossOrigin = await api('promo', { code: 'BIOMOD20' }, { origin: 'https://attacker.invalid' });
    assert.equal(crossOrigin.status, 403); assert.equal(cookieValues.get('bm_promo'), 'BIOMOD15');
    assert.equal((await api('state')).data.totals.total, 8500, 'State derives discount from the server cookie');
    const updatedCart = await api('cart', { cart: one, promoCode: 'BIOMOD20', percentOff: 100 });
    assert.equal(updatedCart.status, 200); assert.equal(updatedCart.data.totals.total, 8500, 'Cart body cannot select or inflate the discount');
    cookieValues.set('bm_promo', 'BIOMOD999');
    const repaired = await api('state');
    assert.equal(repaired.status, 200); assert.equal(repaired.data.totals.total, 10000);
    assert.equal(cookieValues.has('bm_promo'), false, 'Invalid/tampered cookie is cleared without breaking the cart');
    assert.equal((await api('promo', { code: 'BIOMOD10' })).status, 200);
    sql.prepare('UPDATE sessions SET cart=? WHERE id=?').run('[]', sessionId);
    assert.equal((await api('promo', { code: 'BIOMOD20' })).status, 400);
    assert.equal(cookieValues.get('bm_promo'), 'BIOMOD10', 'Empty-cart apply must not replace the prior cookie');
    sql.prepare('UPDATE sessions SET cart=? WHERE id=?').run(JSON.stringify(one), sessionId);
    productOverride(bpc, 10000, { inStock: false });
    assert.equal((await api('promo', { code: '' })).status, 200, 'Removal works after merchandise becomes unavailable');
    assert.equal(cookieValues.has('bm_promo'), false);
    productOverride(bpc, 10000);
    assert.equal((await api('promo', { code: 'BIOMOD10' })).status, 200);
    user = { id: 'api-promo-owner', name: 'Isolated fixture', email: 'fixture@example.invalid' };
    assert.equal((await api('state')).status, 200, 'Server cart and promo survive the guest-to-account boundary');
    assert.equal((await api('state')).data.totals.promo.code, 'BIOMOD10');
    const guestQuote = await api('delivery', { address, promoCode: 'BIOMOD20', savings: 999999 });
    assert.equal(guestQuote.status, 200, JSON.stringify(guestQuote.data));
    assert.equal(guestQuote.data.total, 10254); assert.equal(guestQuote.data.promo.code, 'BIOMOD10');
    assert.equal((await api('promo', { code: 'BIOMOD20' })).status, 200);
    const beforeOrders = orderRows(), beforePayments = paymentRequests.length;
    const stale = await api('checkout', requestBody(guestQuote.data));
    assert.equal(stale.status, 400); assert.match(stale.data.error, /quote changed or expired/);
    assert.equal(orderRows(), beforeOrders); assert.equal(paymentRequests.length, beforePayments, 'Changing a code cannot charge an old quote');
    const current = await api('delivery', { address });
    assert.equal(current.status, 200); assert.equal(current.data.total, 9170);
    const paid = await api('checkout', requestBody(current.data, { promoCode: 'BIOMOD10', promoDiscount: 999999, total: 1 }));
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paymentRequests.at(-1).totalCents, 9170, 'API checkout uses the cookie and revalidated totals, not body amounts');
    const saved = JSON.parse(sql.prepare('SELECT data FROM orders WHERE id=?').get(paid.data.id).data);
    assert.equal(saved.promo.code, 'BIOMOD20');
    assert(rateLimited > 0, 'The real API test exercised POST rate limiting');
  } finally { Module._load = inheritedLoad; }
}
(async () => {
  productOverride(bpc, 10000, { packPrices: { '3': 27000, '5': 42500, '10': 80000 } });
  productOverride(mots, 5001);
  productOverride(semax, 1003);
  storeConfig();
  for (const code of [undefined, null, '', '   ']) {
    const q = await quote(one, code); reconcile(q); assert.equal(q.promo, null); assert.equal(q.total, 10000); assert.equal(q.promoDiscount, 0);
  }
  for (const [code, percent] of [['BIOMOD10', 10], ['BIOMOD15', 15], ['BIOMOD20', 20]]) {
    const q = await quote(one, code); reconcile(q);
    assert.deepEqual(q.promo, { code, percentOff: percent, savings: percent * 100 });
    assert.equal(q.total, 10000 - percent * 100);
  }
  assert.deepEqual(await quote(one, ' biomod15 '), await quote(one, 'BIOMOD15'), 'Code case/spacing normalizes');
  for (const code of ['BIOMOD99', 'BIOMOD10 BIOMOD20', 'BIOMOD10,BIOMOD20', 'BIOMOD10\u0000', 'X'.repeat(10000), 20, false, [], {}, { code: 'BIOMOD20', percentOff: 100 }]) await assert.rejects(quote(one, code));
  const empty = await quote([], 'BIOMOD20'); reconcile(empty); assert.equal(empty.total, 0);
  // Large but permitted admin prices must also allocate the last cent exactly.
  // Multiplying total*savings as a floating-point number loses a cent here.
  productOverride(bpc, 2450469); productOverride(semax, 27);
  const large = await quote([{ id: bpc.id, quantity: 100 }, { id: semax.id, quantity: 1 }], 'BIOMOD15');
  assert.equal(large.subtotal, 245046927); assert.equal(large.promoDiscount, 36757039); reconcile(large);
  productOverride(bpc, 10000, { packPrices: { '3': 27000, '5': 42500, '10': 80000 } }); productOverride(semax, 1003);
  const fixedQuote = await quote(fixed, 'BIOMOD20'); reconcile(fixedQuote);
  assert.equal(fixedQuote.subtotal, 30000); assert.equal(fixedQuote.packDiscount, 3000); assert.equal(fixedQuote.promoDiscount, 5400); assert.equal(fixedQuote.total, 21600, 'Promo stacks after fixed-pack savings');
  const mixed = [bpc, mots, semax].map(product => ({ id: product.id, quantity: 1, packId: 'mixed-promo-test', packSize: 3, packKind: 'mixed' }));
  const mixedQuote = await quote(mixed, 'BIOMOD15'); reconcile(mixedQuote);
  assert.equal(mixedQuote.subtotal, 16004); assert.equal(mixedQuote.packDiscount, 1600); assert.equal(mixedQuote.promoDiscount, 2161); assert.equal(mixedQuote.total, 12243, 'Mixed pack promo rounds once across net merchandise');
  const reversed = await quote([...mixed].reverse(), 'BIOMOD15'); reconcile(reversed); assert.equal(reversed.total, mixedQuote.total, 'Line order cannot change the total');
  const freePack = [{ ...fixed[0], id: semax.id, packId: 'free-mixed-fixture', packKind: 'mixed' }];
  storeConfig({ packDiscounts: { '3': 100 } });
  const free = await quote(freePack, 'BIOMOD20'); reconcile(free); assert.equal(free.total, 0); assert.equal(free.promoDiscount, 0, 'A zero net pack is not discounted twice');
  const partlyFree = await quote([...freePack, ...one], 'BIOMOD20'); reconcile(partlyFree); assert.equal(partlyFree.total, 8000); assert.equal(partlyFree.items[0].lineTotal, 0, 'Promo allocation skips zero net lines');
  storeConfig();
  const activeSale = { enabled: true, percentOff: 20, starts: new Date(clock - 86400000).toISOString(), ends: new Date(clock + 86400000).toISOString() };
  productOverride(bpc, 10000, { packPrices: { '3': 27000 }, sale: activeSale });
  const saleQuote = await quote(fixed, 'BIOMOD20'); reconcile(saleQuote);
  assert.equal(saleQuote.subtotal, 24000); assert.equal(saleQuote.packDiscount, 2400); assert.equal(saleQuote.promoDiscount, 4320); assert.equal(saleQuote.total, 17280, 'Promo stacks after the current sale and pack price');
  productOverride(bpc, 10000, { packPrices: { '3': 27000 } });
  sql.prepare('INSERT INTO campaigns(id,data,active) VALUES(?,?,1)').run('promo-presale', JSON.stringify({ starts: new Date(clock - 86400000).toISOString(), ends: new Date(clock + 86400000).toISOString(), maxPerCustomer: 10, productIds: [bpc.id] }));
  const presale = await quote([{ ...one[0], presaleId: 'promo-presale' }], 'BIOMOD10'); reconcile(presale); assert.equal(presale.total, 9000, 'Presale merchandise is not silently excluded');
  const sanitized = validateLines([{ ...one[0], price: 1, lineTotal: 1, percentOff: 100, promoDiscount: 999999 }]);
  assert.deepEqual(sanitized, one); assert.equal((await quote(sanitized, 'BIOMOD10')).total, 9000, 'Client-supplied amounts do not determine pricing');
  await assert.rejects(quote([{ ...one[0], quantity: 101 }], 'BIOMOD20'), /availability/);
  await assert.rejects(quote([{ ...fixed[0], quantity: 2 }], 'BIOMOD20'), /Complete every slot/);
  productOverride(mots, 5001, { inStock: false });
  await assert.rejects(quote([{ id: mots.id, quantity: 1 }], 'BIOMOD20'), /available/);

  // Both tax paths must use discounted merchandise; this fixture uses real fixed-tax code.
  const withoutPromo = await deliveryQuote(one, address);
  assert.equal(withoutPromo.shipping, 0); assert.equal(withoutPromo.tax, 838); assert.equal(withoutPromo.total, 10838);
  const withPromo = await deliveryQuote(one, address, undefined, 'BIOMOD10');
  assert.equal(withPromo.shipping, 500, 'Free-shipping threshold uses discounted merchandise');
  assert.equal(withPromo.tax, 754); assert.equal(withPromo.total, 10254);
  assert.equal(withPromo.promo.code, 'BIOMOD10'); assert.equal(withPromo.promoDiscount, 1000); assert.equal(withPromo.packDiscount, 0);
  env.TAXJAR_API_TOKEN = 'isolated-test-token'; env.STORE_ORIGIN_ZIP = '89101'; env.STORE_ORIGIN_STATE = 'NV';
  let taxRequests = 0;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.taxjar.com/v2/taxes');
    const payload = JSON.parse(options.body);
    assert.equal(payload.amount, 90, 'Tax service receives the discounted merchandise amount');
    assert.equal(payload.shipping, 5); assert.equal(payload.to_state, 'NV'); taxRequests++;
    return new Response(JSON.stringify({ tax: { amount_to_collect: 7.54 } }), { status: 200 });
  };
  const serviceTax = await deliveryQuote(one, address, undefined, 'BIOMOD10');
  assert.equal(taxRequests, 1); assert.equal(serviceTax.tax, 754); assert.equal(serviceTax.total, 10254);
  delete env.TAXJAR_API_TOKEN; delete env.STORE_ORIGIN_ZIP; delete env.STORE_ORIGIN_STATE;
  global.fetch = async () => { throw new Error('Network is forbidden in this test'); };
  const q = await issueQuote('promo-owner', one, address, 'BIOMOD10');
  const result = await checkout('promo-owner', one, requestBody(q, { percentOff: 100, promoDiscount: 999999, promoCode: 'BIOMOD20' }), ' biomod10 ');
  const order = sql.prepare('SELECT * FROM orders WHERE id=?').get(result.id), saved = JSON.parse(order.data);
  assert.equal(order.status, 'awaiting_payment'); assert.equal(order.total, 10254);
  assert.equal(paymentRequests.at(-1).totalCents, 10254, 'Payment adapter receives the authoritative discounted total');
  assert.deepEqual(saved.promo, { code: 'BIOMOD10', percentOff: 10, savings: 1000 });
  assert.deepEqual(JSON.parse(saved.fingerprint), { lines: one, address, promoCode: 'BIOMOD10' });
  const beforeResume = paymentRequests.length;
  const resumed = await checkout('promo-owner', one, requestBody(q), 'BIOMOD10');
  assert.equal(resumed.id, result.id); assert.equal(paymentRequests.length, beforeResume, 'Matching code resumes without a second payment');
  await denied(() => checkout('promo-owner', one, requestBody(q), 'BIOMOD20'), /unresolved checkout/);
  await denied(() => checkout('promo-owner', one, requestBody(q)), /unresolved checkout/);

  // Changing only the code invalidates a quote even when rounding makes totals equal.
  productOverride(semax, 1);
  const penny = [{ id: semax.id, quantity: 1 }];
  const penny10 = await issueQuote('penny-quote', penny, address, 'BIOMOD10');
  assert.equal(penny10.total, (await deliveryQuote(penny, address, undefined, 'BIOMOD20')).total);
  await denied(() => checkout('penny-quote', penny, requestBody(penny10), 'BIOMOD20'), /quote changed or expired/);
  const pennyOrder = await checkout('penny-quote', penny, requestBody(penny10), 'BIOMOD10');
  assert(pennyOrder.id);
  await denied(() => checkout('penny-quote', penny, requestBody(penny10), 'BIOMOD20'), /unresolved checkout/);
  const stale = await issueQuote('stale-owner', one, address, 'BIOMOD10');
  await denied(() => checkout('stale-owner', one, requestBody(stale), 'BIOMOD20'), /quote changed or expired/);
  await denied(() => checkout('stale-owner', one, requestBody(stale, { expectedTotal: 1 }), 'BIOMOD10'), /total changed/);
  await denied(() => checkout('stale-owner', one, requestBody(stale), { code: 'BIOMOD10', savings: 999999 }));
  await denied(() => checkout('another-owner', one, requestBody(stale), 'BIOMOD10'), /quote changed or expired/);
  clock += 600001;
  await denied(() => checkout('stale-owner', one, requestBody(stale), 'BIOMOD10'), /quote changed or expired/);
  clock -= 600001;
  const plain = await issueQuote('plain-owner', one, address);
  const plainResult = await checkout('plain-owner', one, requestBody(plain));
  const plainSaved = JSON.parse(sql.prepare('SELECT data FROM orders WHERE id=?').get(plainResult.id).data);
  assert.deepEqual(JSON.parse(plainSaved.fingerprint), { lines: one, address }, 'No-promo checkout remains compatible with existing fingerprints');
  assert.equal(plainSaved.promo, null); assert.equal(plainSaved.promoDiscount, 0);
  await apiCookieIntegration();
  assert.equal(JSON.stringify(products), originals, 'The source catalog is unchanged');
  assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM transaction_guards').get().n), 0);
  console.log('PASS: server promo validation, stacked fixed/mixed/sale/presale savings, exact cent allocation, discounted shipping/tax, authoritative payment totals, code-bound quote/resume protection, stock guards, no-promo compatibility, and real API cookie integration');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; global.fetch = originalFetch; sql.close(); });
