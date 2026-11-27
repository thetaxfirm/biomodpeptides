/* Leaving pop-up sign-ups: address checks, consent, the stored consent wording, re-sign-up, the bot
 * trap, unsubscribe and the staff list. No discount code is given (owner, Nov 27 2026): a sign-up never
 * creates, returns or applies one, and an existing INSIDER10 stored promo is left exactly as it is.
 * Also checks when the panel may appear: never on buying, account or staff pages, no timer, no
 * back-button interception, and the phone flick signal. In-memory database; no network, email or
 * production data. Addresses use the reserved example.com domain. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const e = require('../lib/email-offer.ts');
const w = require('../lib/email-offer-wording.ts');
const promos = require('../lib/promo-codes.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const sql = new DatabaseSync(':memory:');
sql.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
sql.exec(read('drizzle/0039_email_signups.sql').replaceAll('--> statement-breakpoint', ''));
class Statement {
  constructor(q, v = []) { this.q = q; this.v = v; }
  bind(...v) { return new Statement(this.q, v); }
  async first() { return sql.prepare(this.q).get(...this.v) || null; }
  async all() { return { results: sql.prepare(this.q).all(...this.v) }; }
  async run() { const r = sql.prepare(this.q).run(...this.v); return { meta: { changes: r.changes } }; }
}
const db = { prepare: q => new Statement(q) };
const NOW = 2000000000000, T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222';
const rows = () => sql.prepare('SELECT * FROM email_signups ORDER BY email').all();

(async () => {
  assert.equal(e.cleanSignupEmail('  Lab.Tech@Example.COM '), 'lab.tech@example.com');
  for (const bad of ['', 'lab', 'lab@', '@example.com', 'lab@example', 'a b@example.com', 'lab@example.c', '<x>@example.com', null]) assert.equal(e.cleanSignupEmail(bad), '', String(bad));

  await assert.rejects(e.emailOfferSignup(db, { email: 'nope', consent: true }, NOW, T1), /valid email/);
  await assert.rejects(e.emailOfferSignup(db, { email: 'a@example.com', consent: 'yes' }, NOW, T1), /press the button/);
  assert.equal(rows().length, 0);

  // First sign-up stores the consent wording and the page. No promo code is created or returned.
  const first = await e.emailOfferSignup(db, { email: 'A@Example.com', consent: true, path: '/shop?q=x#top' }, NOW, T1);
  assert.deepEqual(first, { saved: true, email: 'a@example.com' });
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM settings').get().n, 0, 'a sign-up creates no promo code');
  let [row] = rows();
  assert.equal(row.email, 'a@example.com');
  assert.equal(row.source_path, '/shop');
  assert.equal(row.consent_version, w.EMAIL_CONSENT_VERSION);
  assert.equal(row.consent_text, w.EMAIL_CONSENT_TEXT);
  assert.equal(row.unsubscribe_token, T1);
  assert.equal(row.unsubscribed_at, null);

  // Hostile page paths are stored as the home page.
  await e.emailOfferSignup(db, { email: 'b@example.com', consent: true, path: 'javascript:alert(1)' }, NOW, T2);
  assert.equal(rows()[1].source_path, '/');

  // The hidden trap field: the bot is told it worked and nothing is saved.
  const bot = await e.emailOfferSignup(db, { email: 'bot@example.com', consent: true, trap: 'Acme' }, NOW, '33333333-3333-4333-8333-333333333333');
  assert.equal(bot.saved, false);
  assert.equal(rows().length, 2);

  // Unsubscribe: wrong or malformed tokens change nothing; the right one keeps the row and marks it.
  assert.equal(await e.emailOfferUnsubscribe(db, 'not-a-token', NOW + 1), false);
  assert.equal(await e.emailOfferUnsubscribe(db, '99999999-9999-4999-8999-999999999999', NOW + 1), false);
  assert.equal(await e.emailOfferUnsubscribe(db, T1, NOW + 5), true);
  assert.equal(rows()[0].unsubscribed_at, NOW + 5);
  assert.equal(await e.emailOfferUnsubscribe(db, T1, NOW + 9), true);
  assert.equal(rows()[0].unsubscribed_at, NOW + 5, 'a second click keeps the first date');

  // Signing up again re-subscribes and keeps the original date and unsubscribe link.
  await e.emailOfferSignup(db, { email: 'a@example.com', consent: true }, NOW + 10, '44444444-4444-4444-8444-444444444444');
  [row] = rows();
  assert.equal(row.unsubscribed_at, null);
  assert.equal(row.created, NOW);
  assert.equal(row.unsubscribe_token, T1);
  assert.equal(rows().length, 2);

  const list = await e.emailSignups(db);
  assert.deepEqual(list.map(x => x.email).sort(), ['a@example.com', 'b@example.com']);
  assert.equal(e.unsubscribeUrl('https://trybiomod.com/', T1), 'https://trybiomod.com/api/email-offer/unsubscribe?token=' + T1);

  // INSIDER10 was shown to the first visitors on Nov 27. It stays a working stored promo: a sign-up
  // neither changes it nor depends on it, so the owner can switch it off without stopping sign-ups.
  await promos.saveStoredPromo(db, 'INSIDER10', 10, 'Email sign-up offer');
  const before = sql.prepare('SELECT value FROM settings WHERE key=?').get(promos.PROMO_CODES_KEY).value;
  await e.emailOfferSignup(db, { email: 'c@example.com', consent: true }, NOW, '55555555-5555-4555-8555-555555555555');
  assert.equal(sql.prepare('SELECT value FROM settings WHERE key=?').get(promos.PROMO_CODES_KEY).value, before);
  const stored = promos.normalizeStoredPromos(JSON.parse(before));
  assert(stored.some(p => p.code === 'INSIDER10' && p.percentOff === 10 && p.active));
  sql.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(stored.map(p => ({ ...p, active: false }))), promos.PROMO_CODES_KEY);
  assert.deepEqual(await e.emailOfferSignup(db, { email: 'd@example.com', consent: true }, NOW, '66666666-6666-4666-8666-666666666666'), { saved: true, email: 'd@example.com' });

  // Phone leaving signal: a fast flick back up, only on a page that was read well down.
  const vh = 800, flick = [{ t: 0, y: 2400 }, { t: 100, y: 2300 }, { t: 200, y: 2150 }, { t: 300, y: 2050 }];
  assert.equal(w.flickedUp(flick, vh, 2400), true, '350px up in 300ms after reading down');
  assert.equal(w.flickedUp(flick, vh, 1000), false, 'the page was never scrolled a screen and a half down');
  assert.equal(w.flickedUp([{ t: 0, y: 2400 }, { t: 300, y: 2250 }], vh, 2400), false, 'a slow scroll back up is reading, not leaving');
  assert.equal(w.flickedUp([{ t: 0, y: 2400 }, { t: 900, y: 1900 }], vh, 2400), false, 'too slow to be a flick');
  assert.equal(w.flickedUp([{ t: 0, y: 1800 }, { t: 200, y: 2300 }], vh, 2400), false, 'scrolling down never counts');
  assert.equal(w.flickedUp([{ t: 0, y: 2400 }], vh, 2400), false);
  assert(w.EMAIL_OFFER_CART_QUIET_MS >= 30000 && w.EMAIL_OFFER_EXIT_HOLD_MS >= 300 && w.EMAIL_OFFER_AWAY_MS >= 3000);

  // The panel never runs where it could interrupt buying, accounts or staff work.
  for (const p of ['/cart', '/checkout', '/checkout/review', '/payment/return', '/account', '/account/orders', '/admin', '/admin/contacts', '/login', '/register', '/forgot-password', '/reset-password', '/auth/callback', '/affiliates', '/verify'])
    assert.equal(w.emailOfferBlockedPath(p), true, p);
  for (const p of ['/', '/shop', '/product/bpc-157-10mg', '/collections', '/faq', '/accounting-guide'])
    assert.equal(w.emailOfferBlockedPath(p), false, p);

  // Wiring: the panel mounts on storefront pages only and stays away for signed-in shoppers, guests,
  // anyone who already gave an email, and staff. The privacy policy describes what is stored.
  const chrome = read('components/store/store-chrome.tsx'), panel = read('components/store/email-offer.tsx'), code = panel.replace(/\/\/.*$/gm, '');
  assert.match(chrome, /<Footer\/><EmailOffer\/>/);
  assert.match(panel, /!store\.customer && !store\.guest && !store\.contact\?\.email && !store\.admin && !emailOfferBlockedPath\(path\)/);
  assert.match(read('components/store/content.tsx'), /If you sign up for sale emails/);
  // No discount: nothing about a code or a percentage in the panel, its wording or its API handler.
  const wording = [w.EMAIL_OFFER_TITLE, w.EMAIL_OFFER_LEAD, w.EMAIL_OFFER_DONE, w.EMAIL_CONSENT_TEXT].join(' ');
  assert(!/%|\bcode\b|INSIDER|\boff\b/i.test(wording), 'the wording promises no discount');
  assert(!/INSIDER|PERCENT|applied|promo/i.test(code), 'the panel shows and applies no code');
  const api = read('lib/store-api/inquiry-write.ts');
  const handler = api.slice(api.indexOf("action === 'email-offer'"), api.indexOf("action === 'text-offer'"));
  assert(handler.includes('emailOfferSignup(') && handler.includes('rememberPopupEmail(') && !/PROMO_COOKIE|cookies\(\)|currentPromoCode/.test(handler), 'the sign-up handler sets no promo cookie');
  // Leaving, not a timer: the 40-second phone timer is gone, the cursor has to stay out, the cart has
  // to be quiet, phones need an empty cart, and the back button is never intercepted.
  assert(!/TOUCH_DELAY|40000|setInterval/.test(code), 'no timed pop-up');
  assert(code.includes('EMAIL_OFFER_EXIT_HOLD_MS') && code.includes("addEventListener('mouseover', back)"), 'brushing the top edge is cancelled when the cursor comes back');
  assert(code.includes('EMAIL_OFFER_CART_QUIET_MS') && code.includes('(touch && !now.empty)') && code.includes('occupied()'), 'held back after cart changes, with items in a phone cart, and while typing or a dialog is open');
  assert(code.includes('flickedUp(') && code.includes("'visibilitychange'") && code.includes('EMAIL_OFFER_AWAY_MS'), 'phone signals: flick up or coming back');
  assert(!/popstate|pushState|replaceState|history\./.test(code), 'the back button is never intercepted');
  assert(!/peptide/i.test(wording + code), 'no peptide wording in the panel');
  console.log('PASS: leaving pop-up sign-up validation, consent record, no discount code, bot trap, re-sign-up, unsubscribe, staff list, blocked pages, leaving signals and wiring');
})().catch(err => { console.error(err); process.exit(1); });
