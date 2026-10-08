const assert = require('node:assert/strict');
const fs = require('node:fs'); const Module = require('node:module'); const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true}}).outputText, f);
const { createCartImports } = require('../lib/cart-import.ts');
const { clearAuthSessionCookies, needsAnonymousSession, needsAccountSession } = require('../lib/auth-return.ts');
const sql = new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,cart TEXT NOT NULL DEFAULT '[]',updated INTEGER NOT NULL); CREATE TABLE customer_carts(id TEXT PRIMARY KEY,cart TEXT NOT NULL DEFAULT '[]',updated INTEGER NOT NULL); CREATE TABLE requests(id TEXT PRIMARY KEY,owner TEXT,kind TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',created INTEGER NOT NULL); CREATE TABLE transaction_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1)); CREATE TABLE product_overrides(id INTEGER PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE campaigns(id TEXT PRIMARY KEY,data TEXT,active INTEGER);`);
class Statement {
  constructor(query, values = []) { this.query = query; this.values = values; }
  bind(...values) { return new Statement(this.query, values); }
  async first() { return sql.prepare(this.query).get(...this.values) || null; }
  async all() { return {results: sql.prepare(this.query).all(...this.values)}; }
  async run() { const result = sql.prepare(this.query).run(...this.values); return {meta: {changes: result.changes}}; }
}
let beforeBatch = null;
const db = {prepare: query => new Statement(query), async batch(statements) { if (beforeBatch) { const fn = beforeBatch; beforeBatch = null; await fn(); } sql.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } }};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './runtime' && parent?.filename.endsWith('/lib/commerce.ts')) return {
    all: async (query, ...args) => (await db.prepare(query).bind(...args).all()).results,
    one: async (query, ...args) => db.prepare(query).bind(...args).first(),
    setting: async (key, fallback) => { const row = await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first(); return row ? JSON.parse(row.value) : fallback; },
    parse: (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const {validateLines, quote} = require('../lib/commerce.ts');
const {products} = require('../lib/catalog.ts');
const bpc = products.find(p => p.slug === 'bpc-157-10mg');
const tb = products.find(p => p.slug === 'tb500-10mg');
assert(bpc && tb, 'catalog fixture products exist');
for (const product of [bpc, tb]) sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?)').run(product.id, JSON.stringify({inStock:true,purchasable:true,stockQuantity:20,maxQuantity:20}));
let clock = 2000000000000;
const imports = createCartImports({db, normalize:validateLines, validate:quote, now:()=>clock});
const current = [{id:bpc.id,quantity:2}];
const saved = [{id:tb.id,quantity:1}];
const raw = x => JSON.stringify(x);
function fixture(owner, session, guest, account) { sql.prepare('INSERT INTO sessions(id,cart,updated) VALUES(?,?,?)').run(session,raw(guest),clock); if (account !== undefined) sql.prepare('INSERT INTO customer_carts(id,cart,updated) VALUES(?,?,?)').run(owner,raw(account),clock); }
function cart(owner) { return JSON.parse(sql.prepare('SELECT cart FROM customer_carts WHERE id=?').get(owner).cart); }
async function choose(owner, session, option) { const conflict = await imports.inspect(owner,session); assert(conflict); await imports.choose(owner,session,conflict.id,conflict.revision,option); return conflict; }
(async()=>{
  // Existing nonempty saved cart: both survive until an explicit selection.
  fixture('one','s1',current,saved); await imports.record('one','s1');
  const conflict = await imports.inspect('one','s1'); assert.deepEqual(conflict.current,current); assert.deepEqual(conflict.saved,saved); assert.deepEqual(cart('one'),saved);
  await assert.rejects(imports.assertResolved('one','s1'),/Choose which cart/);
  assert.deepEqual(await imports.inspect('one','s1'),conflict,'repeat state preserves both carts');
  await assert.rejects(imports.choose('another','s1',conflict.id,conflict.revision,'current'),/no longer available/);
  await assert.rejects(imports.choose('one','wrong-session',conflict.id,conflict.revision,'current'),/no longer available/);
  await imports.choose('one','s1',conflict.id,conflict.revision,'current'); assert.deepEqual(cart('one'),current);
  await imports.choose('one','s1',conflict.id,conflict.revision,'saved'); assert.deepEqual(cart('one'),current,'replayed opposite choice cannot overwrite');
  assert.equal(await imports.inspect('one','s1'),null);
  const archived=JSON.parse(sql.prepare('SELECT data FROM requests WHERE id=?').get(conflict.id).data); assert.deepEqual(archived.guestCart,current); assert.deepEqual(archived.savedCart,saved);
  // Empty saved cart imports once; empty guest preserves a saved cart; same carts do not double.
  fixture('two','s2',current,[]); await imports.record('two','s2'); assert.equal(await imports.inspect('two','s2'),null); assert.deepEqual(cart('two'),current); assert.equal(await imports.inspect('two','s2'),null);
  fixture('three','s3',current,current); await imports.record('three','s3'); assert.equal(await imports.inspect('three','s3'),null); assert.deepEqual(cart('three'),current);
  fixture('four','s4',[],saved); await imports.record('four','s4'); assert.equal(await imports.inspect('four','s4'),null); assert.deepEqual(cart('four'),saved);
  // Packs keep their grouping/quantities exactly; mixed and fixed pricing validators run.
  const fixed=[{id:bpc.id,quantity:3,packId:'fixed-one',packSize:3,packKind:'fixed'}];
  const mixed=[{id:bpc.id,quantity:2,packId:'mixed-one',packSize:3,packKind:'mixed'},{id:tb.id,quantity:1,packId:'mixed-one',packSize:3,packKind:'mixed'}];
  fixture('five','s5',fixed,mixed); await imports.record('five','s5'); await choose('five','s5','current'); assert.deepEqual(cart('five'),fixed);
  fixture('six','s6',fixed,mixed); await imports.record('six','s6'); await choose('six','s6','saved'); assert.deepEqual(cart('six'),mixed);
  const malformed=[{id:bpc.id,quantity:2,packId:'bad',packSize:3,packKind:'fixed'}];
  fixture('seven','s7',malformed,[]); await imports.record('seven','s7'); const bad=await imports.inspect('seven','s7'); assert(bad); await assert.rejects(imports.choose('seven','s7',bad.id,bad.revision,'current'),/Complete every slot/); assert.deepEqual(cart('seven'),[]);
  // Stock rejection preserves both, with an explicit empty-cart escape path.
  fixture('eight','s8',[{id:bpc.id,quantity:21}],saved); await imports.record('eight','s8'); const stock=await imports.inspect('eight','s8'); await assert.rejects(imports.choose('eight','s8',stock.id,stock.revision,'current'),/availability/); assert.deepEqual(cart('eight'),saved); await imports.choose('eight','s8',stock.id,stock.revision,'empty'); assert.deepEqual(cart('eight'),[]);
  // A saved cart changing in another browser cannot be overwritten from an old choice.
  fixture('nine','s9',current,saved); await imports.record('nine','s9'); const stale=await imports.inspect('nine','s9'); sql.prepare('UPDATE customer_carts SET cart=? WHERE id=?').run(raw([{id:tb.id,quantity:3}]),'nine'); await assert.rejects(imports.choose('nine','s9',stale.id,stale.revision,'current'),/another tab/); assert.deepEqual(cart('nine'),[{id:tb.id,quantity:3}]);
  // Automatic import expires, but the contents remain available for explicit choice.
  fixture('ten','s10',current,[]); await imports.record('ten','s10'); clock+=3600001; assert(await imports.inspect('ten','s10')); await choose('ten','s10','current'); assert.deepEqual(cart('ten'),current);
  // Guest writes already in flight: before state processing and after completed import.
  fixture('eleven','s11',current,saved); await imports.record('eleven','s11'); const late=[{id:bpc.id,quantity:4}]; await imports.saveGuest('s11',late); assert.deepEqual((await imports.inspect('eleven','s11')).current,late); await choose('eleven','s11','current');
  const later=[{id:bpc.id,quantity:5}]; await imports.saveGuest('s11',later); const again=await imports.inspect('eleven','s11'); assert.deepEqual(again.current,later); assert.deepEqual(again.saved,late); await choose('eleven','s11','current'); assert.deepEqual(cart('eleven'),later);
  // Login claiming a session between a guest write's read/commit forces retry, not loss.
  fixture('twelve','s12',current,saved); beforeBatch=()=>imports.record('twelve','s12'); await imports.saveGuest('s12',late); assert.deepEqual((await imports.inspect('twelve','s12')).current,late);
  // A competing account change at the atomic write boundary rolls back the entire choice.
  fixture('thirteen','s13',current,saved); await imports.record('thirteen','s13'); const racing=await imports.inspect('thirteen','s13'); beforeBatch=async()=>sql.prepare('UPDATE customer_carts SET cart=? WHERE id=?').run(raw(late),'thirteen'); await assert.rejects(imports.choose('thirteen','s13',racing.id,racing.revision,'current'),/cart changed/i); assert.deepEqual(cart('thirteen'),late); assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(racing.id).status,'cart_conflict');
  // Logout clears identity and guest-session cookies, while unrelated preferences remain.
  const jar=new Map([['bm_access','token'],['bm_refresh','refresh'],['bm_session','s13'],['bm_auth_return','/checkout'],['bm_anonymous_session','another'],['preference','yes']]); clearAuthSessionCookies({delete:key=>jar.delete(key)}); assert.deepEqual([...jar],[['preference','yes']]); assert.deepEqual(cart('thirteen'),late);
  fixture('fourteen','fresh-session',[],undefined); await imports.record('fourteen','fresh-session'); assert.equal(await imports.inspect('fourteen','fresh-session'),null); assert.deepEqual(cart('fourteen'),[]); assert.equal(await imports.inspect('fourteen','s13'),null,'another owner cannot see prior conflict');
  assert.equal(await imports.ownerForSession('s13'),'thirteen','session ownership survives expired auth cookies');
  await assert.rejects(imports.record('replacement-member','s13'),/fresh shopping session/);
  await assert.rejects(imports.bindOwner('replacement-member','s13'),/fresh shopping session/);
  fixture('legacy-member','legacy-session',current,current); await imports.bindOwner('legacy-member','legacy-session'); assert.equal(await imports.ownerForSession('legacy-session'),'legacy-member');
  // A concurrent first login cannot claim the same session for another account.
  fixture('winner','concurrent-login',current,[]); beforeBatch=()=>imports.record('winner','concurrent-login'); await assert.rejects(imports.record('loser','concurrent-login')); assert.equal(await imports.ownerForSession('concurrent-login'),'winner'); assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM requests WHERE owner='loser'").get().n,0);
  assert(needsAnonymousSession(false,true,null,'old-session',undefined));
  fixture('anonymous-fixture','converted-anonymous',[],undefined);
  await imports.saveGuest('converted-anonymous',current);
  assert.equal(needsAnonymousSession(false,true,null,'converted-anonymous','converted-anonymous'),false,'second anonymous state must retain the new guest cart');
  assert.deepEqual(JSON.parse(sql.prepare('SELECT cart FROM sessions WHERE id=?').get('converted-anonymous').cart),current);
  assert(needsAccountSession(undefined,'replacement-member','thirteen',true,'s13',undefined));
  assert(needsAccountSession(undefined,'replacement-member',null,true,'legacy-unclaimed',undefined));
  assert.equal(needsAccountSession(undefined,'replacement-member',null,true,'converted-anonymous','converted-anonymous'),false,'intentional guest cart survives stale auth cookies after one conversion');
  assert.equal(await imports.inspect('replacement-member','s13'),null);
  await assert.rejects(imports.saveGuest('fresh-session',Array.from({length:101},()=>current[0])),/too many/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM transaction_guards').get().n,0);
  console.log('PASS: cart import conflict, empty/identical carts, replay/isolation, real pack and stock validation, delayed guest writes, transaction races, and logout cookie isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
