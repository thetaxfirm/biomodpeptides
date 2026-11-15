/* Guest checkout: session-bound guest records, the research statement, order transfer at sign-in and
 * enrolment after a paid order. In-memory database; no network, credentials or production data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const g = require('../lib/guest-checkout.ts');

const sql = new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE requests(id TEXT PRIMARY KEY,owner TEXT,kind TEXT NOT NULL,data TEXT NOT NULL,status TEXT DEFAULT 'new',created INTEGER NOT NULL);
  CREATE TABLE orders(id TEXT PRIMARY KEY,owner TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,total INTEGER NOT NULL,created INTEGER NOT NULL);
  CREATE UNIQUE INDEX orders_owner_active ON orders(owner) WHERE status IN ('creating','awaiting_payment','pending','review');`);
class Statement {
  constructor(q, v = []) { this.q = q; this.v = v; }
  bind(...v) { return new Statement(this.q, v); }
  async first() { return sql.prepare(this.q).get(...this.v) || null; }
  async all() { return { results: sql.prepare(this.q).all(...this.v) }; }
  async run() { const r = sql.prepare(this.q).run(...this.v); return { meta: { changes: r.changes } }; }
}
const db = { prepare: q => new Statement(q) };
const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222';
const NOW = 2000000000000;

(async () => {
  // No guest exists until the buyer gives an email and agrees to the statement.
  assert.equal(await g.readGuest(db, S1), null);
  assert.equal(await g.readGuest(db, 'not-a-session'), null);
  await assert.rejects(g.saveGuest(db, S1, { email: 'ada@example.com', attested: false }, NOW, 'r1'), /research statement/);
  await assert.rejects(g.saveGuest(db, S1, { email: 'not an email', attested: true }, NOW, 'r1'), /valid email/);
  await assert.rejects(g.saveGuest(db, 'x', { email: 'ada@example.com', attested: true }, NOW, 'r1'), /Refresh/);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM requests').get().n, 0, 'nothing saved for a refused guest');

  const guest = await g.saveGuest(db, S1, { email: ' Ada@Example.com ', attested: true, smsConsent: true }, NOW, 'r1');
  assert.deepEqual(guest, { id: 'guest:' + S1, email: 'ada@example.com', name: '', guest: true });
  assert.deepEqual(await g.readGuest(db, S1), guest);
  assert.equal(await g.readGuest(db, S2), null, 'another browser session is not this guest');
  const record = await g.readGuestRecord(db, S1);
  assert.equal(record.attestation.version, g.ATTESTATION_VERSION);
  assert.equal(record.attestation.at, NOW);
  assert.deepEqual(record.smsConsent, { at: NOW, text: g.SMS_CONSENT_TEXT });
  // Saving again replaces the record instead of adding a second one. Text consent is opt-in each time.
  await g.saveGuest(db, S1, { email: 'ada2@example.com', attested: true }, NOW + 1, 'r2');
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM requests WHERE kind='guest_shopper'").get().n, 1);
  assert.equal((await g.readGuestRecord(db, S1)).smsConsent, null);
  assert.equal((await g.readGuest(db, S1)).email, 'ada2@example.com');
  // A record under an older statement no longer counts: the buyer must agree to the current one.
  sql.prepare("UPDATE requests SET data=json_set(data,'$.attestation.version','old-v0')").run();
  assert.equal(await g.readGuest(db, S1), null);
  await g.saveGuest(db, S1, { email: 'ada@example.com', attested: true, smsConsent: true }, NOW, 'r3');

  // What each guest order keeps: the exact statement, when it was agreed, and any text consent.
  const kept = g.guestOrderRecord(await g.readGuestRecord(db, S1));
  assert.equal(kept.guest, true);
  assert.equal(kept.attestation.text, g.ATTESTATION_TEXT);
  assert.equal(kept.attestation.at, NOW);
  assert.equal(kept.smsConsent.text, g.SMS_CONSENT_TEXT);
  assert.deepEqual(g.guestOrderRecord(null), {});
  for (const phrase of ['research professional', '21 or older', 'laboratory research use only', 'not for human or animal use']) assert(g.ATTESTATION_TEXT.includes(phrase), 'statement says: ' + phrase);
  assert(!/peptide|dos(e|ing)\b|inject/i.test(g.ATTESTATION_TEXT + g.SMS_CONSENT_TEXT), 'no peptide, dosing or handling wording');
  assert(/STOP/.test(g.SMS_CONSENT_TEXT) && /rates may apply/i.test(g.SMS_CONSENT_TEXT), 'text consent names opt-out and rates');

  // Owner format.
  assert(g.isGuestOwner('guest:' + S1));
  for (const bad of ['guest:', 'guest:abc', S1, 'customer:' + S1, null, 'guest:' + S1 + "' OR 1=1"]) assert(!g.isGuestOwner(bad), String(bad));

  // Sign-in moves only this verified email's guest orders, and never breaks the one-unpaid-order rule.
  const order = (id, owner, status, email) => sql.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(id, owner, status, JSON.stringify({ email }), 5000, NOW);
  order('o1', 'guest:' + S1, 'paid', 'Ada@Example.com');
  order('o2', 'guest:' + S1, 'awaiting_payment', 'ada@example.com');
  order('o3', 'guest:' + S2, 'paid', 'someone-else@example.com');
  order('o4', 'member-9', 'paid', 'ada@example.com');
  order('o5', 'user-1', 'awaiting_payment', 'ada@example.com');
  assert.equal(await g.transferGuestOrders(db, 'user-1', 'ADA@example.com'), 1, 'paid order moves; the unpaid one clashes with the account’s own unpaid checkout');
  const ownerOf = id => sql.prepare('SELECT owner FROM orders WHERE id=?').get(id).owner;
  assert.equal(ownerOf('o1'), 'user-1');
  assert.equal(ownerOf('o2'), 'guest:' + S1, 'clashing unpaid order stays with the guest session');
  assert.equal(ownerOf('o3'), 'guest:' + S2, 'another email is untouched');
  assert.equal(ownerOf('o4'), 'member-9', 'member orders are never moved');
  assert.equal(await g.transferGuestOrders(db, 'user-1', ''), 0);
  assert.equal(await g.transferGuestOrders(db, 'guest:' + S2, 'ada@example.com'), 0, 'never transfers to a guest');
  assert.equal(await g.transferGuestOrders(db, 'user-2', "x' OR '1'='1"), 0);

  // Enrolment: once per guest, only for the guest's own email, and it never throws.
  const calls = [];
  const signup = async (route, body) => { calls.push({ route, body }); return {}; };
  const paid = { email: 'ada@example.com', address: { name: 'Ada Lovelace', phone: '(702) 555-0100' } };
  assert.equal(await g.enrollGuest(db, 'member-9', paid, 'https://trybiomod.com', signup, NOW, 'pw'), false, 'members are not enrolled again');
  assert.equal(await g.enrollGuest(db, 'guest:' + S1, { ...paid, email: 'other@example.com' }, 'https://trybiomod.com', signup, NOW, 'pw'), false, 'order email must be the guest email');
  assert.equal(calls.length, 0);
  assert.equal(await g.enrollGuest(db, 'guest:' + S1, paid, 'https://trybiomod.com', signup, NOW, 'pw'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, 'signup?redirect_to=' + encodeURIComponent('https://trybiomod.com/login'));
  assert.deepEqual(calls[0].body, { email: 'ada@example.com', password: 'pw', data: { name: 'Ada Lovelace', phone: '(702) 555-0100', business_type: 'researcher', guest_checkout: true } });
  assert.equal(await g.enrollGuest(db, 'guest:' + S1, paid, 'https://trybiomod.com', signup, NOW + 5, 'pw'), false, 'a second payment notice does not email again');
  assert.equal(calls.length, 1);
  assert.equal((await g.readGuest(db, S1)).email, 'ada@example.com', 'the guest can still check out after enrolment');
  await g.saveGuest(db, S2, { email: 'grace@example.com', attested: true }, NOW, 'r9');
  assert.equal(await g.enrollGuest(db, 'guest:' + S2, { email: 'grace@example.com' }, 'https://trybiomod.com', async () => { throw new Error('provider down'); }, NOW, 'pw'), false, 'a provider failure is swallowed');

  // Wiring: the routes guests may use, and the ones they may not.
  const route = fs.readFileSync(path.join(__dirname, '../app/api/store/[action]/route.ts'), 'utf8');
  const block = name => { const start = route.indexOf("if (action === '" + name + "')"); assert(start > 0, name); return route.slice(start, route.indexOf("if (action === '", start + 20)); };
  for (const name of ['delivery', 'checkout', 'resume', 'reconcile']) assert(block(name).includes('requireShopper(s.id)'), name + ' accepts a guest');
  for (const name of ['notify', 'profile', 'address', 'cart-choice']) assert(block(name).includes('requireCustomer()') && !block(name).includes('requireShopper'), name + ' stays members-only');
  assert(block('checkout').includes('presaleId') && block('checkout').includes('guestOrderRecord'), 'guest orders keep the statement; presales need an account');
  assert(block('guest-start').includes('saveGuest(') && block('guest-start').includes('await customer()'), 'guest start saves through the validated path');
  assert(block('auth-login').includes('email_confirmed_at') && block('auth-login').includes('transferGuestOrders('), 'transfer only for a verified email');
  assert(block('pay').includes('readGuest(') && block('pay').includes('payer.id'), 'payment page is bound to the member or the guest session');
  const checkout = fs.readFileSync(path.join(__dirname, '../lib/checkout.ts'), 'utf8');
  assert(checkout.includes('enrollGuest(database(), owner, saved'), 'enrolment runs when an order is first marked paid');
  const ui = fs.readFileSync(path.join(__dirname, '../components/store/account.tsx'), 'utf8');
  assert(ui.includes('<GuestStart onDone={refresh}/>') && ui.includes('{ATTESTATION_TEXT}') && ui.includes('disabled={busy || !attested || !email}'), 'guest form shows the statement and requires it');
  assert(!ui.includes('if (!store.customer) return <AuthPage returnTo="/checkout"/>'), 'checkout no longer forces sign-in');
  assert.equal(g.SMS_UPDATES_READY, false); assert(ui.includes('{SMS_UPDATES_READY && <Check'), 'text opt-in is hidden until texts can be sent');
  console.log('PASS: guest records are session-bound and need the current research statement; orders keep the statement and text consent; sign-in transfers only a verified email’s guest orders; enrolment is once, guarded and never throws; members-only routes stay members-only');
})().catch(error => { console.error(error); process.exit(1); });
