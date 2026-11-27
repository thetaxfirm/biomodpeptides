// Recording a replacement parcel posted outside the store, against isolated SQLite with a stubbed
// EasyPost. No network. The rule this suite exists to hold: the ORDER'S STATUS FOLLOWS THE CARRIER,
// never the person filling the form. A reship is exactly the moment someone is tempted to declare a
// parcel delivered because a customer said so, and a store claim over a parcel the carrier has
// never seen is how a lost box stops being anybody's problem.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const root = path.resolve(__dirname, '..');

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY, status TEXT, total INTEGER, data TEXT, updated INTEGER, created INTEGER)');
const D1 = { prepare(q) { const st = db.prepare(q); let args = []; const api = { bind(...a) { args = a; return api; },
  async first() { return st.get(...args) || null; }, async all() { return { results: st.all(...args) }; },
  async run() { return { meta: { changes: st.run(...args).changes } }; } }; return api; } };

let events = [], permission = null, signedIn = true, now = 9000, connected = true;
let tracker = null, trackerError = null, asked = [];
class NextResponse extends Response {
  static json(v, init) { return new NextResponse(JSON.stringify(v), { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); }
}
const stubs = {
  'next/server': { NextResponse },
  '@/lib/auth': { requireStaff: async p => { permission = p; if (!signedIn) throw Error('not staff'); return { email: 'logan@example.invalid', role: 'owner' }; } },
  '@/lib/easypost': { easypostReady: () => connected },
  '@/lib/easypost-tracker': {
    readTrackingCode: async (_env, code, carrier) => { asked.push({ code, carrier });
      if (trackerError) throw Object.assign(new Error(trackerError), { name: 'ShippingError' });
      return tracker; },
  },
  '@/lib/runtime': { runtime: () => ({ DB: D1 }), database: () => D1, timestamp: () => ++now,
                     one: async (sql, ...v) => db.prepare(sql).get(...v) || null,
                     parse: (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } } },
  '@/lib/change-history': {
    auditRun: async (database, ctx, sql, ...v) => { assert.equal(database, D1); assert.equal(ctx.actor, 'logan@example.invalid');
      return { meta: { changes: db.prepare(sql).run(...v).changes } }; },
    recordChange: async (_d, e) => { events.push(e); },
  },
};
const filename = path.join(root, 'app/api/admin/order-reship/route.ts'), m = new Module(filename, module);
m.filename = filename; m.paths = Module._nodeModulePaths(root);
function loadReal(file) { const name=path.join(root,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(root);m.require=id=>id.startsWith('./')?loadReal(path.join(path.dirname(file),id+'.ts')):require(id);m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,name);return m.exports; }
stubs['@/lib/fulfillment-eligibility']=loadReal('lib/fulfillment-eligibility.ts');
m.require = id => stubs[id] || (() => { throw Error('Unexpected import ' + id); })();
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);

const ID = '4a62dc79-1111-4111-8111-111111111111';
const OLD = { tracking: '9410836208192274528340', shipmentId: 'shp_old', status: 'failure', service: 'USPS Priority', labelUrl: 'https://labels.invalid/a.png' };
const seed = (status = 'shipped', shipment = OLD) => { db.prepare('DELETE FROM orders').run();
  db.prepare('INSERT INTO orders(id,status,total,data,updated,created) VALUES(?,?,?,?,?,?)')
    .run(ID, status, 34572, JSON.stringify({ email: 'trista@example.invalid', ...(shipment ? { shipment } : {}) }), 1, 1); };
