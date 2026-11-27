/* Checkout contact step: a guest's email and mobile number are saved on the first screen and the
 * number carries forward. Covers number checks, the two permissions and their stored wording, the
 * pop-up email that pre-fills checkout, the sale-email list rule that never re-subscribes an
 * unsubscribed address, the staff list, and the wiring of the form, API, state, admin export and
 * privacy policy. In-memory database; no network, email, text or production data. Addresses use the
 * reserved example.com domain and numbers the reserved 555-01xx range. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const c = require('../lib/checkout-contact.ts');
const w = require('../lib/checkout-contact-wording.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const sql = new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE requests(id TEXT PRIMARY KEY,owner TEXT,kind TEXT NOT NULL,data TEXT NOT NULL,status TEXT DEFAULT 'new',created INTEGER NOT NULL);
  CREATE TABLE orders(id TEXT PRIMARY KEY,owner TEXT,status TEXT NOT NULL,data TEXT NOT NULL);`);
sql.exec(read('drizzle/0039_email_signups.sql').replaceAll('--> statement-breakpoint', ''));
class Statement {
  constructor(q, v = []) { this.q = q; this.v = v; }
  bind(...v) { return new Statement(this.q, v); }
  async first() { return sql.prepare(this.q).get(...this.v) || null; }
  async all() { return { results: sql.prepare(this.q).all(...this.v) }; }
  async run() { const r = sql.prepare(this.q).run(...this.v); return { meta: { changes: r.changes } }; }
}
const db = { prepare: q => new Statement(q) };
const NOW = 2000000000000;
const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222', S3 = '33333333-3333-4333-8333-333333333333', S4 = '44444444-4444-4444-8444-444444444444';
const token = n => String(n).repeat(8) + '-' + String(n).repeat(4) + '-4' + String(n).repeat(3) + '-8' + String(n).repeat(3) + '-' + String(n).repeat(12);
const record = session => JSON.parse(sql.prepare("SELECT data FROM requests WHERE owner=? AND kind='checkout_contact'").get('guest:' + session).data);
const count = () => sql.prepare("SELECT COUNT(*) n FROM requests WHERE kind='checkout_contact'").get().n;
const signup = email => sql.prepare('SELECT * FROM email_signups WHERE email=?').get(email);

(async () => {
  // Numbers: ten U.S. digits, a leading 1 dropped, shown and carried as (702) 555-0101.
  assert.equal(w.usPhoneDigits('(702) 555-0101'), '7025550101');
  assert.equal(w.usPhoneDigits('+1 702.555.0102'), '7025550102');
  assert.equal(w.formatUsPhone('1-702-555-0103'), '(702) 555-0103');
  for (const bad of ['', '555-0101', '123-456-7890', '702-155-0101', '+44 20 7946 0000', '70255501011', null]) assert.equal(w.usPhoneDigits(bad), '', String(bad));
  assert.equal(w.formatUsPhone('nope'), '');

  // Nothing is saved without a valid session, email and number.
  await assert.rejects(c.saveCheckoutContact(db, 'not-a-session', { email: 'a@example.com', phone: '7025550101' }, NOW, 'r0'), /Refresh the page/);
  await assert.rejects(c.saveCheckoutContact(db, S1, { email: 'nope', phone: '7025550101' }, NOW, 'r0'), /valid email/);
  await assert.rejects(c.saveCheckoutContact(db, S1, { email: 'a@example.com', phone: '555-0101' }, NOW, 'r0'), /10-digit/);
  assert.equal(count(), 0);
  assert.equal(await c.readCheckoutContact(db, S1), null);
  assert.equal(await c.readCheckoutContact(db, 'not-a-session'), null);

  // First screen: email and number saved, both boxes as the buyer left them, with the exact wording.
  const saved = await c.saveCheckoutContact(db, S1, { email: ' Lab@Example.com ', phone: '(702) 555-0101', emailOptIn: true, textConsent: true }, NOW, 'r1');
  assert.deepEqual(saved, { email: 'lab@example.com', phone: '(702) 555-0101', complete: true, emailOptIn: true, textConsent: true });
  let r = record(S1);
  assert.equal(r.phone, '7025550101');
  assert.deepEqual(r.emailOptIn, { at: NOW, version: w.CHECKOUT_EMAIL_OPTIN_VERSION, text: w.CHECKOUT_EMAIL_OPTIN_TEXT });
  assert.deepEqual(r.textConsent, { at: NOW, version: w.CHECKOUT_TEXT_CONSENT_VERSION, text: w.CHECKOUT_TEXT_CONSENT_TEXT });
  assert.equal(r.first, NOW); assert.equal(r.source, 'checkout');
  assert.deepEqual(await c.readCheckoutContact(db, S1), saved);
  // The text wording carries the required disclosures and promises nothing about price.
  for (const part of ['automated marketing texts', 'not a condition of purchase', 'Message and data rates may apply', 'Reply STOP', 'HELP']) assert(w.CHECKOUT_TEXT_CONSENT_TEXT.includes(part), part);

  // Saving again keeps one record, the first date, and a permission's original time for the same number.
  await c.saveCheckoutContact(db, S1, { email: 'lab@example.com', phone: '702-555-0101', emailOptIn: true, textConsent: true }, NOW + 50, 'r1b');
  r = record(S1);
  assert.equal(count(), 1); assert.equal(r.first, NOW); assert.equal(r.updated, NOW + 50);
  assert.equal(r.textConsent.at, NOW); assert.equal(r.emailOptIn.at, NOW);
  // A new number is a new permission; an unticked box is no permission. Only `true` counts as a tick.
  await c.saveCheckoutContact(db, S1, { email: 'lab@example.com', phone: '702-555-0109', emailOptIn: true, textConsent: true }, NOW + 60, 'r1c');
  assert.equal(record(S1).textConsent.at, NOW + 60);
  for (const notTicked of [false, undefined, 'true', 1]) {
    const again = await c.saveCheckoutContact(db, S1, { email: 'lab@example.com', phone: '702-555-0109', emailOptIn: notTicked, textConsent: notTicked }, NOW + 70, 'r1d');
    assert.equal(again.textConsent, false); assert.equal(again.emailOptIn, false);
    assert.equal(record(S1).textConsent, null); assert.equal(record(S1).emailOptIn, null);
  }

  // An email given in the leaving pop-up waits for checkout: email only, not complete, and it never
  // replaces a contact that already has a number.
  await c.rememberPopupEmail(db, S2, 'Popup@Example.com', NOW + 100, 'r2');
  assert.deepEqual(await c.readCheckoutContact(db, S2), { email: 'popup@example.com', phone: '', complete: false, emailOptIn: false, textConsent: false });
  assert.equal(record(S2).source, 'popup');
  await c.rememberPopupEmail(db, S2, 'second@example.com', NOW + 110, 'r2b');
  assert.equal((await c.readCheckoutContact(db, S2)).email, 'second@example.com');
  await c.rememberPopupEmail(db, S1, 'other@example.com', NOW + 120, 'r2c');
  assert.equal((await c.readCheckoutContact(db, S1)).email, 'lab@example.com', 'a checkout contact is not overwritten by the pop-up');
  await c.rememberPopupEmail(db, 'not-a-session', 'x@example.com', NOW, 'r2d');
  await c.rememberPopupEmail(db, S3, 'nope', NOW, 'r2e');
  assert.equal(count(), 2);
  // Checkout completes the pop-up record, keeping the first date.
  await c.saveCheckoutContact(db, S2, { email: 'second@example.com', phone: '7025550102', emailOptIn: true, textConsent: false }, NOW + 200, 'r2f');
  r = record(S2);
  assert.equal(r.first, NOW + 100); assert.equal(r.source, 'checkout'); assert.equal(r.textConsent, null); assert.equal(count(), 2);

  // Sale emails: a ticked box adds the address once. An address already on the list keeps its own
  // record, and one that unsubscribed stays unsubscribed (the box starts ticked, so it is no fresh request).
  assert.equal(await c.subscribeFromCheckout(db, 'Second@Example.com', NOW + 200, token(1)), true);
  let row = signup('second@example.com');
  assert.equal(row.source_path, '/checkout'); assert.equal(row.consent_version, w.CHECKOUT_EMAIL_OPTIN_VERSION); assert.equal(row.consent_text, w.CHECKOUT_EMAIL_OPTIN_TEXT);
  assert.equal(row.unsubscribe_token, token(1)); assert.equal(row.unsubscribed_at, null);
  assert.equal(await c.subscribeFromCheckout(db, 'second@example.com', NOW + 300, token(2)), false);
  assert.equal(signup('second@example.com').unsubscribe_token, token(1));
  sql.prepare('UPDATE email_signups SET unsubscribed_at=? WHERE email=?').run(NOW + 400, 'second@example.com');
  assert.equal(await c.subscribeFromCheckout(db, 'second@example.com', NOW + 500, token(3)), false);
  assert.equal(signup('second@example.com').unsubscribed_at, NOW + 400, 'an unsubscribed address is never re-subscribed at checkout');
  assert.equal(await c.subscribeFromCheckout(db, 'nope', NOW, token(4)), false);
  assert.equal(await c.subscribeFromCheckout(db, 'ok@example.com', NOW, 'bad-token'), false);

  // Staff list: only contacts with a number, newest first, one row per email, with what can be sent
  // and how far the order got.
  await c.saveCheckoutContact(db, S3, { email: 'third@example.com', phone: '7025550103', emailOptIn: true, textConsent: true }, NOW + 600, 'r3');
  await c.subscribeFromCheckout(db, 'third@example.com', NOW + 600, token(5));
  await c.rememberPopupEmail(db, S4, 'onlypopup@example.com', NOW + 700, 'r4');
  sql.prepare('INSERT INTO orders(id,owner,status,data) VALUES(?,?,?,?)').run('o1', 'guest:' + S3, 'awaiting_payment', JSON.stringify({ email: 'Third@Example.com' }));
  sql.prepare('INSERT INTO orders(id,owner,status,data) VALUES(?,?,?,?)').run('o2', 'guest:' + S1, 'paid', JSON.stringify({ email: 'lab@example.com' }));
  sql.prepare('INSERT INTO orders(id,owner,status,data) VALUES(?,?,?,?)').run('o3', 'guest:' + S1, 'awaiting_payment', JSON.stringify({ email: 'lab@example.com' }));
  sql.prepare('INSERT INTO orders(id,owner,status,data) VALUES(?,?,?,?)').run('o4', 'guest:' + S2, 'paid', JSON.stringify({ email: 'second@example.com', internalTest: true }));
  const list = await c.checkoutContacts(db);
  assert.deepEqual(list.map(x => x.email), ['third@example.com', 'second@example.com', 'lab@example.com']);
  assert.deepEqual(list[0], { email: 'third@example.com', phone: '(702) 555-0103', started: NOW + 600, saleEmails: true, textPermission: true, order: 'started' });
  assert.deepEqual(list[1], { email: 'second@example.com', phone: '(702) 555-0102', started: NOW + 100, saleEmails: false, textPermission: false, order: 'none' });
  assert.deepEqual(list[2], { email: 'lab@example.com', phone: '(702) 555-0109', started: NOW, saleEmails: false, textPermission: false, order: 'paid' });
  // The same email from a second browser appears once, as its newest record.
  sql.prepare('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)').run('r5', 'guest:55555555-5555-4555-8555-555555555555', 'checkout_contact', JSON.stringify({ email: 'lab@example.com', phone: '7025550110', emailOptIn: null, textConsent: null, first: NOW + 900, updated: NOW + 900, source: 'checkout' }), NOW + 900);
  const again = await c.checkoutContacts(db);
  assert.equal(again.filter(x => x.email === 'lab@example.com').length, 1);
  assert.equal(again[0].phone, '(702) 555-0110');

  // Wiring. The form: contact first for guests, the number carried into the address, sale emails
  // ticked and texts unticked to start, and the guest record still saved before the first quote.
  const form = read('components/store/checkout-contact.tsx'), page = read('components/store/account.tsx');
  assert(form.includes("api('checkout-contact', { email, phone, emailOptIn, textConsent })"), 'the first screen saves email, number and both boxes');
  assert(form.includes('useState(contact ? contact.emailOptIn : true)') && form.includes('useState(contact ? contact.textConsent : false)'), 'sale emails start ticked, texts start unticked');
  assert(form.includes('name="guestEmail"') && form.includes('name="guestPhone"') && form.includes('autoComplete="email"') && form.includes('autoComplete="tel"'));
  assert(form.includes('{CHECKOUT_TEXT_CONSENT_NOTE}') && form.includes('{CHECKOUT_EMAIL_OPTIN_TEXT}'), 'the buyer sees the wording that is stored');
  const column = page.slice(page.indexOf('<CheckoutColumn>'), page.indexOf('</CheckoutColumn>'));
  assert(column.indexOf('<CheckoutContact ') > 0 && column.indexOf('<CheckoutContact ') < column.indexOf('<form '), 'contact comes before the address');
  assert(column.includes('{(!guestCheckout || contact) && <form '), 'a guest sees the address only after the contact is saved');
  assert(column.includes('<input type="hidden" name="guestEmail" value={contact.email}/>') && column.includes('carriedPhone={guestCheckout ? contact?.phone : undefined}'), 'email and number carry forward');
  assert(page.includes('<input type="hidden" name="phone" value={carriedPhone}/>') && page.includes('carriedPhone === undefined ? <Field label="Phone" name="phone"'), 'members keep the phone box; a guest is not asked twice');
  assert(page.includes("await api('guest-start', { email: guestEmail, businessType: guestBusinessType, attested: accepted })"));
  // The API: guests only, rate limited, needs a cart, and a failure of the list or contact book never stops checkout.
  const api = read('lib/store-api/checkout-write.ts');
  const handler = api.slice(api.indexOf("action === 'checkout-contact'"), api.indexOf("action === 'guest-start'"));
  assert(handler.includes('if (await customer()) return') && handler.includes("rateLimit('checkout-contact:'") && handler.includes("throw new Error('Your cart is empty.')"));
  assert(handler.includes('saveCheckoutContact(') && handler.includes('if (contact.emailOptIn) await subscribeFromCheckout(') && handler.includes("captureContact({ email: contact.email, owner: null, phone: contact.phone, source: 'order' })"));
  assert(!/sendText|twilio|resend|fetch\(/i.test(handler + read('lib/checkout-contact.ts')), 'saving a contact sends nothing');
  assert(read('lib/store-api/state-read.ts').includes('contact: u ? null : await readCheckoutContact(database(), s.id)'), 'only a visitor who is not signed in gets the saved contact back');
  // Staff can see and download the list; the privacy policy says what is kept.
  const admin = read('app/api/admin/contacts/route.ts'), desk = read('components/store/contacts-admin.tsx');
  assert(admin.indexOf("requireStaff('reports:read')") < admin.indexOf('checkout-csv') && admin.includes('checkoutContacts: checkout'));
  assert(desk.includes('<h3>Checkout contacts</h3>') && desk.includes('/api/admin/contacts?format=checkout-csv'));
  assert(read('components/store/content.tsx').includes('At guest checkout, the email address and mobile number you enter on the first screen are saved when you press Continue'));
  assert(!/peptide/i.test([w.CHECKOUT_EMAIL_OPTIN_TEXT, w.CHECKOUT_TEXT_CONSENT_TEXT, w.CHECKOUT_PHONE_HELP, form.replace(/\/\/.*$/gm, '')].join(' ')), 'no peptide wording');

  // The staff screen itself: the real Contacts component, given a loaded report, shows the checkout
  // list with numbers, both permissions, how far each order got, the count and the download link.
  const Module = require('node:module'), React = require('react');
  const fixture = { contacts: [], shared: false, total: 0, withPhone: 0, textSignups: [], emailSignups: [],
    checkoutContacts: [
      { email: 'third@example.com', phone: '(702) 555-0103', started: NOW + 600, saleEmails: true, textPermission: true, order: 'started' },
      { email: 'second@example.com', phone: '(702) 555-0102', started: NOW + 100, saleEmails: false, textPermission: false, order: 'none' },
      { email: 'lab@example.com', phone: '(702) 555-0109', started: NOW, saleEmails: false, textPermission: false, order: 'paid' }] };
  // Hooks as plain slots, so the component's own effect loads the report through its real fetch call.
  const slots = [], effects = []; let cursor = 0;
  const hooks = { ...React, useMemo: fn => fn(), useEffect: fn => { effects.push(fn); },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; } };
  const file = path.join(__dirname, '../components/store/contacts-admin.tsx'), mod = new Module(file, module);
  mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod.require = id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? require('react/jsx-runtime')
    : id.endsWith('.module.css') ? new Proxy({}, { get: (_, key) => String(key) })
    : id.startsWith('@/lib/') ? require(path.join(__dirname, '..', id.slice(2) + '.ts'))
    : id.startsWith('./') ? new Proxy({}, { get: () => () => null }) /* sibling staff components have their own tests */
    : (() => { throw Error('Unexpected require ' + id); })();
  mod._compile(ts.transpileModule(read('components/store/contacts-admin.tsx'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
  const nodes = (tree, out = []) => { if (Array.isArray(tree)) tree.forEach(x => nodes(x, out)); else if (tree && typeof tree === 'object' && tree.props) { out.push(tree); nodes(tree.props.children, out); } return out; };
  const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree !== 'object' ? String(tree) : text(tree.props?.children);
  const render = () => { cursor = 0; effects.length = 0; return mod.exports.ContactsAdmin(); };
  const realFetch = global.fetch;
  global.fetch = async url => { assert.equal(url, '/api/admin/contacts', 'only the staff report is requested'); return { ok: true, json: async () => fixture }; };
  render(); [...effects].forEach(fn => fn()); await new Promise(resolve => setTimeout(resolve, 0));
  global.fetch = realFetch;
  const screen = render(), words = text(screen).replace(/\s+/g, ' ');
  assert(words.includes('Checkout contacts') && words.includes('3 so far') && words.includes('1 with text permission'), 'the checkout list and its counts are shown');
  for (const cell of ['third@example.com', '(702) 555-0103', 'Order started', 'second@example.com', 'No order yet', 'lab@example.com', '(702) 555-0109', 'Paid order']) assert(words.includes(cell), cell);
  const links = nodes(screen).filter(n => n.type === 'a').map(n => n.props.href);
  assert(links.includes('/api/admin/contacts?format=checkout-csv') && links.includes('tel:7025550103') && links.includes('mailto:third@example.com'), 'download, call and email links');
  console.log('PASS: checkout contact numbers, save and update, both permissions with stored wording, pop-up email carry-over, sale-email list rule, staff list and the real staff screen, and form/API/state/admin/privacy wiring');
})().catch(err => { console.error(err); process.exit(1); });
