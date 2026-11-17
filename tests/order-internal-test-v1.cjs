// Marking a staff test order as an internal test, against isolated SQLite. No network, no provider
// calls. The point of this suite is the part that is invisible in review: the flag has to be
// stored as JSON true, because the reporting queries read it with json_extract and the server code
// compares it with === true. A 1 passes one and fails the other, which is how a test order keeps
// counting as revenue while looking correctly filed.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const root = path.resolve(__dirname, '..');

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY, status TEXT, total INTEGER, data TEXT, updated INTEGER, created INTEGER)');
const D1 = { prepare(q) { const st = db.prepare(q); let args = []; const api = { bind(...a) { args = a; return api; },
  async first() { return st.get(...args) || null; }, async all() { return { results: st.all(...args) }; },
  async run() { return { meta: { changes: st.run(...args).changes } }; } }; return api; } };

let events = [], permission = null, signedIn = true, now = 5000, auditFails = false;
class NextResponse extends Response {
  static json(v, init) { return new NextResponse(JSON.stringify(v), { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); }
}
function loadReal(file) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name; m.paths = Module._nodeModulePaths(root);
  m.require = id => { if (id.startsWith('./')) return loadReal('lib/' + id.slice(2) + '.ts');
                      if (id.startsWith('@/lib/')) return loadReal('lib/' + id.slice(6) + '.ts');
                      return require(id); };
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, name);
  return m.exports;
}
const stubs = {
  'next/server': { NextResponse },
  '@/lib/auth': { requireStaff: async p => { permission = p; if (!signedIn) throw Error('not staff'); return { email: 'logan@example.invalid', role: 'owner' }; } },
  '@/lib/runtime': { runtime: () => ({ DB: D1 }), database: () => D1, timestamp: () => ++now,
                     one: async (sql, ...v) => db.prepare(sql).get(...v) || null,
                     parse: (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } } },
  '@/lib/change-history': {
    auditRun: async (database, ctx, sql, ...v) => { assert.equal(database, D1);
      assert.equal(ctx.source, 'admin'); assert.equal(ctx.actor, 'logan@example.invalid'); assert.equal(ctx.actorType, 'staff');
      return { meta: { changes: db.prepare(sql).run(...v).changes } }; },
    recordChange: async (_d, e) => { if (auditFails) throw Error('history unavailable'); events.push(e); },
  },
};
const filename = path.join(root, 'app/api/admin/order-test/route.ts'), m = new Module(filename, module);
m.filename = filename; m.paths = Module._nodeModulePaths(root);
m.require = id => stubs[id] || (id.startsWith('@/lib/') ? loadReal('lib/' + id.slice(6) + '.ts') : (() => { throw Error('Unexpected import ' + id); })());
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);

const ID = 'fdfc5dd9-1111-4111-8111-111111111111';
const seed = (data = {}) => { db.prepare('DELETE FROM orders').run();
  db.prepare('INSERT INTO orders(id,status,total,data,updated,created) VALUES(?,?,?,?,?,?)')
    .run(ID, 'paid', 1668, JSON.stringify({ email: 'ash@biomodcompounds.com', shipment: { tracking: 'T1', shipmentId: 'shp_x', status: 'pre_transit' }, ...data }), 1, 1); };
