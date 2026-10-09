/* Real aggregate SQL on isolated in-memory SQLite. No production data or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const { promoAnalytics, promoWindow } = require('../lib/promo-analytics.ts');
const { promotion, activePromotions } = require('../lib/promotions.ts');
const sql = new DatabaseSync(':memory:');
sql.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,owner TEXT,status TEXT,total INTEGER,data TEXT,payment_ref TEXT,notification_id TEXT,created INTEGER)');
const now = Date.parse('2026-10-09T17:23:45.123Z');
const start = Date.parse('2026-10-03T00:00:00.000Z');
const sensitive = 'PRIVATE_FIXTURE_PERSON';
const allow = async () => {};
let sequence = 0, queries = [];
function order({ code = 'ANNA20', savings = 200, total = 1000, status = 'paid', environment = 'authorizenet:live', created = start, paymentRef = 'PRIVATE_PAYMENT_REFERENCE', notificationId = 'PRIVATE_NOTIFICATION_REFERENCE', raw, omitSavings = false } = {}) {
  const id = 'private-order-' + (++sequence);
  const data = raw === undefined ? JSON.stringify({ environment, promo: { code, ...(omitSavings ? {} : { savings }), percentOff: 99 }, email: sensitive, address: { name: sensitive }, fingerprint: sensitive }) : raw;
  sql.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)').run(id, sensitive, status, total, data, paymentRef, notificationId, created);
}
const all = async (query, ...values) => {
  assert.match(query.trim(), /^WITH\b/); assert.doesNotMatch(query, /SELECT\s+\*/i);
  assert.doesNotMatch(query, /\b(owner|email|address|fingerprint|sessions|customer_carts)\b/i);
  queries.push({ query, values });
  return sql.prepare(query).all(...values).map(row => ({ ...row }));
};
const getRow = (report, code, environment = 'live') => report.codes.find(p => p.code === code)?.rows.find(r => r.environment === environment);
(async () => {
  assert.deepEqual(activePromotions(), [{ code: 'BM10', percentOff: 10 }, { code: 'BIOMOD15', percentOff: 15 }, { code: 'BMOD20', percentOff: 20 }, { code: 'ANNA20', percentOff: 20 }]);
  assert.deepEqual(promotion(' anna20 '), { code: 'ANNA20', percentOff: 20 });
  for (const code of ['BIOMOD10', 'BIOMOD20', 'BIOM0D15']) assert.throws(() => promotion(code));
  assert.deepEqual(promoWindow('7', now), { days: 7, start, end: now + 1, timeZone: 'UTC', includesPartialToday: true });
  assert.equal(promoWindow(null, now).days, 30);
  assert.equal(promoWindow('30', now).start, Date.parse('2026-09-10T00:00:00Z'));
  assert.equal(promoWindow('90', now).start, Date.parse('2026-07-12T00:00:00Z'));
  assert.equal(promoWindow('all', now).start, 0);
  assert.equal(promoWindow('7', 0).start, 0);
  assert.equal(promoWindow('7', start).end, start + 1, 'A midnight report still includes that instant of the current date');
  for (const value of ['', '0', '07', '365', '7 OR 1=1', '30.0']) assert.throws(() => promoWindow(value, now), /Choose/);
  for (const value of [NaN, Infinity, -1, .5, Number.MAX_SAFE_INTEGER]) assert.throws(() => promoWindow('7', value), /time/);
  const empty = await promoAnalytics({ requireAdmin: allow, all }, null, now);
  assert.equal(empty.codes.length, 4);
  for (const code of empty.codes) {
    assert.equal(code.active, true); assert.equal(code.rows.length, 3);
    assert.deepEqual(code.rows.map(r => r.environment), ['live', 'sandbox', 'unknown']);
    assert(code.rows.every(r => Object.entries(r).every(([key, value]) => key === 'environment' || value === 0)));
  }
  order(); // Inclusive start.
  order({ code: ' anna20 ', savings: 300, total: 1500, status: 'shipped', environment: 'live', created: now }); // Includes partial today and exact asOf.
  order({ status: 'labeling', savings: 40, total: 200 });
  order({ status: 'delivered', savings: 60, total: 300 });
  order({ status: 'pending', savings: 9999, total: 99999 });
  order({ status: 'review' }); order({ status: 'cancelled' }); order({ status: 'failed' });
  order({ paymentRef: null }); order({ notificationId: ' ' });
  order({ omitSavings: true }); order({ savings: -1 }); order({ savings: 1.5 }); order({ savings: '200' }); order({ savings: true }); order({ savings: 9007199254740992 });
  order({ savings: 0 }); // Verified zero is different from absent savings.
  order({ total: null, savings: 10 }); order({ total: -1, savings: 10 }); order({ total: 1.5, savings: 10 }); order({ total: 'invalid', savings: 10 }); order({ total: 9007199254740992, savings: 10 });
  order({ environment: 'sandbox', total: 2000, savings: 400 });
  order({ environment: 'authorizenet:sandbox', total: 3000, savings: 600 });
  order({ environment: 'LIVE', total: 111, savings: 11 });
  order({ environment: null, total: 222, savings: 22 });
  order({ code: 'biomod10', savings: 17, total: 170 });
  order({ code: 'BIOMOD20', savings: 19, total: 190 });
  order({ code: 'BIOMOD15', savings: 7, total: 1000 }); // Saved savings must not be recalculated as 15%.
  order({ code: sensitive, savings: 3, total: 30 });
  order({ code: 'person@example.invalid', savings: 4, total: 40 });
  order({ code: { customer: sensitive }, savings: 5, total: 50 });
  order({ raw: JSON.stringify({ environment: 'live', promo: {} }) });
  order({ raw: JSON.stringify({ environment: 'live', promo: [sensitive] }) });
  for (const raw of ['not valid JSON', 'null', '[]', '{}', JSON.stringify({ promo: null })]) order({ raw });
  order({ created: start - 1, code: 'BM10' }); // Outside 7-day, inside 30-day.
  order({ created: 0, code: 'BM10' }); // Only all time.
  order({ created: now + 1, code: 'BM10' }); // Exclusive upper boundary.
  queries = [];
  const report = await promoAnalytics({ requireAdmin: allow, all }, '7', now);
  assert.equal(report.asOf, now); assert.equal(report.classification, 'unclassified');
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values.slice(0, 2), [start, now + 1]);
  assert.deepEqual(getRow(report, 'ANNA20'), { environment: 'live', orders: 22, paymentRecorded: 16, grossCents: 10000, discountCents: 650, missingPaymentRecords: 2, missingDiscountRecords: 6, missingAmountRecords: 5 });
  assert.deepEqual(getRow(report, 'ANNA20', 'sandbox'), { environment: 'sandbox', orders: 2, paymentRecorded: 2, grossCents: 5000, discountCents: 1000, missingPaymentRecords: 0, missingDiscountRecords: 0, missingAmountRecords: 0 });
  assert.equal(getRow(report, 'ANNA20', 'unknown').orders, 2); assert.equal(getRow(report, 'ANNA20', 'unknown').grossCents, 333);
  assert.equal(getRow(report, 'BIOMOD15').discountCents, 7, 'Report actual saved discount, never current rate × total');
  for (const code of ['BIOMOD10', 'BIOMOD20']) { const p = report.codes.find(p => p.code === code); assert.equal(p.active, false); assert.equal(p.percentOff, null); assert.equal(p.rows.length, 3); }
  assert.equal(getRow(report, 'BIOMOD10').discountCents, 17);
  const unrecognized = report.codes.find(p => p.code === 'Unrecognized code');
  assert.equal(unrecognized.active, false); assert.equal(unrecognized.percentOff, null);
  assert.equal(getRow(report, 'Unrecognized code').orders, 5); assert.equal(getRow(report, 'Unrecognized code').missingDiscountRecords, 2);
  assert.equal(getRow(report, 'BM10').orders, 0);
  const keys = ['environment', 'orders', 'paymentRecorded', 'grossCents', 'discountCents', 'missingPaymentRecords', 'missingDiscountRecords', 'missingAmountRecords'].sort();
  for (const p of report.codes) {
    assert.deepEqual(Object.keys(p).sort(), ['active', 'code', 'percentOff', 'rows']);
    for (const row of p.rows) assert.deepEqual(Object.keys(row).sort(), keys);
  }
  for (const privateValue of [sensitive, 'private-order', 'PRIVATE_PAYMENT_REFERENCE', 'PRIVATE_NOTIFICATION_REFERENCE', 'person@example.invalid', 'fingerprint', 'address', 'email']) assert(!JSON.stringify(report).includes(privateValue));
  const wider = await promoAnalytics({ requireAdmin: allow, all }, '30', now);
  assert.equal(getRow(wider, 'BM10').orders, 1);
  const lifetime = await promoAnalytics({ requireAdmin: allow, all }, 'all', now);
  assert.equal(getRow(lifetime, 'BM10').orders, 2, 'All time includes epoch but excludes future rows');
  queries = [];
  await assert.rejects(promoAnalytics({ requireAdmin: async () => { throw Error('Denied'); }, all }, '365', now), /Denied/);
  assert.equal(queries.length, 0, 'Auth precedes validation and SQL');
  await assert.rejects(promoAnalytics({ requireAdmin: allow, all }, '365', now), /Choose/);
  assert.equal(queries.length, 0, 'Invalid reporting window cannot query');
  await assert.rejects(promoAnalytics({ requireAdmin: allow, all: async () => { throw Error(sensitive); } }, '7', now), /^Error: Promo analytics could not load\. Please retry\.$/);
  const badAggregate = { code: 'ANNA20', ...getRow(report, 'ANNA20'), grossCents: 9007199254740992 };
  await assert.rejects(promoAnalytics({ requireAdmin: allow, all: async () => [badAggregate] }, '7', now), /could not load/);
  const injected = { code: sensitive, ...getRow(report, 'ANNA20') };
  await assert.rejects(promoAnalytics({ requireAdmin: allow, all: async () => [injected] }, '7', now), /could not load/);
  // Real API branch and requireAdmin: identities/auth responses are isolated mocks.
  // Any actual network destination is forbidden, and no customer session is made.
  let identity = null, dbFails = false;
  const env = { SUPABASE_URL: 'https://auth.fixture.invalid', SUPABASE_ANON_KEY: 'isolated-fixture', STORE_ADMIN_EMAILS: 'admin@example.invalid' };
  const originalLoad = Module._load, originalFetch = global.fetch;
  const runtimeMock = { all: async (...args) => { if (dbFails) throw Error(sensitive); return all(...args); }, runtime: () => env };
  global.fetch = async url => { assert.equal(url, 'https://auth.fixture.invalid/auth/v1/user'); return { ok: true, json: async () => identity || {} }; };
  Module._load = function(name, parent, isMain) {
    if (name === 'next/headers') return { cookies: async () => ({ get: () => identity ? { value: 'isolated-fixture-token' } : undefined }) };
    if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, ...options }) } };
    if (name === '@/lib/promo-analytics') return require('../lib/promo-analytics.ts');
    if (name === '@/lib/runtime' || (name === './runtime' && parent?.filename.endsWith('/lib/auth.ts'))) return runtimeMock;
    if (name === '@/lib/auth') return require('../lib/auth.ts');
    if (name.startsWith('@/lib/')) return {};
    return originalLoad.call(this, name, parent, isMain);
  };
  try {
    const { GET } = require('../app/api/store/[action]/route.ts');
    const route = (days = 'all') => GET({ nextUrl: new URL('https://store.fixture.invalid/api/store/admin-promos?days=' + days) }, { params: Promise.resolve({ action: 'admin-promos' }) });
    for (const who of [null, { id: 'fixture-member', email: 'member@example.invalid', email_confirmed_at: 'yes' }, { id: 'fixture-admin', email: 'admin@example.invalid', email_confirmed_at: null }]) {
      identity = who; queries = [];
      const result = await route('365');
      assert.equal(result.status, 400); assert.match(result.body.error, /sign in|Administrator/);
      assert.equal(result.headers['Cache-Control'], 'no-store'); assert.equal(queries.length, 0, 'Unauthorized endpoint access cannot read aggregates');
    }
    identity = { id: 'fixture-admin', email: 'ADMIN@example.invalid', email_confirmed_at: 'yes' };
    queries = [];
    const success = await route();
    assert.equal(success.status, 200); assert.equal(queries.length, 1); assert.equal(success.headers['Cache-Control'], 'no-store');
    assert.equal(success.body.classification, 'unclassified'); assert(!JSON.stringify(success.body).includes(sensitive));
    queries = []; assert.equal((await route('365')).status, 400); assert.equal(queries.length, 0);
    dbFails = true;
    const unavailable = await route();
    assert.equal(unavailable.status, 400); assert.deepEqual(unavailable.body, { error: 'Promo analytics could not load. Please retry.' });
    assert.equal(unavailable.headers['Cache-Control'], 'no-store');
  } finally { Module._load = originalLoad; global.fetch = originalFetch; }
  console.log('PASS: exact ANNA20 registration, promo aggregates, active/historical codes, protected unknown labels, paid proof, saved discounts, missing-money flags, environment separation, UTC partial-day/all-time bounds, real GET/admin authorization, no-store, privacy, zero records, and unavailable failures');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => sql.close());
