// AI reply certainty gate (owner, Oct 30 2026), replaying the four rejected drafts with synthetic data:
// already answered (Autumn), cancelled follow-up (Sheldon), different email + order number (Aaron), supplier pitch (Winfred).
// Real lib/reply-gate.ts against every migration in an in-memory SQLite database. No network.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
const gate = require('../lib/reply-gate.ts');
const sql = new DatabaseSync(':memory:');
for (const name of fs.readdirSync(path.join(root, 'drizzle')).filter(n => n.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
const db = { prepare: q => { const s = (v = []) => ({ bind: (...n) => s(n), first: async () => sql.prepare(q).get(...v) || null, all: async () => ({ results: sql.prepare(q).all(...v) }) }); return s(); } };
const DAY = 86400000, now = Date.UTC(2026, 9, 30, 20);
let n = 0;
const order = (id, emailAddress, name, status, created) => { sql.prepare('INSERT INTO orders(id,owner,request_key,status,total,data,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(id, '', 'rk-' + id, status, 63631, JSON.stringify({ email: emailAddress, environment: 'authorizenet:live', address: { name }, items: [{ quantity: 2, product: { name: 'Run & Gun' } }] }), created, created); return id; };
const request = (data, created = now - 3600000) => { const id = '00000000-0000-4000-8000-' + String(++n).padStart(12, '0'); sql.prepare("INSERT INTO requests(id,kind,status,data,created) VALUES(?,'contact','new',?,?)").run(id, JSON.stringify(data), created); return { id, kind: 'contact', data: JSON.stringify(data), created, status: 'new' }; };
(async () => {
  assert.deepEqual(gate.orderReferences({ labelLot: 'ORDER-B329EB36' }), ['b329eb36']);
  assert.deepEqual(gate.orderReferences({ subject: 'Order 601ff4db', message: 'see #601FF4DB' }), ['601ff4db']);
  assert.deepEqual(gate.orderReferences({ message: 'lot 201-10-0001 and 12345678 dollars' }), [], 'Bare numbers are not order references');
  assert.equal(gate.nameKey('Aaron M Lambert'), gate.nameKey('aaron lambert'));
  assert.equal(gate.nameKey('Winfred'), '', 'One-word names never match');

  // Aaron: wrote from another address, gave the order number in the form. The order is found; nobody asks him for it.
  order('b329eb36-1111-4111-8111-111111111111', 'bearhomes@example.invalid', 'Aaron M Lambert', 'delivered', now - 6 * DAY);
  const aaron = request({ name: 'Aaron Lambert', email: 'other-address@example.invalid', subject: 'Missing some of my order', message: 'Hi i just got my order but im missing 1 run n gun and one tesamorelin.', labelLot: 'ORDER-B329EB36' });
  let r = await gate.aiDraftGate(db, aaron, now);
  assert.equal(r.stop, null);
  assert.deepEqual(r.linkedOrders.map(o => [o.number, o.matchedBy, o.status]), [['B329EB36', 'order number', r.linkedOrders[0].status]]);
  assert.deepEqual(r.linkedEmails.sort(), ['bearhomes@example.invalid', 'other-address@example.invalid']);
  // Same message without the number: an exact first+last name match still finds the order.
  r = await gate.aiDraftGate(db, request({ name: 'aaron lambert', email: 'other-address@example.invalid', subject: 'Missing items', message: 'My package was missing a vial.' }), now);
  assert.deepEqual(r.linkedOrders.map(o => o.matchedBy), ['name']);
  // ...and once anyone has replied to him (desk or recorded outside reply), no AI draft.
  const earlier = request({ name: 'Aaron M Lambert', email: 'bearhomes@example.invalid', subject: 'Shipping', message: 'Where is my order?' }, now - 5 * DAY);
  sql.prepare("INSERT INTO request_external_replies(id,request_id,source,account,body,sent_at,recorded_by,created) VALUES('x1',?,'mailbox','contact@trybiomod.com','We sent the rest.',?,'Jarvis exact conversation check',?)").run(earlier.id, now - 1800000, now);
  r = await gate.aiDraftGate(db, aaron, now);
  assert.match(r.stop, /^Already answered on /, 'A reply to any of his addresses after he wrote stops the draft');

  // Name matches across two different checkout emails are not certain: no link.
  order('aaaa0001-2222-4222-8222-222222222222', 'one@example.invalid', 'Jordan Reyes', 'delivered', now - 9 * DAY);
  order('aaaa0002-2222-4222-8222-222222222222', 'two@example.invalid', 'Jordan Reyes', 'delivered', now - 8 * DAY);
  r = await gate.aiDraftGate(db, request({ name: 'Jordan Reyes', email: 'three@example.invalid', subject: 'Order question', message: 'My order never arrived.' }), now);
  assert.equal(r.linkedOrders.length, 0);
  assert.match(r.stop, /no order matched this person/, 'Order question with no certain order: no draft');
  // A general product question with no order is fine to draft.
  assert.equal((await gate.aiDraftGate(db, request({ name: 'Sam Lee', email: 'sam@example.invalid', subject: 'Storage', message: 'How should a sealed vial be stored before use in the lab?' }), now)).stop, null);

  // Autumn: she wrote two weeks ago. However it was handled, a draft now is too late.
  order('601ff4db-3333-4333-8333-333333333333', 'autumn@example.invalid', 'Autumn Tatro', 'delivered', now - 15 * DAY);
  r = await gate.aiDraftGate(db, request({ name: 'Autumn Tatro', email: 'autumn@example.invalid', subject: 'Order 601ff4db', message: 'My order is still saying it is under review. Do I need to do anything?' }, now - 14 * DAY), now);
  assert.match(r.stop, /more than 3 days ago/);
  // A later reply in the same thread restarts the clock.
  const thread = request({ name: 'Autumn Tatro', email: 'autumn@example.invalid', subject: 'Order 601ff4db', message: 'Still under review?' }, now - 14 * DAY);
  sql.prepare("INSERT INTO request_reply_messages(id,request_id,direction,body,created,provider_message_id,sender,recipient) VALUES('m1',?,'incoming','Any update?',?,'p1','autumn@example.invalid','contact@trybiomod.com')").run(thread.id, now - 3600000);
  assert.equal((await gate.aiDraftGate(db, thread, now)).latestIncomingAt, now - 3600000);

  // Sheldon: a BioMod-started order follow-up is drafted only while the follow-up check still passes.
  const sheldon = request({ name: 'Sheldon Steinburgh', email: 'sheldon@example.invalid', subject: 'Your order', message: 'Order #310C5F61 placed.', origin: 'order', orderId: '310c5f61-4444-4444-8444-444444444444' });
  r = await gate.aiDraftGate(db, sheldon, now, async () => ({ eligible: false, reason: 'This order needs payment or fulfillment review, not a checkout reminder.' }));
  assert.match(r.stop, /^No AI follow-up: This order needs payment/);
  assert.equal((await gate.aiDraftGate(db, sheldon, now)).stop.startsWith('No AI follow-up'), true, 'No check available: no follow-up');

  // Winfred: supplier pitch.
  const pitch = '>99% Purity Peptides USA Domestic Shipped From Lab-Peptides Supplier\n99%+ Clearance Customs\nBitcoin/ USDT/ USDC/ ETH/ Bank Transfer\nhttps://www.lab-peptides.example/\nWhatsApp & Telegram: +100000000';
  assert(gate.looksLikeSolicitation('Super Big Sale >99% Purity Peptides', pitch));
  r = await gate.aiDraftGate(db, request({ name: 'Winfred', email: 'winfred@example.invalid', subject: 'Super Big Sale >99% Purity Peptides', message: pitch }), now);
  assert.match(r.stop, /supplier or sales pitch/);
  for (const [s, m] of [['Wholesale order', 'Do you offer wholesale pricing for 50 vials?'], ['Payment', 'Can I pay with bitcoin?'], ['COA', 'Is the purity on your BPC-157 report from the current lot?']])
    assert(!gate.looksLikeSolicitation(s, m), 'Customer question is not a pitch: ' + m);
  console.log('PASS: AI drafts stop when already answered (any linked email), stale, cancelled/ineligible follow-up, uncertain order or supplier pitch; orders link by email, order number (form lot box) or unique exact name.');
})().catch(e => { console.error(e); process.exitCode = 1; });
