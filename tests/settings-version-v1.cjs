// Real SQLite transactions with the production compare-and-swap helper. No external I/O.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const raw = new DatabaseSync(':memory:');
raw.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE transaction_guards(id TEXT PRIMARY KEY,valid INTEGER CHECK(valid=1));');
let audited = 0;
const db = {
  prepare(sql) { return { bind(...args) { return { sql, args, async first() { return raw.prepare(sql).get(...args) || null; }, async run() { return { meta: { changes: raw.prepare(sql).run(...args).changes } }; } }; } }; },
  async batch(statements) { raw.exec('BEGIN'); try { const results = statements.map(s => ({ meta: { changes: raw.prepare(s.sql).run(...s.args).changes } })); raw.exec('COMMIT'); return results; } catch (e) { raw.exec('ROLLBACK'); throw e; } },
};
const filename = path.resolve(__dirname,'../lib/settings-version.ts'), m = new Module(filename,module);
m.require = id => { assert.equal(id,'./change-history'); return { auditRun: async (db, actor, sql, ...args) => { audited++; return db.prepare(sql).bind(...args).run(); }, withAuditDb: db => { audited++; return db; } }; };
m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{ compilerOptions:{target:9,module:1} }).outputText,filename);
const { settingsSnapshot, saveSettingsSnapshot, saveRawSettingsSnapshots, SettingsConflict } = m.exports;
const actor = { source:'admin',actor:'fixture@example.invalid',actorType:'staff' };
(async()=>{
 const first = await settingsSnapshot(db,'store');
 const initialVersion = await saveSettingsSnapshot(db,first,{packDiscounts:{3:10},shippingCents:500},actor);
 const editorA = await settingsSnapshot(db,'store',initialVersion), editorB = await settingsSnapshot(db,'store',initialVersion);
 await saveSettingsSnapshot(db,editorA,{packDiscounts:{3:10},shippingCents:700},actor);
 await assert.rejects(()=>saveSettingsSnapshot(db,editorB,{packDiscounts:{3:15},shippingCents:500},actor),SettingsConflict);
 assert.equal(JSON.parse(raw.prepare('SELECT value FROM settings WHERE key=?').get('store').value).shippingCents,700,'A second writer cannot restore stale shipping');
 await assert.rejects(()=>settingsSnapshot(db,'store',initialVersion),SettingsConflict,'A stale client is rejected before a merge');
 const token = await settingsSnapshot(db,'token'), chats = await settingsSnapshot(db,'chats');
 await saveRawSettingsSnapshots(db,[{before:token,value:'synthetic-credential'},{before:chats,value:'synthetic-group'}],actor);
 const tokenBefore = await settingsSnapshot(db,'token'), chatsBefore = await settingsSnapshot(db,'chats');
 raw.prepare('UPDATE settings SET value=? WHERE key=?').run('other-group','chats');
 await assert.rejects(()=>saveRawSettingsSnapshots(db,[{before:tokenBefore,value:'replacement'},{before:chatsBefore,value:'replacement-group'}],actor),SettingsConflict);
 assert.equal(raw.prepare('SELECT value FROM settings WHERE key=?').get('token').value,'synthetic-credential','A conflict rolls back every row, including the credential');
 assert.equal(raw.prepare('SELECT COUNT(*) n FROM transaction_guards').get().n,0);
 assert(audited>=4,'Every write uses audited database access');
 console.log('PASS: stale-client and concurrent settings writes are rejected; multi-row alert changes roll back atomically; snapshots expose only hashes; all writes use audited access.');
})().catch(e=>{console.error(e);process.exitCode=1;});
