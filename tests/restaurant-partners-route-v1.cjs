// The restaurant slots endpoint against isolated SQLite, plus the /r vanity link. No network.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)');
const D1 = { prepare(q) { const st = db.prepare(q); let args = []; const api = { bind(...a) { args = a; return api; },
  async first() { return st.get(...args) || null; }, async all() { return { results: st.all(...args) }; },
  async run() { return { meta: { changes: st.run(...args).changes } }; } }; return api; } };

let events = [], allowed = true, now = 1000;
class NextResponse extends Response {
  static json(v, init) { return new NextResponse(JSON.stringify(v), { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); }
}
function loadReal(file, extra = {}) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name; m.paths = Module._nodeModulePaths(root);
  m.require = id => {
    if (extra[id]) return extra[id];
    if (id.startsWith('./')) return loadReal('lib/' + id.slice(2) + '.ts', extra);
    if (id.startsWith('@/lib/')) return loadReal('lib/' + id.slice(6) + '.ts', extra);
    throw Error('Unexpected dependency ' + id);
  };
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, name);
  return m.exports;
}
const P = loadReal('lib/restaurant-partners.ts');

const stubs = {
  'next/server': { NextResponse },
  '@/lib/auth': { requireStaff: async p => { assert.equal(p, 'store:write'); if (!allowed) throw Error('nope'); return { email: 'logan@example.invalid', role: 'owner' }; } },
  '@/lib/runtime': { runtime: () => ({ DB: D1 }), database: () => D1, timestamp: () => ++now },
  '@/lib/change-history': {
    auditRun: async (database, ctx, sql, ...v) => { assert.equal(database, D1); assert.deepEqual(ctx, { source: 'admin', actor: 'logan@example.invalid', actorType: 'staff' }); return { meta: { changes: db.prepare(sql).run(...v).changes } }; },
    recordChange: async (_d, e) => { events.push(e); },
  },
};
const filename = path.join(root, 'app/api/admin/restaurant-partners/route.ts'), m = new Module(filename, module);
m.filename = filename; m.paths = Module._nodeModulePaths(root);
m.require = id => stubs[id] || (id.startsWith('@/lib/') ? loadReal('lib/' + id.slice(6) + '.ts') : (() => { throw Error('Unexpected import ' + id); })());
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);

const request = (body, origin = 'https://trybiomod.com') => { const r = new Request('https://trybiomod.com/api/admin/restaurant-partners', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); r.nextUrl = new URL(r.url); return r; };
const post = async (body, origin) => { const res = await m.exports.POST(request(body, origin)); return { status: res.status, body: await res.json() }; };
const promos = () => JSON.parse(db.prepare("SELECT value FROM settings WHERE key='promo_codes_v1'").get()?.value || '[]');
const slots = () => JSON.parse(db.prepare("SELECT value FROM settings WHERE key='restaurant_partners_v1'").get()?.value || '[]');

