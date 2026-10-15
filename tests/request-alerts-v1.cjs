/* Actual alert outbox and classification with isolated SQLite and a mocked mail provider. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
const { looksLikePitchText } = require('../lib/request-issues.ts');
const outbox = require('../lib/coa-outbox.ts');
const { coaHash } = require('../lib/coa-delivery.ts');
const root = path.resolve(__dirname, '..');
global.fetch = () => { throw Error('Real network forbidden in request alert tests'); };

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE requests(id TEXT PRIMARY KEY,kind TEXT,data TEXT,created INTEGER)');
  sql.exec(fs.readFileSync(path.join(root, 'drizzle/0016_coa_delivery.sql'), 'utf8'));
  const statement = (query, values = []) => ({ bind: (...args) => statement(query, args), first: async () => sql.prepare(query).get(...values) || null, all: async () => ({ results: sql.prepare(query).all(...values) }), run: async () => ({ meta: sql.prepare(query).run(...values) }) });
  let now = Date.parse('2026-10-15T12:00:00Z');
  const env = { DB: { prepare: query => statement(query) }, RESEND_API_KEY: 'isolated-fixture-not-a-secret', ORDER_EMAIL_FROM: 'Fixture <sender@example.invalid>' };
  const config = { enabled: true, replyTo: 'reply@example.invalid', notifyTo: 'team@example.invalid' };
  const seed = (data, kind = 'contact') => { const id = randomUUID(); sql.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(id, kind, JSON.stringify(data), now); return id; };
  const row = id => sql.prepare("SELECT * FROM coa_delivery_outbox WHERE request_id=? AND purpose='request-alert'").get(id);
  const calls = [];
  const send = async (id, outcome = 'ok') => outbox.processCoaOutbox(env, { requestId: id }, { now: () => now, fetch: async (url, init) => { assert.equal(url, 'https://api.resend.com/emails'); calls.push({ key: init.headers['Idempotency-Key'], payload: JSON.parse(init.body) }); if (outcome === 'unknown') throw Error('mock unknown outcome'); return new Response(JSON.stringify({ id: '20000000-0000-4000-8000-000000000001' })); } });
  return { sql, env, config, seed, row, calls, send, deps: { now: () => now }, advance: ms => { now += ms; } };
}

(async () => {
  const customerQuestions = [
    ['Manufactured', 'Are the peptides manufactured in the United States?'],
    ['Purity', 'Do you have a high purity report and which factory makes these?'],
    ['Wholesale', 'Do you offer wholesale pricing? Can you send your price list and MOQ?'],
    ['Bulk order', 'We would like to buy 100 vials. What is your bulk price?'],
    ['Supplier', 'I am looking for a supplier. Are your peptides made in the USA?'],
    ['Private label', 'Does your company offer OEM or private label? We are interested in buying.'],
    ['COA request: synthetic lot', 'Please send the manufacturer COA for my purchase.'],
    ['Catalog', 'Can I review your product catalog?'],
    ['Business purchase', 'We are a supplier and we are looking to buy peptides from you.'],
    ['Factory question', 'Do you manufacture the product yourselves or use a supplier?'],
  ];
  for (const [subject, message] of customerQuestions) assert.equal(looksLikePitchText(subject, message), false, subject + ' stays a customer question');
  const supplierPitches = [
    ['Peptide supply', 'We are a leading manufacturer with competitive price.'],
    ['Research peptides', 'We are a peptide manufacturer supplying research organizations.'],
    ['Supply', 'We can provide high quality peptides and OEM services.'],
    ['Catalog', 'Would you be interested in receiving our latest catalog and wholesale pricing?'],
    ['Raw materials', 'Peptides unlyophilized raws supply! Would you like to review our price list first?'],
    ['Cooperation', 'Our factory can supply research peptides.'],
  ];
  for (const [subject, message] of supplierPitches) assert.equal(looksLikePitchText(subject, message), true, subject + ' is suggested as a supplier pitch');

  const f = fixture();
  try {
    await outbox.saveCoaConfig(f.env, f.config);
    const id = f.seed({ name: 'Fixture Customer', subject: 'Manufactured', email: 'customer@example.invalid', message: 'Are the peptides manufactured in the United States? PRIVATE_MESSAGE_ONLY' });
    await outbox.enqueueRequestAlert(f.env, id, f.deps);
    const before = f.row(id);
    assert.equal(before.template_version, 'request-alert-v2');
    assert.equal(before.subject, 'New BIOMOD contact request: Fixture Customer');
    assert.match(before.body, /Name: Fixture Customer\nSubject: Manufactured\nCategory: Customer request/);
    assert(before.body.includes('Reference: ' + id));
    const url = new URL(before.body.split('\n').find(line => line.startsWith('https://')));
    assert.equal(url.origin, 'https://trybiomod.com'); assert.equal(url.pathname, '/admin'); assert.equal(url.searchParams.get('tab'), 'requests'); assert.equal(url.searchParams.get('request'), id);
    assert(!before.body.includes('PRIVATE_MESSAGE_ONLY')); assert(!before.body.includes('customer@example.invalid'));
    assert.equal((await f.send(id, 'unknown')).accepted, 0);
    // Later settings and source edits must not rewrite a queued/uncertain alert.
    await outbox.saveCoaConfig(f.env, { ...f.config, replyTo: 'changed@example.invalid', notifyTo: 'changed-team@example.invalid' });
    f.env.ORDER_EMAIL_FROM = 'Changed <changed-sender@example.invalid>';
    f.sql.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify({ name: 'Changed name', subject: 'Changed subject' }), id);
    await outbox.enqueueRequestAlert(f.env, id, f.deps);
    assert.equal(f.row(id).body, before.body); assert.equal(f.row(id).idempotency_key, before.idempotency_key);
    f.advance(300000); assert.equal((await f.send(id)).accepted, 1);
    assert.deepEqual(f.calls[0], f.calls[1]);
    assert.equal(f.calls[1].payload.from, before.sender); assert.equal(f.calls[1].payload.reply_to, f.config.replyTo); assert.deepEqual(f.calls[1].payload.to, [f.config.notifyTo]);
    await f.send(id); assert.equal(f.calls.length, 2, 'Accepted alert cannot be resent');

    const supplier = f.seed({ name: 'Fixture supplier', subject: 'Catalog', message: 'Would you like to review our price list?' });
    await outbox.enqueueRequestAlert(f.env, supplier, f.deps);
    assert.match(f.row(supplier).body, /Category: Likely supplier pitch \(automatic suggestion; review required\)/);
    const affiliate = f.seed({ message: 'Friends and family' }, 'affiliate');
    await outbox.enqueueRequestAlert(f.env, affiliate, f.deps);
    assert.match(f.row(affiliate).body, /Name: Name not provided\nSubject: Partner application\nCategory: Partner application/);

    const hostile = f.seed({ name: '<b>Fixture</b>\r\nBcc: nowhere@example.invalid\u0000\u202e' + 'x'.repeat(500), subject: '<script>x</script>\r\nX-Injected: yes\u2028' + 's'.repeat(500), message: 'PRIVATE_BODY_SHOULD_NOT_LEAVE_REQUEST' });
    await outbox.enqueueRequestAlert(f.env, hostile, f.deps);
    const sanitized = f.row(hostile);
    assert(sanitized.subject.length <= 110); assert(!/[\r\n\u0000\u2028\u202e<>]/.test(sanitized.subject));
    const nameLine = sanitized.body.split('\n').find(line => line.startsWith('Name: '));
    const subjectLine = sanitized.body.split('\n').find(line => line.startsWith('Subject: '));
    assert(nameLine.length <= 86); assert(subjectLine.length <= 159);
    assert(!sanitized.body.includes('PRIVATE_BODY_SHOULD_NOT_LEAVE_REQUEST')); assert(!sanitized.body.includes('<script>'));
    assert.equal((await f.send(hostile)).accepted, 1);
    assert.equal(f.calls.at(-1).payload.html, undefined, 'Untrusted metadata remains plain text');
    assert.equal(f.calls.at(-1).payload.attachments, undefined);
    assert.deepEqual(f.calls.at(-1).payload.to, ['changed-team@example.invalid'], 'Input cannot select recipients');

    // Existing v1 snapshots remain deliverable with their original body/version/key.
    const legacy = f.seed({ name: 'Legacy fixture', message: 'PRIVATE_LEGACY_BODY' });
    await outbox.enqueueRequestAlert(f.env, legacy, f.deps);
    const legacyBody = 'A new contact request is waiting in store administration.\n\nhttps://trybiomod.com/admin?tab=requests\n\nBIOMOD';
    f.sql.prepare("UPDATE coa_delivery_outbox SET template_version='request-alert-v1',subject='New BIOMOD contact request',body=? WHERE request_id=?").run(legacyBody, legacy);
    const old = f.row(legacy);
    const hash = await coaHash(JSON.stringify([old.recipient, old.sender, old.reply_to, old.subject, old.body, old.document_hash, old.attachment_name, old.template_version, old.idempotency_key, old.purpose]));
    f.sql.prepare('UPDATE coa_delivery_outbox SET payload_hash=? WHERE request_id=?').run(hash, legacy);
    assert.equal((await f.send(legacy)).accepted, 1);
    assert.equal(f.calls.at(-1).payload.text, legacyBody); assert.equal(f.calls.at(-1).key, old.idempotency_key); assert.equal(f.row(legacy).template_version, 'request-alert-v1');
  } finally { f.sql.close(); }
  console.log('PASS: customer manufacturing/wholesale questions stay visible; supplier suggestions are conservative; informative alert metadata and exact links are bounded; v1/v2 snapshots, recipients and retry keys remain immutable. Isolated SQLite and mocked mail only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
