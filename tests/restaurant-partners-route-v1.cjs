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
  assert.equal(r.body.slots[2].code, 'MARIOSPIZZA12'); assert.equal(r.body.slots[2].slug, 'mariospizza12', 'the link is the code');
  assert.equal(r.body.slots[2].active, false);
  assert.deepEqual(promos(), [], 'nothing reaches the promo list while the slot is off');
  assert.equal(slots().length, 20, 'all twenty slots are stored');

  // Switching it on is what creates the discount.
  r = await post({ slot: 3, active: true });
  assert.equal(r.status, 200);
  assert.match(r.body.message, /live at 12% off/); assert.match(r.body.message, /trybiomod\.com\/mariospizza12/);
  assert.deepEqual(r.body.live, ['MARIOSPIZZA12']);
  assert.deepEqual(promos().map(p => [p.code, p.percentOff, p.active]), [['MARIOSPIZZA12', 12, true]]);
  assert.equal(promos()[0].by, 'logan@example.invalid');

  // A name the storefront already serves is refused outright, rather than yielding a dead link.
  const clash = await post({ slot: 7, name: 'Shop' });
  assert.equal(clash.status, 409); assert.match(clash.body.error, /matches a page the site already serves/);
  const clash2 = await post({ slot: 7, name: 'Signup' });
  assert.equal(clash2.status, 409, 'an old redirect address is refused too');

  // A slot with no discount cannot be switched on, and nothing changes when it is refused.
  r = await post({ slot: 4, name: 'No Discount', active: true });
  assert.equal(r.status, 400); assert.match(r.body.error, /needs a restaurant name and a discount/);
  assert.equal(promos().length, 1, 'the refused slot added no code');

  // Renaming follows through to the link and the code, and retires the old code rather than
  // deleting it: the old one may already be printed on a table card.
  r = await post({ slot: 3, name: 'Marios Trattoria', slug: '', code: '' });
  assert.equal(r.status, 200);
  assert.equal(r.body.slots[2].code, 'MARIOSTRATTORIA12'); assert.equal(r.body.slots[2].slug, 'mariostrattoria12');
  const after = promos();
  assert.equal(after.find(p => p.code === 'MARIOSPIZZA12').active, false, 'the old code is switched off, not removed');
  assert.equal(after.find(p => p.code === 'MARIOSTRATTORIA12').active, true);

  // A code added on the Promo codes tab is never disturbed by the restaurant programme.
  const keep = [...promos(), { code: 'VIXEN15', percentOff: 15, active: true, created: 5, by: 'logan' }];
  db.prepare("UPDATE settings SET value=? WHERE key='promo_codes_v1'").run(JSON.stringify(keep));
  r = await post({ slot: 5, name: 'Keg And Grill', percentOff: 10, active: true });
  assert.equal(r.status, 200);
  assert.equal(promos().find(p => p.code === 'VIXEN15').active, true, 'an unrelated code keeps working');
  assert.equal(promos().find(p => p.code === 'KEGANDGRILL10').percentOff, 10);

  // Switching a slot off takes its code down with it.
  r = await post({ slot: 5, active: false });
  assert.equal(r.status, 200); assert.deepEqual(r.body.retired, ['KEGANDGRILL10']);
  assert.equal(promos().find(p => p.code === 'KEGANDGRILL10').active, false);
  assert.equal(promos().find(p => p.code === 'VIXEN15').active, true);

  // Clearing a slot empties it and takes its code down too.
  r = await post({ slot: 3, clear: true });
  assert.equal(r.status, 200); assert.equal(r.body.slots[2].name, ''); assert.equal(r.body.slots[2].code, '');
  assert.equal(promos().find(p => p.code === 'MARIOSTRATTORIA12').active, false);

  // Every save is recorded, and never with a customer or a secret in it.
  assert(events.length >= 5);
  for (const e of events) { assert.equal(e.actor, 'logan@example.invalid'); assert.equal(e.action, 'store.restaurant_partner'); assert.deepEqual(e.changes, []); }
  assert(events.some(e => /is on at 12% with code MARIOSPIZZA12/.test(e.summary)));

  // A slot changed underneath the page loses the race rather than clobbering it.
  const stale = slots();
  db.prepare("UPDATE settings SET value=? WHERE key='restaurant_partners_v1'").run(JSON.stringify(stale.map(s => s.slot === 9 ? { ...s, name: 'Someone Else' } : s)));
  // The route re-reads, so a concurrent edit to a DIFFERENT slot is preserved, not overwritten.
  r = await post({ slot: 10, name: 'Tenth Place', percentOff: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.body.slots[8].name, 'Someone Else', "another administrator's slot survives");

  // --- The link itself: following trybiomod.com/<code> must apply that discount ---
  // Handing a restaurant a link is pointless if the customer still has to type the code, so the
  // /r route is exercised for real here rather than grepped.
  for (const sql of [
    'CREATE TABLE affiliate_members(code TEXT, owner TEXT, agreement_id TEXT, status TEXT)',
    'CREATE TABLE affiliate_program_state(id INTEGER, agreement_id TEXT)',
    'CREATE TABLE affiliate_schedule_state(owner TEXT, schedule_id TEXT)',
    'CREATE TABLE affiliate_schedules(id TEXT, agreement_id TEXT)',
    'CREATE TABLE affiliate_schedule_acceptances(schedule_id TEXT, owner TEXT)',
  ]) db.exec(sql);
  db.exec("INSERT INTO affiliate_members VALUES('ANNAX20','anna','a1','approved')");
  db.exec("INSERT INTO affiliate_program_state VALUES(1,'a1')");
  db.exec("INSERT INTO affiliate_schedule_state VALUES('anna','s1')");
  db.exec("INSERT INTO affiliate_schedules VALUES('s1','a1')");
  db.exec("INSERT INTO affiliate_schedule_acceptances VALUES('s1','anna')");
  const stored = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='promo_codes_v1'").get()?.value || '[]');
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('promo_codes_v1',?)")
    .run(JSON.stringify([...stored, { code: 'ANNAX20', percentOff: 20, active: true, created: 1, by: 'owner' }]));

  class Jar { constructor() { this.items = new Map(); } set(name, value, options) { this.items.set(name, { value, options }); } }
  NextResponse.redirect = (url, status) => ({ status, url: String(url), headers: new Headers(), cookies: new Jar() });
  const link = loadReal('app/r/[code]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/runtime': { database: () => D1 },
    '@/lib/promotions': loadReal('lib/promotions.ts'),
    '@/lib/promo-codes': loadReal('lib/promo-codes.ts'),
    '@/lib/restaurant-partners': P,
  });
  const follow = async asked => {
    const req = new Request('https://trybiomod.com/r/' + encodeURIComponent(asked));
    req.nextUrl = new URL(req.url);
    const res = await link.GET(req, { params: Promise.resolve({ code: asked }) });
    return res.cookies.items.get('bm_promo')?.value || '';
  };
  r = await post({ slot: 14, name: 'Sunrise Diner', percentOff: 20, active: true });
  assert.equal(r.status, 200);
  const liveSlot = slots().find(s => s.slot === 14);
  assert(liveSlot.active && liveSlot.code === 'SUNRISEDINER20', 'a live slot to follow');
  assert.equal(liveSlot.slug, liveSlot.code.toLowerCase(), 'the link is the code');
  assert.equal(await follow(liveSlot.slug), liveSlot.code, 'the bare link applies its discount');
  assert.equal(await follow(liveSlot.code), liveSlot.code, 'and so does the code written out');
  assert.equal(await follow(liveSlot.slug.toUpperCase()), liveSlot.code, 'case does not matter');
  // Nothing else gets a cookie: not a retired code, not a slot that is off, not an unknown address.
  const off = slots().find(s => s.code && !s.active);
  if (off) assert.equal(await follow(off.slug || off.code), '', 'a switched-off slot discounts nothing');
  const retired = slots().flatMap(s => s.previous)[0];
  if (retired) assert.equal(await follow(retired), '', 'a retired code discounts nothing');
  for (const bad of ['nosuchplace', '../etc', '', 'a'.repeat(60)]) assert.equal(await follow(bad), '', bad);
  // The affiliate path is untouched: an approved member still earns their cookie.
  assert.equal(await follow('ANNAX20'), 'ANNAX20', 'approved affiliate links still work');
  db.exec("UPDATE affiliate_members SET status='pending'");
  assert.equal(await follow('ANNAX20'), '', 'and an unapproved one still does not');

  // --- Wiring: the screen lives inside the Affiliates tab and prints the real link ---
  const ui = fs.readFileSync(path.join(root, 'components/store/restaurant-partners-admin.tsx'), 'utf8');
  assert.match(ui, /\/api\/admin\/restaurant-partners/, 'the screen talks to the slots endpoint');
  assert.match(ui, /'https:\/\/trybiomod\.com\/' \+ slug/, 'and shows the bare link the owner hands out');
  // The preview must be the link that will actually be saved, discount included.
  assert.match(ui, /codeFromName\(edit\.name, slot\.slot, Number\(edit\.percentOff\) \|\| 0\)/, 'the preview carries the typed discount');
  assert.match(ui, /previewSlug = slugFromCode\(previewCode\)/, 'and the previewed link is that code');
  assert.doesNotMatch(ui, /slugFromName/, 'the old two-identifier preview is gone');
  const proxy = fs.readFileSync(path.join(root, 'proxy.ts'), 'utf8');
  assert.match(proxy, /partnerCodeForSlug\(await partnerSlots\(database\(\)\), slug\)/, 'a bare path resolves a restaurant link');
  assert.match(proxy, /NextResponse\.redirect\(partner, 302\)/, 'and hands off to the route that owns the cookie');
  assert.match(ui, /credited to nobody/, 'it says plainly that a link alone earns no credit');
  assert.match(ui, /Retired codes/, 'and surfaces codes kept switched off');
  // Its own page in the side nav, under the Affiliates dropdown -- not a fold in the middle of
  // the affiliate page, which is where it started (owner, Nov 13 2026).
  const shell = fs.readFileSync(path.join(root, 'components/store/admin.tsx'), 'utf8');
  assert.match(shell, /<TabsContent value="restaurants">\{activeTab === 'restaurants' && <RestaurantPartners\/>\}<\/TabsContent>/, 'Restaurants is a page of its own');
  assert.match(shell, /\{ label: 'Affiliates', tabs: \['affiliates', 'restaurants'\] \}/, 'reached from the Affiliates section');
  assert.match(shell, /tab !== 'restaurants' \|\| role === 'owner'/, 'and stays the owner\'s page');
  const tab = fs.readFileSync(path.join(root, 'components/store/affiliate-program.tsx'), 'utf8');
  assert.doesNotMatch(tab, /RestaurantPartners/, 'the affiliate page no longer carries it');

  console.log('PASS: restaurant slots endpoint gates origin and sign-in, bounds the slot number, derives link and code from a name, applies that discount when the bare link is followed and refuses to for a retired, switched-off or unknown one while leaving approved affiliate links alone, prices nothing until switched on, retires rather than deletes a renamed or switched-off code, leaves unrelated promo codes untouched, records every save, preserves a concurrent edit to another slot, and is reached from its own page under the Affiliates section. Isolated SQLite only.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.close());
