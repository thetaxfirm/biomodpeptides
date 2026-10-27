// Actual admin shipping route, in-memory D1 and mocked providers. No live labels or emails.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,data TEXT,updated INTEGER)');
const id = '00000001-0000-4000-8000-000000000001';
const env = { DB: {}, EASYPOST_API_KEY: 'fixture-only-do-not-log' };
const label = { shipmentId: 'shp_fixture', carrier: 'USPS', service: 'GroundAdvantage', costCents: 500, tracking: 'PRIVATE_TRACKING', trackingUrl: 'https://example.invalid/private-tracking', labelUrl: 'https://example.invalid/private-label', status: 'pre_transit' };
let events, writes, calls, timeline, failAudit, failSave, mailAccepted, carrierFail, purchaseFail, allowed, attempts, raceCarrier, now = 1000;
function reset(extra = {}) {
  events = []; writes = []; calls = []; timeline = []; attempts = []; failAudit = () => false; failSave = false; mailAccepted = true; carrierFail = false; purchaseFail = false; allowed = true; raceCarrier = false;
  db.prepare('INSERT OR REPLACE INTO orders VALUES(?,?,?,?)').run(id, 'paid', JSON.stringify({ email: 'private-customer@example.invalid', address: { name: 'Private Customer', line1: 'PRIVATE_ADDRESS' }, paymentReference: 'PRIVATE_PAYMENT', items: [], ...extra }), 0);
}
const row = () => { const r = db.prepare('SELECT * FROM orders WHERE id=?').get(id); return { ...r, data: JSON.parse(r.data) }; };
class NextResponse extends Response { static json(value, init) { return new NextResponse(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); } }
const runtime = { runtime: () => env, timestamp: () => ++now, parse: (s, fallback) => s ? JSON.parse(s) : fallback, one: async (sql, ...values) => db.prepare(sql).get(...values) };
const history = {
  auditRun: async (database, context, sql, ...values) => {
    assert.equal(database, env.DB); assert.deepEqual(context, { source: 'admin', actor: 'staff@example.invalid', actorType: 'staff' });
    if (failSave && sql.includes("'$.labelCreatedAt'")) throw Error('Synthetic atomic audit failure');
    // Lets a test land a carrier update in the gap between the route's read and its write, which is
    // the only way to exercise a compare-and-set guard from outside the route.
    if (raceCarrier && sql.includes("'$.dismissed'")) { raceCarrier = false; db.prepare("UPDATE orders SET data=json_set(data,'$.shipment.status','in_transit') WHERE id=?").run(id); }
    timeline.push('write'); writes.push({ context, sql }); return { meta: db.prepare(sql).run(...values) };
  },
  recordChange: async (database, event) => {
    assert.equal(database, env.DB);
    if (failAudit(event)) throw Error('Synthetic audit unavailable');
    timeline.push(event.action + ':' + event.status); events.push(event);
  },
};
const shipping = {
  easypostReady: () => true, shippingConnection: async () => ({ connected: true }),
  buyLabel: async (_env, _to, _items, _ref, _selected, _settings, attempt = {}) => {
    calls.push('buy'); timeline.push('provider:buy'); attempts.push(attempt);
    if (attempt.onShipment) await attempt.onShipment('shp_fixture');
    if (purchaseFail) throw Error('Provider response unavailable');
    return label;
  },
  sendTrackingEmail: async (_env, _to, _orderId, _label, _name, replyTo) => { assert.equal(replyTo, 'reply@example.invalid'); calls.push('mail'); timeline.push('provider:mail'); return mailAccepted; },
  readShipmentTracking: async () => { calls.push('read'); timeline.push('provider:read'); if (carrierFail) throw Error('PRIVATE_PROVIDER_DETAIL'); return 'in_transit'; },
};
/** Compiles a real library module with no stubs. Used where faking the rule would test nothing. */
function loadReal(file) {
  const name = path.join(root, file), mod = new Module(name, module);
  mod.filename = name; mod.paths = Module._nodeModulePaths(root);
  mod._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, name);
  return mod.exports;
}
const filename = path.join(root, 'app/api/admin/shipping/route.ts'), m = new Module(filename, module);
m.filename = filename; m.require = name => {
  if (name === 'next/server') return { NextResponse };
  if (name === '@/lib/auth') return { requireStaff: async permission => { assert.equal(permission, 'orders:fulfill'); if (!allowed) throw Error('Unauthorized'); return { email: 'staff@example.invalid', role: 'fulfillment' }; } };
  if (name === '@/lib/runtime') return runtime;
  if (name === '@/lib/coa-outbox') return { readCoaConfig: async () => ({ enabled: true, replyTo: 'reply@example.invalid', notifyTo: null }) };
  if (name === '@/lib/change-history') return history;
  if (name === '@/lib/easypost') return shipping;
  // The connection check reports the backup sweep's health; this route test never runs the sweep.
  if (name === '@/lib/tracking-sweep') return { readTrackingSweepHealth: async () => null };
  if (name === '@/lib/commerce') return {config: async()=>({shippingOptions:{}}), catalog: async()=>[]};
  // The COA shipping rule has its own suite (coa-shipping-v1); here every order is cleared to ship.
  if (name === '@/lib/coa-shipping') return {coaBlockedItems: () => [], coaBlockMessage: names => 'blocked ' + names.join(',')};
  if (name === '@/lib/shipping-options') return {savedShippingOption:()=>null,goodsValueCents:()=>null};
  // The real rules, not a stub: whether a flag may be dismissed is the whole point of that branch.
  if (name === '@/lib/fulfillment') return loadReal('lib/fulfillment.ts');
  throw Error('Unexpected import ' + name);
};
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
const request = (body = {}, origin = 'https://trybiomod.com') => { const req = new Request('https://trybiomod.com/api/admin/shipping', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) }); req.nextUrl = new URL(req.url); return req; };
const post = async (body = {}, origin) => { const response = await m.exports.POST(request(body, origin)); return { status: response.status, body: await response.json() }; };
const checkSafe = () => {
  const raw = JSON.stringify(events);
  for (const token of ['PRIVATE_', 'private-customer', 'Private Customer', 'fixture-only-do-not-log', 'example.invalid/private-']) assert(!raw.includes(token), 'Audit payload leaked ' + token);
  for (const event of events) { assert.equal(event.actor, 'staff@example.invalid'); assert.equal(event.source, 'admin'); assert.equal(event.actorType, 'staff'); assert.equal(event.entityId, id); assert.deepEqual(event.changes, []); }
};
(async () => {
  reset(); assert.equal((await post({}, 'https://bad.invalid')).status, 403); assert.equal(events.length, 0); assert.equal(calls.length, 0);
  // An authentication failure is a generic 403: it must not reveal whether the caller is staff,
  // nor which permission they are missing, and must do no work.
  allowed = false; const denied = await post();
  assert.equal(denied.status, 403); assert.equal(denied.body.error, 'Administrator sign-in required.');
  assert(!JSON.stringify(denied).includes('Unauthorized'), 'the internal reason is never relayed');
  assert.equal(events.length, 0); assert.equal(calls.length, 0);

  reset(); let r = await post(); assert.equal(r.status, 200); assert.equal(row().status, 'paid'); assert.equal(row().data.shipment.tracking, label.tracking);
  assert.deepEqual(events.map(e => e.action + ':' + e.status), ['shipping.label_purchase:attempted', 'shipping.label_purchase:succeeded', 'shipping.tracking_email:attempted', 'shipping.tracking_email:succeeded']);
  assert(timeline.indexOf('shipping.label_purchase:attempted') < timeline.indexOf('provider:buy'));
  assert(timeline.indexOf('shipping.tracking_email:attempted') < timeline.indexOf('provider:mail'));
  assert.match(events[1].summary, /handoff.*required/); assert.match(events[3].summary, /Inbox delivery is unconfirmed/); checkSafe();
  assert.equal((await post()).status, 409); assert.equal(calls.filter(c => c === 'buy').length, 1);

  reset(); failAudit = e => e.status === 'attempted'; r = await post(); assert.equal(r.status, 400); assert.deepEqual(calls, []); assert.equal(row().status, 'paid', 'No label claim or purchase if durable intent failed');
  reset({ shipment: label }); failAudit = e => e.status === 'attempted'; r = await post({ resend: true }); assert.equal(r.status, 400); assert.deepEqual(calls, []);

  reset(); failAudit = e => e.action === 'shipping.label_purchase' && e.status === 'succeeded'; r = await post(); assert.equal(r.status, 200); assert.match(r.body.message, /Do not repeat this action/); assert.equal(row().data.shipment.tracking, label.tracking); assert.equal((await post()).status, 409); assert.equal(calls.filter(c => c === 'buy').length, 1); checkSafe();
  reset(); failAudit = e => e.action === 'shipping.tracking_email' && e.status === 'attempted'; r = await post(); assert.equal(r.status, 200); assert.match(r.body.message, /email was not attempted/); assert.deepEqual(calls, ['buy']); assert.equal(row().status, 'paid');
  reset(); failSave = true; r = await post(); assert.equal(r.status, 502); assert.match(r.body.error, /Do not buy another/); assert.equal(row().status, 'labeling'); assert.deepEqual(calls, ['buy']); assert.equal((await post()).status, 409); assert.equal(calls.filter(c => c === 'buy').length, 1); checkSafe();

  reset({ shipment: label }); mailAccepted = false; r = await post({ resend: true }); assert.equal(r.status, 200); assert.equal(events.at(-1).status, 'observed'); assert.match(events.at(-1).summary, /acceptance was not confirmed/); assert.deepEqual(calls, ['mail']); checkSafe();
  reset({ shipment: label }); failAudit = e => e.status === 'succeeded'; r = await post({ resend: true }); assert.equal(r.status, 200); assert.match(r.body.message, /accepted by the mail provider/); assert.match(r.body.message, /Do not repeat/); assert.deepEqual(calls, ['mail']);

  reset({ shipment: label }); r = await post({ refreshTracking: true }); assert.equal(r.status, 200); assert.equal(row().status, 'shipped'); assert.equal(row().data.shipment.status, 'in_transit'); assert.deepEqual(calls, ['read']); assert.deepEqual(events.map(e => e.status), ['attempted', 'succeeded']); checkSafe();
  reset({ shipment: label }); carrierFail = true; r = await post({ refreshTracking: true }); assert.equal(r.status, 400); assert.equal(row().status, 'paid'); assert.equal(events.at(-1).status, 'failed'); assert(!JSON.stringify(r).includes('PRIVATE_PROVIDER_DETAIL')); checkSafe();
  reset(); purchaseFail = true; r = await post(); assert.equal(r.status, 502); assert.equal(row().status, 'paid', 'Existing provider-error workflow is preserved'); assert.equal(events.at(-1).status, 'observed'); assert.match(events.at(-1).summary, /Review the carrier account/); checkSafe();
  // A purchase whose outcome was never learned must be resumable, never repeated.
  assert.equal(row().data.pendingShipmentId, 'shp_fixture', 'The shipment is recorded before the buy, and survives the release');
  assert.match(events.at(-1).summary, /resumes the same carrier shipment/);
  purchaseFail = false; r = await post(); assert.equal(r.status, 200);
  assert.equal(attempts.at(-1).resumeShipmentId, 'shp_fixture', 'The retry resumes the recorded shipment instead of creating another');
  assert.equal(row().data.pendingShipmentId, undefined, 'and the resolved attempt is cleared once a label is saved');
  // The label write must not rewrite the whole order: a hold saved mid-purchase survives.
  reset(); db.prepare("UPDATE orders SET data=json_set(data,'$.hold',json(?)) WHERE id=?").run(JSON.stringify({ issue: 'out_of_stock' }), id);
  r = await post(); assert.equal(r.status, 409, 'A held order is refused outright');
  reset(); attempts = []; shipping.buyLabel = async (_e, _t, _i, _r, _s, _o, attempt = {}) => {
    calls.push('buy'); timeline.push('provider:buy'); attempts.push(attempt);
    if (attempt.onShipment) await attempt.onShipment('shp_fixture');
    db.prepare("UPDATE orders SET data=json_set(data,'$.hold',json(?)) WHERE id=?").run(JSON.stringify({ issue: 'out_of_stock' }), id);
    return label;
  };
  r = await post(); assert.equal(r.status, 200);
  assert.deepEqual(row().data.hold, { issue: 'out_of_stock' }, 'A hold placed while the carrier call was in flight is not erased');
  assert.equal(row().data.shipment.tracking, label.tracking, 'and the bought label is still recorded');
  // Dismissing a carrier flag: audited like every other write, refused when it is not a carrier
  // flag, and never saved once the carrier has moved on (owner, Oct 20 2026).
  // Owner, Oct 27 2026: only a parcel already marked dropped off reaches Needs review on a carrier
  // flag, so only that one is dismissible. One still waiting to be dropped off has its own button.
  const old = { ...label, status: 'pre_transit' };
  reset({ shipment: old, labelCreatedAt: -1, handoff: { at: -1 } });
  r = await post({ dismiss: true });
  assert.equal(r.status, 200); assert.match(r.body.message, /moves to Shipped/);
  assert.equal(row().data.dismissed.by, 'staff@example.invalid');
  assert.equal(row().data.dismissed.carrierStatus, 'pre_transit');
  assert.deepEqual(events.map(e => e.action + ':' + e.status), ['shipping.dismiss_flag:attempted', 'shipping.dismiss_flag:succeeded']);
  assert.deepEqual(calls, [], 'dismissing calls no provider'); checkSafe();
  // And back again.
  r = await post({ undoDismiss: true });
  assert.equal(r.status, 200); assert.equal(row().data.dismissed, undefined); assert.equal(events.at(-1).status, 'succeeded');
  // Nor is a parcel nobody has dropped off yet: Dropped off is its button, and dismissing would
  // record it as shipped without ever recording the handoff.
  reset({ shipment: old, labelCreatedAt: -1 });
  r = await post({ dismiss: true });
  assert.equal(r.status, 409); assert.match(r.body.error, /not yet marked dropped off/);
  assert.equal(row().data.dismissed, undefined); assert.equal(events.length, 0); assert.deepEqual(calls, []);
  // A hold is not a carrier flag: it has its own button, so it is refused without touching anything.
  reset({ shipment: old, labelCreatedAt: -1, hold: { issue: 'out_of_stock' } });
  r = await post({ dismiss: true });
  assert.equal(r.status, 409); assert.match(r.body.error, /has its own button|not a carrier flag/);
  assert.equal(row().data.dismissed, undefined); assert.equal(events.length, 0); assert.deepEqual(calls, []);
  // Nor is a parcel that is not flagged at all.
  reset({ shipment: old, labelCreatedAt: Date.now() });
  assert.equal((await post({ dismiss: true })).status, 409); assert.equal(row().data.dismissed, undefined);
  // A carrier that moved while the owner was pressing the button loses the race, and says so.
  reset({ shipment: old, labelCreatedAt: -1, handoff: { at: -1 } }); raceCarrier = true;
  r = await post({ dismiss: true });
  assert.equal(r.status, 409); assert.match(r.body.error, /reported something new/);
  assert.equal(row().data.dismissed, undefined);
  assert.equal(events.at(-1).status, 'observed', 'the lost race is recorded, not hidden'); checkSafe();

  console.log('PASS: actual shipping route records authenticated staff, durable provider intent, safe outcomes without customer details, truthful acceptance/dispatch states, and no provider retry after an audit failure. Provider calls are mocked.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