const row = () => db.prepare('SELECT * FROM orders WHERE id=?').get(ID);
const stored = () => JSON.parse(row().data);
const request = (body, origin = 'https://trybiomod.com') => {
  const r = new Request('https://trybiomod.com/api/admin/order-test', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  r.nextUrl = new URL(r.url); return r; };
const post = async (body, origin) => { events = []; const res = await m.exports.POST(request(body, origin)); return { status: res.status, body: await res.json() }; };

(async () => {
  // --- Only an owner, only from this site ---
  seed();
  assert.equal((await post({ orderId: ID, internalTest: true }, 'https://evil.invalid')).status, 403, 'a cross-site post is refused');
  assert.equal(stored().internalTest, undefined, 'and writes nothing');
  signedIn = false;
  const denied = await post({ orderId: ID, internalTest: true });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /Owner sign-in required/);
  assert.doesNotMatch(JSON.stringify(denied.body), /team:manage/, 'the refusal never names the permission it wanted');
  signedIn = true;
  assert.equal(permission, 'team:manage', 'marking an order a test is owner-level: it changes what the store reports as revenue');

  // --- The flag is JSON true, not 1 ---
  seed();
  const marked = await post({ orderId: ID, internalTest: true });
  assert.equal(marked.status, 200);
  assert.match(marked.body.message, /#FDFC5DD9 marked an internal test/);
  assert.equal(stored().internalTest, true, 'parsed back from the row it is a boolean, which is what the server code compares with === true');
  assert.strictEqual(typeof stored().internalTest, 'boolean');
  // Read the way the reporting queries read it: json_extract must give 1, or the sales and promo
  // figures keep counting this order as a sale.
  assert.equal(db.prepare("SELECT json_extract(data,'$.internalTest') AS v FROM orders WHERE id=?").get(ID).v, 1,
    'json_extract sees it as 1, so COALESCE(...)!=1 excludes it from every revenue figure');
  assert.notEqual(db.prepare("SELECT json_extract(data,'$.internalTest') AS v FROM orders WHERE id=?").get(ID).v, null,
    'and IS NULL no longer matches, so the payment-verify and auto-label sweeps skip it');
  assert.equal(stored().internalTestBy, 'logan@example.invalid', 'who marked it is kept');
  assert.equal(typeof stored().internalTestAt, 'number');

  // --- Nothing else about the order moves ---
  assert.equal(row().status, 'paid', 'the order status is untouched');
  assert.equal(row().total, 1668, 'and so is the money');
  assert.deepEqual(stored().shipment, { tracking: 'T1', shipmentId: 'shp_x', status: 'pre_transit' },
    'the label it really bought is kept: a test order can still have cost money, and hiding that is worse');
  assert.equal(stored().email, 'ash@biomodcompounds.com');

  // --- Audited, before and after ---
  assert.deepEqual(events.map(e => e.status), ['attempted', 'succeeded']);
  assert.equal(events[0].entityType, 'order');
  assert.equal(events[0].entityId, ID);
  assert.deepEqual(events[1].changes, [{ field: 'internalTest', before: false, after: true }]);

  // --- Saying it twice changes nothing and is not an error ---
  const again = await post({ orderId: ID, internalTest: true });
  assert.equal(again.status, 200);
  assert.match(again.body.message, /already marked an internal test/);
  assert.deepEqual(events, [], 'a no-op writes no history');

  // --- Reversible ---
  const undone = await post({ orderId: ID, internalTest: false });
  assert.equal(undone.status, 200);
  assert.match(undone.body.message, /is a customer order again/);
  assert.equal(stored().internalTest, undefined, 'the flag is removed outright, not left as false');
  assert.equal(stored().internalTestBy, undefined, 'and so is who set it');
  assert.equal(stored().internalTestAt, undefined);
  assert.equal(db.prepare("SELECT json_extract(data,'$.internalTest') AS v FROM orders WHERE id=?").get(ID).v, null,
    'so the sweeps that test IS NULL pick it up again');
  assert.equal(row().status, 'paid', 'and undoing still touches nothing else');

  // --- Bad input is refused before anything is written ---
  seed();
  for (const [body, why] of [
    [{ internalTest: true }, 'no order'],
    [{ orderId: 'not-a-uuid', internalTest: true }, 'a malformed id'],
    [{ orderId: ID }, 'no answer either way'],
    [{ orderId: ID, internalTest: 'true' }, 'a string instead of a boolean'],
  ]) {
    const res = await post(body);
    assert.equal(res.status, 400, why + ' is refused');
    assert.equal(stored().internalTest, undefined, why + ' writes nothing');
  }
  assert.equal((await post({ orderId: '11111111-2222-4333-8444-555555555555', internalTest: true })).status, 404, 'an unknown order is a 404');

  // --- A record that moved underneath is reported, never announced as success ---
  seed();
  const route = fs.readFileSync(filename, 'utf8');
  assert.match(route, /AND coalesce\(json_extract\(data,'\$\.internalTest'\),0\)=0/,
    'the write is guarded on the value that was read');
  // json_extract returns 1 for a JSON true, never the text 'true'. Comparing the guard against
  // json('true') matches nothing, so the undo silently reported a conflict instead of undoing.
  assert.match(route, /AND json_extract\(data,'\$\.internalTest'\)=1/, 'and the undo compares against 1, which is what json_extract returns');
  assert(!/json_extract\(data,'\$\.internalTest'\)=json\(/.test(route), 'never against json(...), which is text and matches nothing');
  assert.match(route, /json_set\(data,'\$\.internalTest',json\('true'\)/, 'stored as JSON true, never 1');
  assert(!/\$\.internalTest',\s*1\b/.test(route), 'a 1 would be counted by some figures and filtered by others');

  // --- History that cannot be written never blocks the change, and says so ---
  seed(); auditFails = true;
  const noHistory = await post({ orderId: ID, internalTest: true });
  auditFails = false;
  assert.equal(noHistory.status, 200);
  assert.equal(stored().internalTest, true, 'the order is still marked');
  assert.match(noHistory.body.message, /Change history could not record/, 'and the reply says history is missing rather than staying quiet');

  console.log("PASS: marking a staff test order is owner-only and same-origin, stores the flag as JSON true so json_extract sees 1 and === true sees a boolean (the mismatch that would keep a test order in the revenue figures), keeps the order's status, money, label and email untouched, is guarded against a concurrent change, is audited before and after, is a no-op when repeated, reverses cleanly by removing the flag outright, refuses malformed input before writing, and still succeeds with a warning when change history is unavailable. No network.");
})();
