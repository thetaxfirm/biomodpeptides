/* Text sign-up offer: number checks, consent, the code shown on screen without a provider, one text a
 * day with one, the owner's off switch and the staff list. In-memory database and a stand-in provider;
 * no network, credentials or production data. Numbers are in the reserved 555-01xx range. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const t = require('../lib/text-offer.ts');
const promos = require('../lib/promo-codes.ts');
const read = file => fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');

const sql = new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE requests(id TEXT PRIMARY KEY,owner TEXT,kind TEXT NOT NULL,data TEXT NOT NULL,status TEXT DEFAULT 'new',created INTEGER NOT NULL);
  CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
class Statement {
  constructor(q, v = []) { this.q = q; this.v = v; }
  bind(...v) { return new Statement(this.q, v); }
  async first() { return sql.prepare(this.q).get(...this.v) || null; }
  async all() { return { results: sql.prepare(this.q).all(...this.v) }; }
  async run() { const r = sql.prepare(this.q).run(...this.v); return { meta: { changes: r.changes } }; }
}
const db = { prepare: q => new Statement(q) };
const NOW = 2000000000000, A = '(702) 555-0101', B = '1-702-555-0102';
const env = { TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'x'.repeat(32), TWILIO_FROM: '+17025550199' };
const count = () => sql.prepare("SELECT COUNT(*) n FROM requests WHERE kind='text_offer'").get().n;

(async () => {
  assert.equal(t.cleanUsPhone(A), '+17025550101');
  assert.equal(t.cleanUsPhone(B), '+17025550102');
  for (const bad of ['', '555-0101', '123-456-7890', '702-155-0101', '+44 20 7946 0000', '70255501011', null]) assert.equal(t.cleanUsPhone(bad), '', String(bad));
  assert.equal(t.textProvider({}), null);
  assert.equal(t.textProvider({ ...env, TWILIO_FROM: 'biomod' }), null);
  assert.equal(t.textProvider(env).from, '+17025550199');

  const never = async () => { throw new Error('no network without a provider'); };
  await assert.rejects(t.textOfferSignup(db, {}, { phone: '12345', consent: true }, 'https://trybiomod.com', NOW, 'a', never), /10-digit/);
  await assert.rejects(t.textOfferSignup(db, {}, { phone: A, consent: 'yes' }, 'https://trybiomod.com', NOW, 'a', never), /agree/);
  assert.equal(count(), 0, 'nothing saved for a refused sign-up');

  // No provider: the code is shown, the number and the consent wording are kept, one row per number.
  const shown = await t.textOfferSignup(db, {}, { phone: A, consent: true }, 'https://trybiomod.com', NOW, 'a', never);
  assert.equal(shown.status, 'shown'); assert.equal(shown.code, 'TEXT10'); assert.equal(shown.percentOff, 10);
  await t.textOfferSignup(db, {}, { phone: '702.555.0101', consent: true }, 'https://trybiomod.com', NOW + 5, 'a2', never);
  assert.equal(count(), 1);
  const saved = JSON.parse(sql.prepare("SELECT data FROM requests WHERE id='a'").get().data);
  assert.equal(saved.phone, '+17025550101'); assert.equal(saved.consent.text, t.TEXT_CONSENT_TEXT); assert.equal(saved.consent.at, NOW); assert.equal(saved.first, NOW);
  assert.ok((await promos.storedPromotions(db)).some(p => p.code === 'TEXT10' && p.percentOff === 10), 'the offer creates its code');

  // With a provider: one text, never the code in the response, and no second text within a day.
  const sent = [];
  const provider = async (url, init) => { sent.push({ url, body: new URLSearchParams(init.body), auth: init.headers.Authorization }); return { status: 201 }; };
  const texted = await t.textOfferSignup(db, env, { phone: B, consent: true }, 'https://trybiomod.com', NOW, 'b', provider);
  assert.equal(texted.status, 'texted'); assert.equal(texted.code, undefined); assert.doesNotMatch(texted.message, /TEXT10/);
  assert.equal(sent.length, 1); assert.match(sent[0].url, /api\.twilio\.com\/2010-04-01\/Accounts\/ACa+\/Messages\.json$/);
  assert.equal(sent[0].body.get('To'), '+17025550102'); assert.equal(sent[0].body.get('From'), '+17025550199');
  assert.match(sent[0].body.get('Body'), /TEXT10.*trybiomod\.com.*STOP/);
  assert.equal((await t.textOfferSignup(db, env, { phone: B, consent: true }, 'https://trybiomod.com', NOW + 3600000, 'b2', provider)).status, 'already_texted');
  assert.equal(sent.length, 1);
  assert.equal((await t.textOfferSignup(db, env, { phone: B, consent: true }, 'https://trybiomod.com', NOW + t.RESEND_MS + 1, 'b3', provider)).status, 'texted');
  assert.equal(sent.length, 2); assert.equal(count(), 2);

  // A refused number is still kept, and the visitor is told to check it.
  await assert.rejects(t.textOfferSignup(db, env, { phone: '702-555-0103', consent: true }, 'https://trybiomod.com', NOW, 'c', async () => ({ status: 400 })), /could not text/);
  assert.equal(count(), 3);

  const list = await t.textSignups(db);
  assert.equal(list.length, 3);
  assert.deepEqual(list.find(r => r.phone === '+17025550102'), { phone: '+17025550102', signedUp: NOW, delivery: 'Texted', sends: 2 });
  assert.equal(list.find(r => r.phone === '+17025550101').delivery, 'Shown on screen');

  // The owner switches the code off in Promo codes: the offer ends and is not recreated.
  const stored = JSON.parse(sql.prepare("SELECT value FROM settings WHERE key=?").get(promos.PROMO_CODES_KEY).value);
  sql.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(stored.map(p => ({ ...p, active: false }))), promos.PROMO_CODES_KEY);
  await assert.rejects(t.textOfferSignup(db, {}, { phone: '702-555-0104', consent: true }, 'https://trybiomod.com', NOW, 'd', never), /offer has ended/);
  assert.equal(count(), 3);

  // Wiring: strict limit on the route, the cart form, and the staff list with its CSV.
  const route = read('app/api/store/[action]/route.ts');
  assert.ok(route.includes("await rateLimit('text-offer-strict:' + (req.headers.get('cf-connecting-ip') || s.id), 5);"));
  assert.match(read('components/store/account.tsx'), /\{!q\?\.promo && <TextOffer disabled=\{locked\}\/>\}/);
  const form = read('components/store/text-offer.tsx');
  assert.match(form, /TEXT_CONSENT_TEXT/); assert.match(form, /consent: true/); assert.doesNotMatch(form, /email/i);
  assert.match(read('app/api/admin/contacts/route.ts'), /format'\) === 'text-csv'/);
  console.log('PASS: text sign-up offer: number and consent checks, code on screen without a provider, one text a day with one, refused numbers kept, owner off switch, staff list and wiring.');
})().catch(e => { console.error(e); process.exit(1); });
