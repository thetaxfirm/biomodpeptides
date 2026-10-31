/* Actual store POST route with Zod and an in-memory settings/cart store.
 * Synthetic fixtures only. No live accounts, quotes, providers or orders. */
const assert = require('node:assert/strict');
class AddressCheckError extends Error { constructor(status) { super('USPS flagged ' + status); this.name = 'AddressCheckError'; this.addressProblem = status; } }
let quoteFailure = null;
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'app/api/store/[action]/route.ts');
const localRequire = Module.createRequire(filename);
const sql = new DatabaseSync(':memory:');
sql.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE customer_carts(id TEXT PRIMARY KEY,cart TEXT NOT NULL)');
const user = { id: 'synthetic-customer', email: 'fixture@example.invalid' };
const quoteId = '10000000-0000-4000-8000-000000000001';
const lines = [{ id: 910001, quantity: 1 }];
const address = { name: 'Synthetic Fixture', line1: 'Isolated Address', city: 'Fixture City', state: 'NV', zip: '00000', country: 'US', phone: '0000000000' };
const settingsSql = 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value';
const shipping = { standardEnabled: false, expeditedEnabled: true, overnightEnabled: true, freeStandardEnabled: false, standardHandlingCents: 225, expeditedHandlingCents: 450, overnightHandlingCents: 1750, carriers: ['FedEx'] };
const existing = { packDiscounts: { 1: 0, 3: 10, 5: 15, 10: 20 }, shippingCents: 799, freeShippingAt: 25000, presalesEnabled: true, rewardsEnabled: false, affiliateEnabled: true, shippingOptions: shipping, retainedSetting: { version: 2, label: 'Synthetic newer runtime setting' } };
const payload = () => ({ packDiscounts: { 3: 12 }, shippingCents: null, freeShippingAt: 20000, presalesEnabled: false, rewardsEnabled: true, affiliateEnabled: true });
let role, signedIn, customerAuthorized, staffAuthorized, calls, forbiddenCalls = 0, staffGate;
const record = (name, value) => calls.push({ name, value });
const called = name => calls.filter(c => c.name === name);
const forbidden = name => () => { forbiddenCalls++; throw Error('Forbidden dependency ' + name); };
const db = {};
const readSettings = () => JSON.parse(sql.prepare("SELECT value FROM settings WHERE key='store'").get().value);
class FixtureResponse extends Response {
 static json(value, options = {}) { return new FixtureResponse(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }); }
}
const dependencies = {
 'next/server': { NextResponse: FixtureResponse, after: forbidden('background callback') },
 'next/headers': { cookies: async () => ({ get: name => name === 'fixture-promo' ? { value: 'BIOMOD15' } : undefined, delete: forbidden('cookie delete'), set: forbidden('cookie mutation') }) },
 '@/lib/auth': {
  session: async () => { record('session'); return { id: 'synthetic-session' }; },
  rateLimit: async () => record('rateLimit'),
  requireCustomer: async () => { record('customer-auth'); if (!signedIn) throw Error('Please sign in.'); customerAuthorized = true; return user; },
  requireStaff: async permission => {
   record('staff-auth', permission); assert.equal(permission, 'store:write');
   if (staffGate) await staffGate;
   if (!signedIn || !['owner', 'manager'].includes(role)) throw Error('Store administration access required.');
   staffAuthorized = true; return { ...user, role };
  },
 },
 '@/lib/runtime': {
  database: () => { assert(customerAuthorized || staffAuthorized, 'Authorization precedes DB access'); record('database'); return db; },
  one: async (query, owner) => { assert(customerAuthorized); assert.equal(query, 'SELECT cart FROM customer_carts WHERE id=?'); assert.equal(owner, user.id); record('cart-read'); return sql.prepare(query).get(owner); },
  parse: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } },
 },
 '@/lib/commerce': {
  config: async () => { assert(staffAuthorized, 'Settings read requires staff authorization'); record('config-read'); return readSettings(); },
  validateLines: value => { assert.deepEqual(value, lines, 'Only the authenticated saved cart is used'); record('validate-lines'); return value; },
 },
 '@/lib/cart-import': { createCartImports: ({ db: received }) => { assert.equal(received, db); return { assertResolved: async (owner, session) => { assert(customerAuthorized); assert.equal(owner, user.id); assert.equal(session, 'synthetic-session'); record('cart-resolved'); } }; } },
 '@/lib/promotions': { PROMO_COOKIE: 'fixture-promo', promotion: (value, extra) => { assert.equal(value, 'BIOMOD15'); assert.deepEqual(extra, [], 'owner-added codes are offered to the validator'); return { code: value }; } },
 // Reading the owner-added codes is a database read like any other and follows authorization.
 '@/lib/promo-codes': { storedPromotions: async received => { assert(customerAuthorized || staffAuthorized, 'Authorization precedes the stored promo read'); assert.equal(received, db); record('stored-promos'); return []; } },
 '@/lib/checkout': { AddressCheckError, issueQuote: async (...args) => { assert(customerAuthorized); record('issue-quote', args); if (quoteFailure) throw quoteFailure; return { quoteId, shippingOptionId: args[4]?.shippingOptionId || 'flat_standard', shipping: 1000 }; } },
 '@/lib/change-history': { auditRun: async (received, actor, query, ...values) => { assert(staffAuthorized); assert.equal(received, db); assert.equal(actor.actor, user.email); assert.equal(actor.action, 'admin-config'); assert.equal(query, settingsSql); assert.equal(values[0], 'store'); record('settings-write', JSON.parse(values[1])); return { meta: sql.prepare(query).run(...values) }; } },
};
const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
mod.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : name.startsWith('@/') ? new Proxy({}, { get: (_, key) => key === '__esModule' ? true : forbidden(name + ':' + String(key)) }) : localRequire(name);
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { POST } = mod.exports;
const priorFetch = global.fetch; global.fetch = forbidden('network');
function reset(nextRole = 'owner', authenticated = true) {
 role = nextRole; signedIn = authenticated; customerAuthorized = false; staffAuthorized = false; staffGate = null; calls = [];
 sql.exec('DELETE FROM settings; DELETE FROM customer_carts');
 sql.prepare('INSERT INTO settings VALUES(?,?)').run('store', JSON.stringify(existing));
 sql.prepare('INSERT INTO customer_carts VALUES(?,?)').run(user.id, JSON.stringify(lines));
}
async function request(action, body, extraHeaders = {}) {
 const req = new Request('https://fixture.invalid/api/store/' + action, { method: 'POST', headers: { origin: 'https://fixture.invalid', 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) }); req.nextUrl = new URL(req.url);
 const response = await POST(req, { params: Promise.resolve({ action }) });
 assert.equal(response.headers.get('cache-control'), 'no-store'); return { status: response.status, body: await response.json() };
}
(async () => {
 // Existing callers may request the initial quote without selecting a service.
 reset('customer'); let result = await request('delivery', { address }); assert.equal(result.status, 200); assert.deepEqual(called('issue-quote')[0].value, [user.id, lines, address, 'BIOMOD15', undefined, false]);
 // USPS address check: only a literal true confirms, and a flagged address comes back as 422 with its reason.
 for (const [flag, expected] of [[true, true], ['true', false], [1, false]]) { reset('customer'); result = await request('delivery', { address, addressConfirmed: flag }); assert.equal(result.status, 200); assert.equal(called('issue-quote')[0].value[5], expected, String(flag)); }
 reset('customer'); quoteFailure = new AddressCheckError('unit_missing'); result = await request('delivery', { address });
 assert.equal(result.status, 422); assert.deepEqual(result.body, { error: 'USPS flagged unit_missing', addressProblem: 'unit_missing' });
 reset('customer'); quoteFailure = new Error('Your cart is empty.'); result = await request('delivery', { address });
 assert.equal(result.status, 400); assert.deepEqual(result.body, { error: 'Your cart is empty.' }, 'Other quote errors are unchanged'); quoteFailure = null;
 // Selection is always paired and contains only safe identifiers. Prices, owners
 // and cart lines submitted by a browser never become quote authority.
 reset('customer'); result = await request('delivery', { address, quoteId, shippingOptionId: 'rate_UPS_NextDayAir_001', shipping: 0, total: 0, owner: 'other-user', lines: [{ id: 1, quantity: 99 }] });
 assert.equal(result.status, 200); assert.deepEqual(called('issue-quote')[0].value, [user.id, lines, address, 'BIOMOD15', { quoteId, shippingOptionId: 'rate_UPS_NextDayAir_001' }, false]);
 for (const choice of [
  { quoteId }, { shippingOptionId: 'flat_standard' }, { quoteId: null, shippingOptionId: 'flat_standard' }, { quoteId, shippingOptionId: null }, { quoteId: 'not-a-uuid', shippingOptionId: 'flat_standard' },
  { quoteId, shippingOptionId: '' }, { quoteId, shippingOptionId: '../rate' }, { quoteId, shippingOptionId: 'bad rate' }, { quoteId, shippingOptionId: 'x'.repeat(161) }, { quoteId, shippingOptionId: 12 }, { quoteId, shippingOptionId: { id: 'rate' } },
 ]) {
  reset('customer'); result = await request('delivery', { address, ...choice }); assert.equal(result.status, 400, JSON.stringify(choice)); assert.equal(called('issue-quote').length, 0); assert.equal(called('cart-read').length, 0, 'Invalid selection rejected before cart lookup'); assert.equal(called('cart-resolved').length, 0);
 }
 reset('customer'); result = await request('delivery', { address, quoteId, shippingOptionId: 'x'.repeat(160) }); assert.equal(result.status, 200);
 reset('customer', false); result = await request('delivery', { address, quoteId, shippingOptionId: 'flat_standard' }); assert.equal(result.status, 400); assert.equal(called('database').length, 0); assert.equal(called('issue-quote').length, 0);
 // Saving an older editor retains newer runtime keys and the entire saved
 // shipping policy rather than resetting it to source defaults.
 for (const allowed of ['owner', 'manager']) {
  reset(allowed); result = await request('admin-config', payload()); assert.equal(result.status, 200); const saved = readSettings(); assert.deepEqual(saved.shippingOptions, shipping); assert.deepEqual(saved.retainedSetting, existing.retainedSetting); assert.deepEqual(saved.packDiscounts, { 1: 0, 3: 12, 5: 15, 10: 20 }); assert.equal(saved.shippingCents, null); assert.equal(saved.freeShippingAt, 20000); assert.equal(saved.rewardsEnabled, true); assert.equal(called('settings-write').length, 1);
 }
 reset(); const choices = { standardEnabled: false, expeditedEnabled: false, overnightEnabled: false, freeStandardEnabled: false, standardHandlingCents: 0, expeditedHandlingCents: 100000, overnightHandlingCents: 1000, carriers: ['USPS', 'FedEx', 'USPS', 'UPS', 'FedEx'] };
 result = await request('admin-config', { ...payload(), shippingOptions: choices, retainedSetting: { version: 'untrusted-new-key' } }); assert.equal(result.status, 200);
 assert.deepEqual(readSettings().shippingOptions, { ...choices, carriers: ['USPS', 'FedEx', 'UPS'] }); assert.deepEqual(readSettings().retainedSetting, existing.retainedSetting); assert.equal(readSettings().shippingOptions.standardHandlingCents, 0); assert.equal(readSettings().shippingOptions.standardEnabled, false, 'All tiers may deliberately be disabled');
 const invalid = [null, {}, { ...shipping, overnightEnabled: 'true' }, { ...shipping, overnightHandlingCents: -1 }, { ...shipping, overnightHandlingCents: 1.5 }, { ...shipping, overnightHandlingCents: 100001 }, { ...shipping, overnightHandlingCents: '1000' }, { ...shipping, standardHandlingCents: null }, { ...shipping, carriers: [] }, { ...shipping, carriers: ['DHL'] }, { ...shipping, carriers: ['ups'] }, { ...shipping, carriers: 'USPS' }, { ...shipping, unexpected: true }];
 for (const value of invalid) {
  reset(); result = await request('admin-config', { ...payload(), shippingOptions: value }); assert.equal(result.status, 400, JSON.stringify(value)); assert.equal(called('settings-write').length, 0); assert.equal(called('config-read').length, 0); assert.deepEqual(readSettings(), existing);
 }
 for (const denied of ['customer', 'support', 'fulfillment', 'unknown']) {
  reset(denied); result = await request('admin-config', { ...payload(), shippingOptions: shipping }); assert.equal(result.status, 400); assert.equal(called('config-read').length, 0); assert.equal(called('settings-write').length, 0); assert.deepEqual(readSettings(), existing);
 }
 reset('owner', false); result = await request('admin-config', payload()); assert.equal(result.status, 400); assert.equal(called('config-read').length, 0);
 // Staff access must resolve before even reading the current config.
 reset(); let release; staffGate = new Promise(resolve => { release = resolve; }); const pending = request('admin-config', payload()); await new Promise(resolve => setImmediate(resolve)); assert.equal(called('config-read').length, 0); assert.equal(called('settings-write').length, 0); release(); assert.equal((await pending).status, 200);
 for (const action of ['delivery', 'admin-config']) { reset(); result = await request(action, action === 'delivery' ? { address } : payload(), { origin: 'https://other.invalid' }); assert.equal(result.status, 403); assert.equal(calls.length, 0); }
 assert.equal(forbiddenCalls, 0); sql.close(); global.fetch = priorFetch;
 console.log('PASS: actual shipping route validation, paired safe selection identifiers, authenticated saved-cart authority, optional shipping settings preserve runtime keys, allowed carrier deduplication, cents/boolean bounds, disabled tiers, access-before-read/write and no-store responses. Isolated SQLite and mocked quote service only.');
})().catch(error => { global.fetch = priorFetch; console.error(error); process.exitCode = 1; });
