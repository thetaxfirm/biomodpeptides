// Real history module and all real SQLite migrations. Synthetic fixtures only; no provider/network calls.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'lib/change-history.ts'), m = new Module(filename, module);
m.filename = filename; m.require = name => { throw Error('Unexpected history dependency ' + name); };
m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
const history = m.exports;
function d1(sqlite) {
  const statement = (sql, values = []) => ({
    bind: (...args) => statement(sql, args),
    first: async column => { const row = sqlite.prepare(sql).get(...values) || null; return column ? row?.[column] ?? null : row; },
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => {
      const prepared = sqlite.prepare(sql);
      if (prepared.columns().length) {
        const results = prepared.all(...values);
        const meta = sqlite.prepare('SELECT changes() AS changes,last_insert_rowid() AS last_row_id').get();
        return { results, meta, success: true };
      }
      return { results: [], meta: prepared.run(...values), success: true };
    },
  });
  // D1 batches are serialized atomic transactions, even when callers start concurrently.
  let queue = Promise.resolve();
  return { prepare: sql => statement(sql), batch: list => {
    const job = queue.then(async () => { sqlite.exec('BEGIN'); try { const result = []; for (const stmt of list) result.push(await stmt.run()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } });
    queue = job.catch(() => {}); return job;
  } };
}
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql') && f < '0020').sort()) sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  sqlite.prepare('INSERT INTO staff_audit VALUES(?,?,?,?,?,?)').run('legacy-fixture', 'legacy-owner@example.invalid', 'staff-old@example.invalid', 'support', 1, Date.parse('2026-10-01T10:00:00Z'));
  const migration = fs.readFileSync(path.join(root, 'drizzle/0020_change_history.sql'), 'utf8');
  sqlite.exec(migration);
  for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql') && f > '0020_change_history.sql').sort()) sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  return { sqlite, DB: d1(sqlite), migration };
}
const staff = { source: 'admin', actor: 'owner@example.invalid', actorType: 'staff' };
const system = { source: 'system', actor: 'Checkout inventory settlement', actorType: 'system', action: 'inventory.settled', summary: 'Paid-order inventory settled.' };
const fixture = setup(), { sqlite, DB } = fixture;
const count = () => sqlite.prepare('SELECT COUNT(*) AS n FROM change_events').get().n;
const eventsFor = entity => sqlite.prepare('SELECT * FROM change_events WHERE entity_id=? ORDER BY rowid').all(String(entity)).map(r => ({ ...r, changes: JSON.parse(r.changes) }));
const product = (id, data) => ['INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', id, JSON.stringify(data)];
const safe = () => { const text = JSON.stringify(sqlite.prepare('SELECT * FROM change_events').all()); assert(!text.includes('PRIVATE_'), 'Private data appeared in stored history'); };
(async () => {
  const { migrationStatements } = await import('./sql-migration-fixture.mjs');
  const migrationDb = new DatabaseSync(':memory:');
  try {
    for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort())
      for (const statement of migrationStatements(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'))) migrationDb.exec(statement);
    assert.equal(migrationDb.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n, sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n, 'Worker migration splitter preserves every real trigger');
    assert.throws(() => migrationStatements('CREATE TABLE t(a); CREATE TRIGGER bad AFTER INSERT ON t BEGIN SELECT 1; END;'), /statement-breakpoint/);
  } finally { migrationDb.close(); }
  const legacy = eventsFor('staff-old@example.invalid'); assert.equal(legacy.length, 1); assert.equal(legacy[0].actor, 'legacy-owner@example.invalid'); assert.equal(legacy[0].occurred_at, Date.parse('2026-10-01T10:00:00Z')); assert.equal(legacy[0].status, 'observed'); assert(legacy[0].changes.every(c => c.before === null)); assert.match(legacy[0].summary, /earlier values were not retained/);
  sqlite.exec(fixture.migration); assert.equal(eventsFor('staff-old@example.invalid').length, 1, 'Migration/backfill is idempotent');

  await history.auditRun(DB, staff, ...product(99001, { price: 17900, stockQuantity: 25, inStock: true, preorder: { enabled: true, percentOff: 15, ships: 'early November 2026' }, PRIVATE_EXTRA: 'PRIVATE_PRODUCT' }));
  let records = eventsFor(99001); assert.equal(records.length, 1); assert.equal(records[0].actor, staff.actor); assert.equal(records[0].actor_type, 'staff'); assert.equal(records[0].source, 'admin'); assert(records[0].changes.some(c => c.field === 'Single price (cents)' && c.before === null && c.after === 17900));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM change_context').get().n, 0);
  await history.auditRun(DB, staff, ...product(99001, { price: 18900, stockQuantity: 25, inStock: true, preorder: { enabled: true, percentOff: 15, ships: 'early November 2026' }, PRIVATE_EXTRA: 'PRIVATE_PRODUCT' }));
  records = eventsFor(99001); assert.deepEqual(records.at(-1).changes, [{ field: 'Single price (cents)', before: 17900, after: 18900 }]);
  const unchangedCount = count(); await history.auditRun(DB, staff, 'UPDATE product_overrides SET data=data WHERE id=?', 99001); assert.equal(count(), unchangedCount, 'Identical product save is not a change');
  await history.auditRun(DB, system, "UPDATE product_overrides SET data=json_set(data,'$.stockQuantity',23) WHERE id=?", 99001);
  records = eventsFor(99001); assert.equal(records.at(-1).actor_type, 'system'); assert.equal(records.at(-1).action, 'inventory.settled');
  sqlite.prepare("UPDATE product_overrides SET data=json_set(data,'$.price',19900) WHERE id=?").run(99001);
  records = eventsFor(99001); assert.equal(records.at(-1).actor_type, 'unknown'); assert.equal(records.at(-1).actor, 'Unattributed database change', 'Raw SQL must not inherit the previous staff actor');

  sqlite.exec("CREATE TRIGGER fixture_block_history BEFORE INSERT ON change_events WHEN NEW.entity_id='99003' BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;");
  await assert.rejects(history.auditRun(DB, staff, ...product(99003, { price: 1000 })), /fixture history failure/);
  assert.equal(sqlite.prepare('SELECT id FROM product_overrides WHERE id=99003').get(), undefined); assert.equal(eventsFor(99003).length, 0); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM change_context').get().n, 0, 'Failed batch rolls back actor context');
  sqlite.exec('DROP TRIGGER fixture_block_history');
  await assert.rejects(history.auditBatch(DB, staff, [DB.prepare(product(99004, { price: 1000 })[0]).bind(99004, '{"price":1000}'), DB.prepare('INSERT INTO transaction_guards(id,valid) VALUES(?,?)').bind('fixture-invalid', 0)]));
  assert.equal(sqlite.prepare('SELECT id FROM product_overrides WHERE id=99004').get(), undefined); assert.equal(eventsFor(99004).length, 0); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM change_context').get().n, 0);

  const proxy = history.withAuditDb(DB, { ...staff, actor: 'second-owner@example.invalid' });
  await proxy.prepare(product(99005, {})[0]).bind(99005, '{"price":2500}').run();
  await proxy.batch([proxy.prepare("UPDATE product_overrides SET data=json_set(data,'$.price',2600) WHERE id=?").bind(99005), proxy.prepare("UPDATE product_overrides SET data=json_set(data,'$.stockQuantity',10) WHERE id=?").bind(99005)]);
  assert(eventsFor(99005).every(e => e.actor === 'second-owner@example.invalid')); assert.equal((await proxy.prepare('SELECT id FROM product_overrides WHERE id=?').bind(99005).first()).id, 99005);
  const returned = await proxy.prepare("UPDATE product_overrides SET data=json_set(data,'$.price',2700) WHERE id=? RETURNING id,data").bind(99005).first();
  assert.equal(returned.id, 99005); assert.equal(JSON.parse(returned.data).price, 2700); assert.equal(eventsFor(99005).at(-1).actor, 'second-owner@example.invalid');
  const column = await proxy.prepare("UPDATE product_overrides SET data=json_set(data,'$.price',2800) WHERE id=? RETURNING id").bind(99005).first('id'); assert.equal(column, 99005);
  const returnedAll = await proxy.prepare("UPDATE product_overrides SET data=json_set(data,'$.price',2900) WHERE id=? RETURNING id").bind(99005).all(); assert.equal(returnedAll.results[0].id, 99005); assert.equal(returnedAll.meta.changes, 1);
  const returnedRaw = await proxy.prepare("UPDATE product_overrides SET data=json_set(data,'$.price',3000) WHERE id=? RETURNING id").bind(99005).raw({ columnNames: true }); assert.deepEqual(returnedRaw, [['id'], [99005]]);
  assert.equal(await proxy.prepare('UPDATE product_overrides SET data=data WHERE id=-1 RETURNING id').first(), null);
  const cte = await proxy.prepare("WITH target(id) AS (VALUES(?)) UPDATE product_overrides SET data=json_set(data,'$.price',3100) WHERE id IN (SELECT id FROM target) RETURNING id").bind(99005).first(); assert.equal(cte.id, 99005);
  assert(eventsFor(99005).every(e => e.actor === 'second-owner@example.invalid'), 'Every RETURNING terminal keeps its actor');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM change_context').get().n, 0);

  await Promise.all([history.auditRun(DB, { ...staff, actor: 'first-owner@example.invalid' }, ...product(99006, { price: 100 })), history.auditRun(DB, { ...staff, actor: 'second-owner@example.invalid' }, ...product(99007, { price: 200 }))]);
  assert.equal(eventsFor(99006)[0].actor, 'first-owner@example.invalid'); assert.equal(eventsFor(99007)[0].actor, 'second-owner@example.invalid'); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM change_context').get().n, 0);

  const privateOrder = JSON.stringify({ email: 'PRIVATE_CUSTOMER_EMAIL', address: { name: 'PRIVATE_CUSTOMER_NAME', line1: 'PRIVATE_ADDRESS' }, environment: 'live', internalTest: false, promo: { code: 'BIOMOD15', savings: 1500 }, paymentReference: 'PRIVATE_PAYMENT_DATA', shipment: { status: 'pre_transit', tracking: 'PRIVATE_TRACKING', shipmentId: 'PRIVATE_SHIPMENT', labelUrl: 'PRIVATE_LABEL' } });
  await history.auditRun(DB, staff, 'INSERT INTO orders(id,owner,request_key,status,data,total,payment_ref,notification_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)', 'order-fixture', 'PRIVATE_OWNER', 'PRIVATE_REQUESTKEY', 'paid', privateOrder, 15000, 'PRIVATE_PAYMENT_REF', 'PRIVATE_NOTIFICATION', 1, 1);
  const orderCount = count();
  await history.auditRun(DB, staff, "UPDATE orders SET updated=2,data=json_set(data,'$.lastPaymentFormAt',2,'$.shipment.checkedAt',2,'$.email','PRIVATE_CHANGED_EMAIL'),payment_ref='PRIVATE_NEW_REF' WHERE id='order-fixture'");
  assert.equal(count(), orderCount, 'Routine provider refs, timestamps and customer fields do not create business changes');
  await history.auditRun(DB, staff, "UPDATE orders SET status='shipped' WHERE id='order-fixture'");
  assert.deepEqual(eventsFor('order-fixture').at(-1).changes, [{ field: 'Status', before: 'paid', after: 'shipped' }]);
  await history.auditRun(DB, staff, "UPDATE orders SET data=json_set(data,'$.promo.code','ANNA20') WHERE id='order-fixture'");
  assert.deepEqual(eventsFor('order-fixture').at(-1).changes, [{ field: 'Promo code', before: 'BIOMOD15', after: 'ANNA20' }], 'Uses the nested promo snapshot written by real checkout');
  const beforeTracking = count();
  await history.auditRun(DB, staff, "UPDATE orders SET data=json_set(data,'$.tracking','PRIVATE_CORRECTED_TRACKING') WHERE id='order-fixture'");
  assert.equal(count(), beforeTracking + 1, 'A tracking-only correction is a real admin change');
  assert(eventsFor('order-fixture').at(-1).changes.some(c => c.field === 'Other stored fields')); safe();

  await history.auditRun(DB, staff, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'store', JSON.stringify({ shippingCents: 499, packDiscounts: { 3: 10 }, presalesEnabled: true, apiKey: 'PRIVATE_SETTING_SECRET' }));
  await history.auditRun(DB, staff, 'INSERT INTO settings(key,value) VALUES(?,?)', 'private_provider_settings', 'PRIVATE_RAW_SECRET');
  await history.auditRun(DB, staff, 'INSERT INTO settings(key,value) VALUES(?,?)', 'coa_delivery_v1', JSON.stringify({ enabled: true, replyTo: 'PRIVATE_REPLY', notifyTo: 'PRIVATE_DESTINATION', apiKey: 'PRIVATE_API_KEY' }));
  const beforeHealth = count(); for (const key of ['coa_scheduler_health_v1', 'checkout_recovery_health_v1']) await history.auditRun(DB, system, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, '{"updated":100}'); assert.equal(count(), beforeHealth);
  await history.auditRun(DB, staff, 'INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', 'request-fixture', 'PRIVATE_REQUEST_OWNER', 'contact', '{"email":"PRIVATE_CONTACT_EMAIL","message":"PRIVATE_MESSAGE"}', 1);
  await history.auditRun(DB, staff, "UPDATE requests SET status='resolved' WHERE id='request-fixture'");
  assert.deepEqual(eventsFor('request-fixture').at(-1).changes, [{ field: 'Status', before: 'new', after: 'resolved' }]);
  await history.auditRun(DB, staff, 'INSERT INTO rewards(id,owner,points,reason,created) VALUES(?,?,?,?,?)', 'reward-fixture', 'PRIVATE_REWARD_OWNER', 100, 'PRIVATE_REWARD_REASON', 1);
  await history.auditRun(DB, staff, 'INSERT INTO coa_original_reports(sha256,data,enabled) VALUES(?,?,?)', 'a'.repeat(64), '{"pdf":"PRIVATE_PDF_BYTES","source":"PRIVATE_PDF_PATH"}', 1);
  await history.auditRun(DB, system, 'INSERT INTO coa_delivery_outbox(id,request_id,purpose,status,reason,recipient,body,provider_id,template_version,idempotency_key,next_attempt_at,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', 'mail-fixture', 'request-fixture', 'coa', 'queued', 'PRIVATE_REASON', 'PRIVATE_RECIPIENT', 'PRIVATE_BODY', 'PRIVATE_MAIL_PROVIDER', 'v1', 'PRIVATE_IDEMPOTENCY', 1, 1, 1);
  const claimedMail = await proxy.prepare("UPDATE coa_delivery_outbox SET status='sending',lease_token='PRIVATE_CLAIM',attempts=attempts+1 WHERE id='mail-fixture' AND status='queued' RETURNING *").first();
  assert.equal(claimedMail.id, 'mail-fixture'); assert.equal(claimedMail.status, 'sending'); assert.equal(eventsFor('mail-fixture').at(-1).actor, 'second-owner@example.invalid', 'Real outbox UPDATE RETURNING claim is attributed');
  await history.auditRun(DB, system, "UPDATE coa_delivery_outbox SET status='accepted',accepted_at=2,lease_token='PRIVATE_LEASE' WHERE id='mail-fixture'");
  await history.auditRun(DB, system, 'INSERT INTO checkout_recovery(order_id,status,reason,recipient_hash,unsubscribe_token,payload,original_snapshot,savings,next_attempt_at,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)', 'recovery-fixture', 'queued', 'PRIVATE_REASON', 'PRIVATE_HASH', 'PRIVATE_UNSUB', 'PRIVATE_RECOVERY_PAYLOAD', 'PRIVATE_ORDER_SNAPSHOT', 750, 1, 1, 1);
  const routineBefore = count();
  sqlite.prepare('INSERT INTO profiles(id,name,phone,company,research_accepted,created) VALUES(?,?,?,?,?,?)').run('PRIVATE_PROFILE', 'PRIVATE_PROFILE_NAME', 'PRIVATE_PHONE', 'PRIVATE_COMPANY', 1, 1);
  sqlite.prepare('INSERT INTO sessions(id,cart,wishlist,updated) VALUES(?,?,?,?)').run('PRIVATE_SESSION', '[]', '[]', 1);
  sqlite.prepare('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)').run('quote-fixture', 'PRIVATE_QUOTE_OWNER', 'quote', 'PRIVATE_QUOTE', 1);
  assert.equal(count(), routineBefore, 'Customer/session/quote contents are excluded'); safe();

  // Corrupt direct writes are logged without copying private blobs into nominally numeric fields.
  await history.auditRun(DB, staff, "UPDATE settings SET value=? WHERE key='store'", '{"shippingCents":{"token":"PRIVATE_NESTED_SECRET"}}'); safe();
  await history.auditRun(DB, staff, 'UPDATE product_overrides SET data=? WHERE id=?', '{"price":"PRIVATE_NONNUMERIC_SECRET"}', 99001); safe();

  // Staff access is traceable; name values remain private, only role/active values are copied.
  await history.auditRun(DB, staff, 'INSERT INTO staff(email,name,role,active,created,updated,updated_by) VALUES(?,?,?,?,?,?,?)', 'team@example.invalid', 'PRIVATE_STAFF_NAME', 'support', 1, 1, 1, staff.actor);
  await history.auditRun(DB, staff, "UPDATE staff SET role='manager',active=0,updated=2 WHERE email='team@example.invalid'");
  assert.equal(eventsFor('team@example.invalid').at(-1).changes.length, 2); safe();
  for (const [table, key, value] of [['product_overrides', 'id', 99005], ['staff', 'email', 'team@example.invalid'], ['requests', 'id', 'request-fixture']]) {
    await history.auditRun(DB, staff, `DELETE FROM ${table} WHERE ${key}=?`, value); assert.match(eventsFor(value).at(-1).action, /\.delete$/);
  }

  const protectedEvent = sqlite.prepare('SELECT * FROM change_events LIMIT 1').get();
  assert.throws(() => sqlite.prepare('UPDATE change_events SET summary=? WHERE id=?').run('tampered', protectedEvent.id), /append-only/);
  assert.throws(() => sqlite.prepare('DELETE FROM change_events WHERE id=?').run(protectedEvent.id), /append-only/);
  assert.throws(() => sqlite.prepare('INSERT OR REPLACE INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(protectedEvent.id, 0, 0, 'system', 'replacement', 'unknown', 'replace', 'test', 'test', 'tampered', 'observed', '[]'), /append-only|already|immutable|conflict/i, 'Conflicting REPLACE must not bypass immutable history');

  // Query a separate fixture to control tie ordering and complete-day boundaries.
  const queryFixture = setup(), qdb = queryFixture.DB, qs = queryFixture.sqlite;
  try {
    const start = Date.parse('2026-10-10T00:00:00Z'), end = Date.parse('2026-10-11T00:00:00Z');
    const input = (id, occurredAt, source = 'github', summary = 'Updated product pricing') => ({ id, occurredAt, source, actor: 'reviewer@example.invalid', actorType: 'staff', action: 'price.changed', entityType: 'commit', entityId: id, summary, status: 'observed', changes: [{ field: 'Price', before: 100, after: 200 }] });
    for (const event of [input('test-a', start), input('test-b', start), input('test-c', end - 1, 'admin', 'Literal 15% _offer_ \\ approved'), input('test-d', end)]) await history.recordChange(qdb, event);
    await history.recordChange(qdb, input('test-a', start)); assert.equal(qs.prepare("SELECT COUNT(*) AS n FROM change_events WHERE id='test-a'").get().n, 1);
    const params = new URLSearchParams({ from: '2026-10-10', to: '2026-10-10', limit: '2' });
    let page = await history.changeHistory(qdb, params, end); assert.equal(page.timeZone, 'UTC'); assert.deepEqual(page.events.map(e => e.id), ['test-c', 'test-b']); assert(page.nextCursor);
    params.set('before', page.nextCursor); page = await history.changeHistory(qdb, params, end); assert.deepEqual(page.events.map(e => e.id), ['test-a']); assert.equal(page.nextCursor, null);
    page = await history.changeHistory(qdb, new URLSearchParams({ source: 'github', from: '2026-10-10', to: '2026-10-10' }), end); assert.deepEqual(page.events.map(e => e.id), ['test-b', 'test-a']);
    for (const query of ['15%', '_offer_', '\\']) { page = await history.changeHistory(qdb, new URLSearchParams({ q: query }), end); assert.deepEqual(page.events.map(e => e.id), ['test-c'], 'LIKE wildcards must be escaped'); }
    page = await history.changeHistory(qdb, new URLSearchParams({ q: "' OR 1=1 --" }), end); assert.equal(page.events.length, 0);
    for (const params of [{ limit: '0' }, { limit: '101' }, { limit: '1.5' }, { from: '2026-02-30' }, { from: '2026-10-11', to: '2026-10-10' }, { before: '1:bad space' }, { before: '9007199254740992:test' }, { source: 'arbitrary' }, { q: 'x'.repeat(121) }]) await assert.rejects(history.changeHistory(qdb, new URLSearchParams(params), end));
    await assert.rejects(history.recordChange(qdb, input('invalid-date', -1)), /timestamp/);
    for (const [id, url, accepted] of [['safe-github', 'https://github.com/thetaxfirm/biomodpeptides/commit/abc', true], ['safe-cloud', 'https://dash.cloudflare.com/fixture', true], ['bad-domain', 'https://example.invalid/secret', false], ['bad-auth', 'https://user:pass@github.com/thetaxfirm/biomodpeptides/commit/abc', false], ['bad-protocol', 'javascript:alert(1)', false]]) {
      await history.recordChange(qdb, { ...input(id, end), evidenceUrl: url }); const item = (await history.changeHistory(qdb, new URLSearchParams({ q: id }), end)).events[0]; assert.equal(Boolean(item.evidenceUrl), accepted);
    }
    let coverage = (await history.changeHistory(qdb, new URLSearchParams(), end)).coverage; assert.equal(coverage.find(c => c.source === 'github').state, 'unavailable');
    await qdb.prepare('INSERT INTO change_history_sync VALUES(?,?,?,?)').bind('github', end - 3 * 3600000, 'active', 'Imported verified commits.').run();
    coverage = (await history.changeHistory(qdb, new URLSearchParams(), end)).coverage; assert.equal(coverage.find(c => c.source === 'github').state, 'partial'); assert.match(coverage.find(c => c.source === 'github').description, /over two hours/);
  } finally { qs.close(); }
  console.log('PASS: real SQLite history triggers, actor isolation, atomic rollback, immutable rows, safe projections, legacy provenance, no-op suppression, wrapper attribution, and bounded date/filter/cursor queries. All fixtures isolated.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => sqlite.close());
