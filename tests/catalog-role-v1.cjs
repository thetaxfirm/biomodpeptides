// Catalog staff role (owner request, Oct 30 2026): products, prices, sales and lot/COA links only.
// Real lib/staff.ts, every migration in an in-memory SQLite database, and the route/UI sources.
// Product-save field limits are exercised through the real admin route in product-availability-v1.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, f);
const staff = require('../lib/staff.ts');

// Permission matrix.
assert.deepEqual(staff.permissionsFor('catalog'), ['catalog:write']);
assert(staff.assignableRoles.includes('catalog') && staff.isAssignableRole('catalog'));
for (const role of ['owner', 'manager']) assert(staff.can(role, 'catalog:write'), role + ' keeps product editing');
for (const role of ['fulfillment', 'support']) assert(!staff.can(role, 'catalog:write'), role + ' cannot edit products');
const tabs = Object.keys(staff.tabPermission);
assert.deepEqual(tabs.filter(t => staff.canSeeTab('catalog', t)), ['products'], 'Catalog sees the Products tab only');
for (const role of ['owner', 'manager']) assert(staff.canSeeTab(role, 'products'));
for (const permission of ['orders:read', 'orders:fulfill', 'orders:reconcile', 'requests:write', 'store:write', 'reports:read', 'team:manage'])
  assert(!staff.can('catalog', permission), 'Catalog lacks ' + permission);
assert.deepEqual([...staff.catalogEditableFields], ['price', 'packPrices', 'sale', 'batch']);
assert.match(staff.roleDetails.catalog.description, /Cannot see orders, customers, reports or settings/);

// Migration 0034: rows preserved, catalog allowed, owner still refused, change history still recorded.
const db = new DatabaseSync(':memory:');
const files = fs.readdirSync(path.join(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort();
const at = files.indexOf('0034_staff_catalog_role.sql');
assert(at > 0, 'migration present');
for (const name of files.slice(0, at)) db.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
db.prepare("INSERT INTO staff VALUES('manager@example.invalid','Manager','manager',1,10,20,'owner@example.invalid')").run();
db.prepare("INSERT INTO staff VALUES('former@example.invalid','','support',0,11,21,'owner@example.invalid')").run();
assert.throws(() => db.prepare("INSERT INTO staff VALUES('early@example.invalid','','catalog',1,1,1,'x')").run(), /CHECK constraint/, 'catalog refused before 0034');
const before = db.prepare('SELECT * FROM staff ORDER BY email').all().map(r => ({ ...r }));
const eventsBefore = db.prepare('SELECT COUNT(*) n FROM change_events').get().n;
for (const name of files.slice(at)) db.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
assert.deepEqual(db.prepare('SELECT * FROM staff ORDER BY email').all().map(r => ({ ...r })), before, 'Existing staff rows unchanged');
assert.equal(db.prepare('SELECT COUNT(*) n FROM change_events').get().n, eventsBefore, 'The table copy writes no change events');
assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='staff' ORDER BY name").all().map(r => r.name), ['audit_staff_delete', 'audit_staff_insert', 'audit_staff_update']);
db.prepare("INSERT INTO staff VALUES('bryan@example.invalid','Bryan','catalog',1,30,30,'owner@example.invalid')").run();
const event = db.prepare("SELECT action,entity_id,changes FROM change_events WHERE entity_type='staff' ORDER BY rowid DESC LIMIT 1").get();
assert.equal(event.action, 'staff.insert'); assert.equal(event.entity_id, 'bryan@example.invalid'); assert.match(event.changes, /"after":"catalog"/);
for (const role of ['owner', 'admin', 'Catalog']) assert.throws(() => db.prepare("INSERT INTO staff VALUES('x-" + role + "@example.invalid','',?,1,1,1,'x')").run(role), /CHECK constraint/, role + ' refused');

// Route and UI wiring.
const route = fs.readFileSync(path.join(root, 'app/api/store/[action]/route.ts'), 'utf8');
assert.match(route, /'admin-product': 'catalog:write'/);
assert.match(route, /requireStaffAny\(\['orders:read', 'catalog:write'\]\)/, 'Dashboard loads for Catalog staff');
assert.match(route, /orders: allowed\('orders:read'\) \?/, 'Orders are sent only to roles that read orders');
assert.match(route, /batchRecords: allowed\('catalog:write'\)/);
assert.match(route, /admin-coa-original'\) \{\n\s+try \{ await requireStaff\('catalog:write'\)/, 'Catalog can open private original reports from the editor');
assert.match(route, /if \(actor\.role === 'catalog'\) \{/);
const products = fs.readFileSync(path.join(root, 'components/store/admin-products.tsx'), 'utf8');
for (const name of ['preorderPercent', 'preorderShips', 'stockQuantity', 'maxQuantity']) assert.match(products, new RegExp('name="' + name + '" readOnly=\\{limited\\}'));
assert.match(products, /disabled=\{busy \|\| limited\} onChange=\{\(\) => status\(state\.value\)\}/);
const admin = fs.readFileSync(path.join(root, 'components/store/admin.tsx'), 'utf8');
assert.match(admin, /<TabsContent value="products">\{allowed\('catalog:write'\) && <AdminProducts/, 'Catalog users see the product editor, not an empty tab');
assert.match(admin, /limited=\{data\.role === 'catalog'\}/);
assert.match(admin, /visibleTabs\[0\]\?\.\[0\]/, 'A role without Orders opens on its first visible tab');
console.log('PASS: Catalog role holds catalog:write only and sees Products only; owners/managers keep it; 0034 keeps staff rows, history triggers and the owner guard; dashboard hides orders from Catalog; editor locks stock and availability.');