const row = () => db.prepare('SELECT * FROM orders WHERE id=?').get(ID);
const stored = () => JSON.parse(row().data);
const NEW = '9405536208192279793801';
const ok = (status, extra = {}) => ({ tracking: NEW, status, carrier: 'USPS', trackingUrl: 'https://track.invalid/x', shipmentId: null, deliveredAt: null, ...extra });
const request = (body, origin = 'https://trybiomod.com') => {
  const r = new Request('https://trybiomod.com/api/admin/order-reship', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  r.nextUrl = new URL(r.url); return r; };
const post = async (body, origin) => { events = []; asked = []; const res = await m.exports.POST(request(body, origin)); return { status: res.status, body: await res.json() }; };

(async () => {
  // --- The carrier decides the status, not the request ---
  // Every one of these asks for the same thing; only EasyPost's answer differs.
  for (const [carrierStatus, from, expected] of [
    ['delivered', 'shipped', 'delivered'],
    ['delivered', 'paid', 'delivered'],
    ['in_transit', 'paid', 'shipped'],
    ['out_for_delivery', 'paid', 'shipped'],
    ['available_for_pickup', 'paid', 'shipped'],
    ['pre_transit', 'paid', 'paid'],
    ['unknown', 'paid', 'paid'],
    ['failure', 'shipped', 'shipped'],
    ['return_to_sender', 'shipped', 'shipped'],
    ['in_transit', 'shipped', 'shipped'],
  ]) {
    seed(from); tracker = ok(carrierStatus);
    const res = await post({ orderId: ID, tracking: NEW });
    assert.equal(res.status, 200, carrierStatus + ' from ' + from);
    assert.equal(row().status, expected, carrierStatus + ' on a ' + from + ' order leaves it ' + expected);
    assert.equal(stored().shipment.status, carrierStatus, 'and the shipment records exactly what the carrier said');
  }
  // The one that matters: a parcel the carrier has not scanned cannot be talked into Delivered.
  seed('paid'); tracker = ok('pre_transit');
  await post({ orderId: ID, tracking: NEW, note: 'customer says it arrived' });
  assert.equal(row().status, 'paid', 'a note claiming delivery does not deliver anything');
  assert.notEqual(row().status, 'delivered');

  // --- What is written ---
  seed('shipped'); tracker = ok('delivered');
  const done = await post({ orderId: ID, tracking: NEW, carrier: 'USPS', note: 'reposted Nov 4' });
  assert.equal(done.status, 200);
  assert.deepEqual(asked, [{ code: NEW, carrier: 'USPS' }], 'the number is checked with the carrier before anything is saved');
  assert.match(done.body.message, /Replacement recorded on #4A62DC79/);
  assert.match(done.body.message, /carrier reports delivered/);
  assert.match(done.body.message, /No email was sent/);
  const s = stored();
  assert.equal(s.shipment.tracking, NEW);
  assert.equal(s.shipment.status, 'delivered');
  assert.equal(s.shipment.reshipBy, 'logan@example.invalid');
  assert.equal(s.shipment.reshipNote, 'reposted Nov 4');
  assert.equal(s.tracking, NEW, 'the plain tracking field follows too, so the order page shows the live number');
  // The first parcel is history, not rubbish: it may still need reprinting or a claim.
  assert.equal(s.previousShipment.tracking, OLD.tracking, 'the original shipment is kept');
  assert.equal(s.previousShipment.status, 'failure');
  assert.equal(s.previousShipment.labelUrl, OLD.labelUrl, 'including the label that was bought for it');
  assert.equal(s.email, 'trista@example.invalid', 'and nothing else about the order is touched');
  assert.equal(row().total, 34572);

  // --- A carrier that will not confirm the number saves nothing ---
  seed('shipped'); trackerError = 'That is not a usable tracking number.';
  const refused = await post({ orderId: ID, tracking: 'NOTATRACKINGNUMBER' });
  trackerError = null;
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /No order changes were saved/);
  assert.deepEqual(stored().shipment, OLD, 'the order still carries the original parcel');
  assert.equal(stored().previousShipment, undefined, 'and nothing was moved aside');
  assert.deepEqual(events.map(e => e.status), ['attempted', 'failed'], 'the refusal is recorded, not swallowed');

  // --- Guards ---
  seed('shipped'); tracker = ok('delivered');
  assert.equal((await post({ orderId: ID, tracking: NEW }, 'https://evil.invalid')).status, 403, 'cross-site is refused');
  assert.deepEqual(stored().shipment, OLD);
  signedIn = false;
  const denied = await post({ orderId: ID, tracking: NEW });
  assert.equal(denied.status, 403);
  assert.doesNotMatch(JSON.stringify(denied.body), /orders:fulfill/, 'the refusal never names the permission it wanted');
  signedIn = true;
  assert.equal(permission, 'orders:fulfill');
  connected = false;
  const offline = await post({ orderId: ID, tracking: NEW });
  connected = true;
  assert.equal(offline.status, 400);
  assert.match(offline.body.error, /cannot be verified/, 'with no carrier connection there is nothing to verify against');
  assert.deepEqual(stored().shipment, OLD);

  // --- An order with no parcel to replace ---
  for (const status of ['review', 'awaiting_payment', 'cancelled', 'refunded']) {
    seed(status); tracker = ok('delivered');
    const res = await post({ orderId: ID, tracking: NEW });
    assert.equal(res.status, 409, status + ' has no parcel to replace');
    assert.match(res.body.error, /not a paid order/);
    assert.deepEqual(stored().shipment, OLD, status + ' is left alone');
  }

  // --- Bad input is refused before the carrier is called ---
  seed('shipped');
  for (const [body, why] of [[{ tracking: NEW }, 'no order'], [{ orderId: 'nope', tracking: NEW }, 'a malformed id'],
                             [{ orderId: ID }, 'no tracking number'], [{ orderId: ID, tracking: '   ' }, 'a blank one']]) {
    const res = await post(body);
    assert.equal(res.status, 400, why + ' is refused');
    assert.deepEqual(asked, [], why + ' never reaches the carrier');
  }
  assert.equal((await post({ orderId: '11111111-2222-4333-8444-555555555555', tracking: NEW })).status, 404);

  // The shared eligibility guard applies before a carrier call on the replacement path too.
  for (const blocked of [{paymentVerified:{at:1,state:'failed'}},{hold:{issue:'shipping'}},{items:[{product:{activePreorder:{percentOff:10,basePrice:1000,ships:'November 2026'}}}]}]) {
    seed('paid'); db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify({...stored(),...blocked}),ID);
    const prior=row().data; const response=await post({orderId:ID,tracking:NEW});
    assert.equal(response.status,409);assert.deepEqual(asked,[]);assert.equal(row().data,prior);
  }

  // --- Repeating it is a no-op, and does not re-ask the carrier ---
  seed('shipped'); tracker = ok('delivered');
  await post({ orderId: ID, tracking: NEW });
  const repeat = await post({ orderId: ID, tracking: NEW });
  assert.equal(repeat.status, 200);
  assert.match(repeat.body.message, /already carries that tracking number/);
  assert.deepEqual(asked, [], 'a no-op does not spend a carrier call');
  assert.equal(stored().previousShipment.tracking, OLD.tracking, 'and the original is not overwritten by the second attempt');

  // --- A record that moved underneath is reported, never announced as success ---
  const route = fs.readFileSync(filename, 'utf8');
  assert.match(route, /AND status=\? AND COALESCE\(json_extract\(data,'\$\.shipment\.tracking'\),''\)=\?/,
    'the write is guarded on both the status and the tracking number that were read');
  assert(!/sendTrackingEmail|trackingEmail/.test(route), 'a reship tells nobody: whoever posted it already did');
  assert(!/buyLabel/.test(route), 'and buys nothing');

  // --- Audited with what actually changed ---
  seed('shipped'); tracker = ok('delivered');
  await post({ orderId: ID, tracking: NEW });
  assert.deepEqual(events.map(e => e.status), ['attempted', 'succeeded']);
  const changes = Object.fromEntries(events[1].changes.map(c => [c.field, c]));
  assert.deepEqual(changes['shipment.tracking'], { field: 'shipment.tracking', before: OLD.tracking, after: NEW });
  assert.deepEqual(changes['shipment.status'], { field: 'shipment.status', before: 'failure', after: 'delivered' });
  assert.deepEqual(changes['status'], { field: 'status', before: 'shipped', after: 'delivered' });

  console.log('PASS: a replacement parcel is verified with the carrier before anything is written, the order status follows what the carrier says and can never be talked into Delivered, the original shipment and its label are kept, an unverifiable number saves nothing and is recorded as a refusal, unpaid and closed orders have no parcel to replace, bad input never reaches the carrier, repeating is a free no-op, the write is guarded against a concurrent change, nothing is emailed and no label is bought. No network.');
})();