(async () => {
  // Origin and sign-in are checked before any work.
  assert.equal((await post({ slot: 1 }, 'https://evil.invalid')).status, 403);
  allowed = false; assert.equal((await post({ slot: 1 })).status, 403); allowed = true;
  assert.equal(db.prepare('SELECT count(*) c FROM settings').get().c, 0, 'a refused request writes nothing');

  // Slot numbers outside the twenty are refused.
  for (const bad of [0, 21, 1.5, 'x', null]) assert.equal((await post({ slot: bad, name: 'X' })).status, 400, String(bad));

  // Filling a slot names the link and the code, but prices nothing until it is switched on.
  let r = await post({ slot: 3, name: "Mario's Pizza", percentOff: 12 });
  assert.equal(r.status, 200);
  assert.match(r.body.message, /switched off, so nothing is discounted yet/);
  assert.equal(r.body.slots[2].slug, 'marios-pizza'); assert.equal(r.body.slots[2].code, 'MARIOSPIZZA');
  assert.equal(r.body.slots[2].active, false);
  assert.deepEqual(promos(), [], 'nothing reaches the promo list while the slot is off');
  assert.equal(slots().length, 20, 'all twenty slots are stored');

  // Switching it on is what creates the discount.
  r = await post({ slot: 3, active: true });
  assert.equal(r.status, 200);
  assert.match(r.body.message, /live at 12% off/); assert.match(r.body.message, /\/r\/marios-pizza/);
  assert.deepEqual(r.body.live, ['MARIOSPIZZA']);
  assert.deepEqual(promos().map(p => [p.code, p.percentOff, p.active]), [['MARIOSPIZZA', 12, true]]);
  assert.equal(promos()[0].by, 'logan@example.invalid');

  // A slot with no discount cannot be switched on, and nothing changes when it is refused.
  r = await post({ slot: 4, name: 'No Discount', active: true });
  assert.equal(r.status, 400); assert.match(r.body.error, /needs a restaurant name and a discount/);
  assert.equal(promos().length, 1, 'the refused slot added no code');

  // Renaming follows through to the link and the code, and retires the old code rather than
  // deleting it: the old one may already be printed on a table card.
  r = await post({ slot: 3, name: 'Marios Trattoria', slug: '', code: '' });
  assert.equal(r.status, 200);
  assert.equal(r.body.slots[2].slug, 'marios-trattoria'); assert.equal(r.body.slots[2].code, 'MARIOSTRATTORIA');
  const after = promos();
  assert.equal(after.find(p => p.code === 'MARIOSPIZZA').active, false, 'the old code is switched off, not removed');
  assert.equal(after.find(p => p.code === 'MARIOSTRATTORIA').active, true);

  // A code added on the Promo codes tab is never disturbed by the restaurant programme.
  const keep = [...promos(), { code: 'VIXEN15', percentOff: 15, active: true, created: 5, by: 'logan' }];
  db.prepare("UPDATE settings SET value=? WHERE key='promo_codes_v1'").run(JSON.stringify(keep));
  r = await post({ slot: 5, name: 'Keg And Grill', percentOff: 10, active: true });
  assert.equal(r.status, 200);
  assert.equal(promos().find(p => p.code === 'VIXEN15').active, true, 'an unrelated code keeps working');
  assert.equal(promos().find(p => p.code === 'KEGANDGRILL').percentOff, 10);

  // Switching a slot off takes its code down with it.
  r = await post({ slot: 5, active: false });
  assert.equal(r.status, 200); assert.deepEqual(r.body.retired, ['KEGANDGRILL']);
  assert.equal(promos().find(p => p.code === 'KEGANDGRILL').active, false);
  assert.equal(promos().find(p => p.code === 'VIXEN15').active, true);

  // Clearing a slot empties it and takes its code down too.
  r = await post({ slot: 3, clear: true });
  assert.equal(r.status, 200); assert.equal(r.body.slots[2].name, ''); assert.equal(r.body.slots[2].code, '');
  assert.equal(promos().find(p => p.code === 'MARIOSTRATTORIA').active, false);

  // Every save is recorded, and never with a customer or a secret in it.
  assert(events.length >= 5);
  for (const e of events) { assert.equal(e.actor, 'logan@example.invalid'); assert.equal(e.action, 'store.restaurant_partner'); assert.deepEqual(e.changes, []); }
  assert(events.some(e => /is on at 12% with code MARIOSPIZZA/.test(e.summary)));

  // A slot changed underneath the page loses the race rather than clobbering it.
  const stale = slots();
  db.prepare("UPDATE settings SET value=? WHERE key='restaurant_partners_v1'").run(JSON.stringify(stale.map(s => s.slot === 9 ? { ...s, name: 'Someone Else' } : s)));
  // The route re-reads, so a concurrent edit to a DIFFERENT slot is preserved, not overwritten.
  r = await post({ slot: 10, name: 'Tenth Place', percentOff: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.body.slots[8].name, 'Someone Else', "another administrator's slot survives");

  // --- Wiring: the screen lives inside the Affiliates tab and prints the real link ---
  const ui = fs.readFileSync(path.join(root, 'components/store/restaurant-partners-admin.tsx'), 'utf8');
  assert.match(ui, /\/api\/admin\/restaurant-partners/, 'the screen talks to the slots endpoint');
  assert.match(ui, /'https:\/\/trybiomod\.com\/r\/' \+ slug/, 'and shows the link the owner hands out');
  assert.match(ui, /credited to nobody/, 'it says plainly that a link alone earns no credit');
  assert.match(ui, /Retired codes/, 'and surfaces codes kept switched off');
  const tab = fs.readFileSync(path.join(root, 'components/store/affiliate-program.tsx'), 'utf8');
  assert.match(tab, /<RestaurantPartners\/>/, 'the Affiliates tab renders it');
  assert.match(tab, /<summary[^>]*>Restaurant partners/, 'as a dropdown');
  assert.match(tab, /data\.canPublish&&<details className="account-record"><summary[^>]*>Restaurant partners/, 'owner only');

  console.log('PASS: restaurant slots endpoint gates origin and sign-in, bounds the slot number, derives link and code from a name, prices nothing until switched on, retires rather than deletes a renamed or switched-off code, leaves unrelated promo codes untouched, records every save, and preserves a concurrent edit to another slot. Isolated SQLite only.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.close());
