// One CRM for TryBiomod and Biomod Pro: each store publishes its contacts, both read everyone.
// In-memory SQLite stands in for the shared D1 database; synthetic contacts only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'lib/shared-crm.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(m, m.exports, id => { throw Error('Unexpected dependency ' + id); });
const crmLib = m.exports;

// Minimal D1: prepare/bind/all/first/run and batch, over node:sqlite.
function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({ sql, args, bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }), first: async () => db.prepare(sql).get(...args) ?? null, run: async () => db.prepare(sql).run(...args) });
  return { prepare: sql => stmt(sql), batch: async list => { db.exec('BEGIN'); try { for (const s of list) db.prepare(s.sql).run(...s.args); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } }, raw: db };
}
const contact = (email, extra = {}) => ({ email, name: '', phones: [], sources: ['order'], firstSeen: 1000, lastSeen: 2000, orders: 1, paidOrders: 1, paidCents: 18900, owner: null, ...extra });

(async () => {
  const crm = d1();
  // TryBiomod publishes two contacts; Biomod Pro publishes one shared and one of its own.
  const tb = [contact('both@example.invalid', { name: 'Fixture Both', phones: ['702-555-0100'], paidCents: 10000 }), contact('tb-only@example.invalid')];
  assert.deepEqual(await crmLib.publishContacts(crm, 'trybiomod', tb, 5000), { published: 2, unchanged: 0 });
  assert.deepEqual(await crmLib.publishContacts(crm, 'trybiomod', tb, 6000), { published: 0, unchanged: 2 }, 'unchanged rows are not rewritten');
  const pro = [contact('both@example.invalid', { name: 'Fixture Both Newer', phones: ['(702) 555-0100', '702-555-0199'], lastSeen: 3000, sources: ['contact_form'], orders: 0, paidOrders: 0, paidCents: 0 }), contact('pro-only@example.invalid', { sources: ['account'] })];

  // Biomod Pro's admin sees everyone, each with the store(s) they used.
  const list = await crmLib.sharedContactList(crm, 'biomodpro', pro);
  assert.deepEqual(list.map(c => c.email).sort(), ['both@example.invalid', 'pro-only@example.invalid', 'tb-only@example.invalid']);
  const both = list.find(c => c.email === 'both@example.invalid');
  assert.deepEqual(both.stores.map(s => s.site), ['biomodpro', 'trybiomod']);
  assert.equal(both.name, 'Fixture Both Newer', 'the most recent name wins');
  assert.deepEqual(both.phones, ['702-555-0100', '702-555-0199'], 'phones merged by digits');
  assert.equal(both.paidCents, 10000, 'spend adds across stores');
  assert.deepEqual(both.sources.sort(), ['contact_form', 'order']);
  assert.deepEqual(list.find(c => c.email === 'tb-only@example.invalid').stores.map(s => s.site), ['trybiomod']);

  // A single capture (sign-up, form) lands immediately and keeps earlier activity.
  await crmLib.publishOne(crm, 'trybiomod', contact('tb-only@example.invalid', { sources: ['stock_alert'], orders: 0, paidOrders: 0, paidCents: 0, firstSeen: 7000, lastSeen: 7000 }));
  const row = crm.raw.prepare("SELECT sources,orders,paid_cents,first_seen,last_seen FROM crm_store_activity WHERE email='tb-only@example.invalid' AND site='trybiomod'").get();
  assert.deepEqual(JSON.parse(row.sources).sort(), ['order', 'stock_alert']);
  assert.equal(row.orders, 1); assert.equal(row.paid_cents, 18900); assert.equal(row.first_seen, 1000); assert.equal(row.last_seen, 7000);
  await crmLib.publishOne(undefined, 'trybiomod', contact('x@example.invalid')); // no binding: silently skipped

  // Only the two known stores can write.
  await assert.rejects(crmLib.publishContacts(crm, 'elsewhere', [contact('z@example.invalid')]));

  // Hourly publish: reads the store database only, keeps its run time in the CRM, at most once an hour.
  const site = 'trybiomod', store = { prepare: () => { throw Error('the store database is never written'); } };
  let lists = 0; const listFn = async db => { assert.equal(db, store); lists++; return [contact('hourly@example.invalid')]; };
  await crmLib.publishOnSchedule({ DB: store, CRM: crm }, site, listFn, 100_000_000);
  await crmLib.publishOnSchedule({ DB: store, CRM: crm }, site, listFn, 100_000_000 + 59 * 60_000);
  assert.equal(lists, 1, 'second run inside the hour is skipped');
  await crmLib.publishOnSchedule({ DB: store, CRM: crm }, site, listFn, 100_000_000 + 61 * 60_000);
  assert.equal(lists, 2);
  assert.equal(crm.raw.prepare('SELECT count(*) n FROM crm_store_activity WHERE email=? AND site=?').get('hourly@example.invalid', site).n, 1);
  await crmLib.publishOnSchedule({ DB: store }, site, listFn); // no binding: nothing happens
  assert.equal(lists, 2);

  // Wiring: capture, admin list and the one store-specific line.
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(read('lib/crm-capture.ts'), /export const CRM_SITE: CrmSite = '(biomodpro|trybiomod)';/);
  assert.match(read('app/api/store/[action]/route.ts'), /await recordContact\(runtime\(\)\.DB, input\); \} catch \{ \/\* ignore \*\/ \} await shareContact\(input\);/);
  assert.match(read('app/api/admin/contacts/route.ts'), /contactsForAdmin\(await contactList\(database\(\)\)\)/);
  assert.match(read('vite.config.ts'), /binding: "CRM", database_name: "biomod-crm", database_id: SHARED_CRM_DATABASE_ID/);
  console.log('PASS: shared CRM publish, skip-unchanged, cross-store merge, single capture, store guard and wiring');
})().catch(e => { console.error(e); process.exit(1); });
