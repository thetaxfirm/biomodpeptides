// Real lib/staff-store.ts against the real 0019 migration in an in-memory SQLite D1 shim.
// Synthetic addresses only; no auth provider, mail or live database.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, deps = {}) {
  const filename = path.join(root, relative), m = new Module(filename, module);
  m.filename = filename;
  m.require = id => { if (deps[id]) return deps[id]; throw Error('Unexpected dependency ' + id); };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
const staff = load('lib/staff.ts');
const store = load('lib/staff-store.ts', { './staff': staff });
function d1(db) {
  const statement = (sql, args = []) => ({ bind: (...a) => statement(sql, a), first: async () => db.prepare(sql).get(...args) || null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: db.prepare(sql).run(...args) }) });
  return { prepare: sql => statement(sql), batch: async list => { db.exec('BEGIN'); try { const r = []; for (const s of list) r.push(await s.run()); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
(async () => {
  // Role matrix: the server and admin UI read the same table.
  assert.deepEqual(staff.permissionsFor('fulfillment'), ['orders:read', 'orders:fulfill', 'orders:reconcile']);
  assert.equal(staff.can('support', 'orders:fulfill'), false);
  assert.equal(staff.can('manager', 'team:manage'), false);
  assert.equal(staff.can('owner', 'team:manage'), true);
  assert.deepEqual(staff.permissionsFor('admin'), [], 'Unknown roles have no permissions');
  assert.deepEqual(['orders', 'requests', 'promos', 'settings', 'team'].filter(t => staff.canSeeTab('support', t)), ['orders', 'requests']);
  assert.deepEqual(['orders', 'requests', 'promos', 'settings', 'team'].filter(t => staff.canSeeTab('fulfillment', t)), ['orders']);
  assert.equal(staff.canSeeTab('owner', 'not-a-tab'), false, 'Unlisted tabs are never shown');

  // Before the migration the Team tab reports it instead of failing the dashboard.
  const bare = { STORE_ADMIN_EMAILS: 'Owner@Example.invalid', DB: d1(new DatabaseSync(':memory:')) };
  assert.deepEqual(await store.staffDirectory(bare), { ready: false, owners: ['owner@example.invalid'], staff: [], audit: [] });

  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(root, 'drizzle/0019_staff_access.sql'), 'utf8'));
  const env = { STORE_ADMIN_EMAILS: 'owner@example.invalid, second-owner@example.invalid', DB: d1(db) };
  let now = 1000;
  const save = change => store.saveStaffMember(env, ' Owner@Example.invalid ', change, ++now);

  assert.match((await save({ email: ' New.Person@Example.invalid ', name: 'New Person', role: 'fulfillment', active: true })).message, /new\.person@example\.invalid can now sign in as fulfillment/);
  await save({ email: 'new.person@example.invalid', name: 'New Person', role: 'support', active: true });
  assert.match((await save({ email: 'new.person@example.invalid', role: 'support', active: false })).message, /no longer has store access/);
  const row = db.prepare('SELECT * FROM staff').get();
  assert.deepEqual({ ...row }, { email: 'new.person@example.invalid', name: '', role: 'support', active: 0, created: 1001, updated: 1003, updated_by: 'owner@example.invalid' }, 'One normalized row; created time kept');
  assert.deepEqual(db.prepare('SELECT actor,email,role,active,created FROM staff_audit ORDER BY created').all().map(r => ({ ...r })), [
    { actor: 'owner@example.invalid', email: 'new.person@example.invalid', role: 'fulfillment', active: 1, created: 1001 },
    { actor: 'owner@example.invalid', email: 'new.person@example.invalid', role: 'support', active: 1, created: 1002 },
    { actor: 'owner@example.invalid', email: 'new.person@example.invalid', role: 'support', active: 0, created: 1003 },
  ], 'Every grant, change and removal is recorded');

  // Owners cannot be created, demoted or removed from the Team tab.
  for (const email of ['owner@example.invalid', ' SECOND-OWNER@example.invalid '])
    await assert.rejects(save({ email, role: 'support', active: false }), /already an owner/);
  for (const email of ['', 'not-an-email', 'two@example.invalid,three@example.invalid', 'a b@example.invalid'])
    await assert.rejects(save({ email, role: 'support', active: true }), /one valid email/);
  await assert.rejects(save({ email: 'x@example.invalid', role: 'owner', active: true }), /Manager, Fulfillment or Support/);
  // The database refuses an owner row even if application checks were bypassed.
  assert.throws(() => db.prepare("INSERT INTO staff VALUES('raw@example.invalid','', 'owner',1,1,1,'x')").run(), /CHECK constraint/);
  assert.throws(() => db.prepare("INSERT INTO staff VALUES('Raw@Example.invalid','', 'support',1,1,1,'x')").run(), /CHECK constraint/);
  // A failed audit write rolls back the access change.
  db.exec('DROP TABLE staff_audit');
  await assert.rejects(save({ email: 'rollback@example.invalid', role: 'manager', active: true }));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM staff WHERE email='rollback@example.invalid'").get().n, 0);
  db.exec(fs.readFileSync(path.join(root, 'drizzle/0019_staff_access.sql'), 'utf8'));

  const directory = await store.staffDirectory(env);
  assert.equal(directory.ready, true);
  assert.deepEqual(directory.owners, ['owner@example.invalid', 'second-owner@example.invalid']);
  assert.deepEqual(directory.staff.map(m => [m.email, m.role, m.active]), [['new.person@example.invalid', 'support', 0]]);
  console.log('PASS: staff roles share one permission table; Team saves normalize, audit atomically, cannot touch owners, and the database rejects owner or unnormalized rows.');
})().catch(error => { console.error(error); process.exitCode = 1; });
