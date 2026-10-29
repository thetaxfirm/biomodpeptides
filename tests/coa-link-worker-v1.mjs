// "Request by email" on the production build with real local D1. Synthetic, non-laboratory PDF fixtures;
// the mail provider is intercepted. Proves: instant email with a private link, the link serves the
// verified original for the current lot only, bad/expired links fail, failed sends never leave a live link.
import { migrationStatements } from './sql-migration-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Miniflare, Log, LogLevel } from 'miniflare';
const require = createRequire(import.meta.url);
const registry = require('./fixtures/coa-originals-v1.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), built = path.join(root, 'dist/server');
const config = JSON.parse(await fs.readFile(path.join(built, 'wrangler.json'), 'utf8'));
const files = (await fs.readdir(built, { recursive: true })).filter(n => /\.(?:m?js)$/.test(n));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trybiomod-coa-link-'));
const origin = 'https://trybiomod.com', key = 'isolated-provider-fixture-not-a-real-secret';
const sent = []; let providerOk = true, forbidden = 0;
const mf = new Miniflare({
  name: 'isolated-coa-link', cf: false, modulesRoot: built,
  modules: [config.main, ...files.filter(n => n !== config.main)].map(n => ({ type: 'ESModule', path: path.join(built, n) })),
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { RESEND_API_KEY: key, ORDER_EMAIL_FROM: 'BIOMOD Fixture <no-reply@example.invalid>', SUPABASE_URL: 'https://identity.example.invalid', SUPABASE_ANON_KEY: 'isolated' },
  d1Databases: { DB: 'isolated-coa-link' }, d1Persist: path.join(temporary, 'd1'),
  outboundService: async request => {
    if (request.url !== 'https://api.resend.com/emails' || request.method !== 'POST') { forbidden++; throw Error('Unexpected outbound ' + request.url); }
    assert.equal(request.headers.get('authorization'), 'Bearer ' + key);
    sent.push({ key: request.headers.get('idempotency-key'), ...(await request.json()) });
    return providerOk ? Response.json({ id: 'fixture' }) : new Response('{}', { status: 500 });
  },
  log: new Log(LogLevel.ERROR),
});
const post = async (body, headers = {}) => { const r = await mf.dispatchFetch(origin + '/api/coa-link', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.' + (headers.ip || 1), ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const linkIn = mail => /https:\/\/trybiomod\.com(\/api\/coa-file\/[a-f0-9-]{36}\.[a-f0-9]{64})/.exec(mail.text)[1];
try {
  await mf.ready; const DB = await mf.getD1Database('DB');
  for (const name of (await fs.readdir(path.join(root, 'drizzle'))).filter(n => n.endsWith('.sql')).sort()) await DB.batch(migrationStatements(await fs.readFile(path.join(root, 'drizzle', name), 'utf8')).map(s => DB.prepare(s)));
  await DB.batch(registry.reports.map(r => DB.prepare('INSERT INTO coa_original_reports VALUES(?,?,1)').bind(r.sha256, JSON.stringify(r))));
  const heatR30 = registry.reports.find(r => r.productId === 745);
  // Customer types an email for HEAT-R 30mg: the email goes out at once with a private link.
  let r = await post({ productId: 745, email: '  Buyer@Example.invalid ', lot: ' lot: 102-30-0001 ' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.message, /HEAT-R 30mg COA \(lot 102-30-0001\)/);
  assert.equal(sent.length, 1); const mail = sent[0];
  assert.equal(mail.from, 'Kim C. | BioMod Customer Care <no-reply@example.invalid>');
  assert.match(mail.text, /Kim C\.\nBioMod Customer Care$/); assert.match(mail.html, /Kim C\.<br>BioMod Customer Care/);
  assert.deepEqual(mail.to, ['buyer@example.invalid']); assert.equal(mail.subject, 'Your COA: HEAT-R 30mg / lot 102-30-0001');
  assert.equal(mail.attachments, undefined, 'A link, not an attachment'); assert.match(mail.html, /Open the COA/);
  assert(!/retatrutide/i.test(JSON.stringify(mail)), 'Compound name never appears in the email');
  // The link opens the exact verified original PDF.
  const link = linkIn(mail);
  let file = await mf.dispatchFetch(origin + link);
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'application/pdf'); assert.match(file.headers.get('x-robots-tag'), /noindex/);
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), heatR30.sha256, 'Served bytes are the original report');
  // Tampered, unknown or expired links fail without saying why.
  const [, id, secret] = /([a-f0-9-]{36})\.([a-f0-9]{64})/.exec(link);
  for (const bad of [`/api/coa-file/${id}.${'0'.repeat(64)}`, `/api/coa-file/${crypto.randomUUID()}.${secret}`, '/api/coa-file/nonsense']) assert.equal((await mf.dispatchFetch(origin + bad)).status, 404);
  const row = await DB.prepare('SELECT data,status FROM requests WHERE id=?').bind(id).first();
  assert.equal(row.status, 'sent'); assert.equal(JSON.parse(row.data).opens, 1); assert(!row.data.includes(secret), 'Only a hash of the link secret is stored');
  await DB.prepare("UPDATE requests SET data=json_set(data,'$.expires',1) WHERE id=?").bind(id).run();
  assert.equal((await mf.dispatchFetch(origin + link)).status, 404, 'Expired link refused');
  // HEAT-R 20mg works the same way.
  r = await post({ productId: 1389, email: 'second@example.invalid', lot: '102-20-0001' }, { ip: 2 }); assert.equal(r.status, 200); assert.match(sent.at(-1).subject, /HEAT-R 20mg \/ lot 102-20-0001/);
  // Owner rule (Oct 14 2026): the vial's lot decides the report. A 30mg lot typed on the 20mg page gets the 30mg report.
  r = await post({ productId: 1389, email: 'expo@example.invalid', lot: '102 30 0001' }, { ip: 20 }); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.message, /Lot 102-30-0001 is HEAT-R 30mg/); assert.equal(sent.at(-1).subject, 'Your COA: HEAT-R 30mg / lot 102-30-0001');
  const expo = await DB.prepare("SELECT data FROM requests WHERE kind='coa_link' AND json_extract(data,'$.email')='expo@example.invalid'").first();
  assert.equal(JSON.parse(expo.data).labelLot, '102-30-0001'); assert.equal(JSON.parse(expo.data).pageProductId, 1389); assert.equal(JSON.parse(expo.data).productId, 745);
  // A lot with no report on file is never guessed: no email, a person reviews it in the reply desk.
  const before = sent.length; r = await post({ productId: 1389, email: 'unknown@example.invalid', lot: '999-20-0001' }, { ip: 21 });
  assert.equal(r.status, 202); assert.equal(r.body.review, true); assert.match(r.body.message, /check lot 999-20-0001/); assert.equal(sent.length, before, 'Unknown lot sends nothing');
  const review = await DB.prepare("SELECT data,status FROM requests WHERE kind='contact' AND json_extract(data,'$.email')='unknown@example.invalid'").first();
  assert.equal(review.status, 'new'); assert.equal(JSON.parse(review.data).labelLot, '999-20-0001'); assert.match(JSON.parse(review.data).subject, /lot 999-20-0001/);
  // The lot is required.
  r = await post({ productId: 745, email: 'nolot@example.invalid' }, { ip: 22 }); assert.equal(r.status, 400); assert.match(r.body.error, /lot number printed on your vial/);
  // A product with no COA on file for its lot sends nothing.
  r = await post({ productId: 784, email: 'third@example.invalid', lot: '205-10-0001' }, { ip: 3 }); assert.equal(r.status, 404); assert.match(r.body.error, /cannot be sent by email yet/); assert.equal(sent.length, 3);
  // Validation and cross-site protection.
  assert.equal((await post({ productId: 745, email: 'not-an-email', lot: '102-30-0001' }, { ip: 4 })).status, 400);
  assert.equal((await post({ productId: 745, email: 'x@example.invalid', lot: '102-30-0001' }, { origin: 'https://evil.example', ip: 5 })).status, 403);
  // Separator-only differences use the exact same original; digits and letters are never guessed.
  for (const [index, lot] of ['102300001', '102 30 0001', '102-300001'].entries()) {
    r = await post({ productId: 1389, email: `format-${index}@example.invalid`, lot }, { ip: 30 + index });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(sent.at(-1).subject, 'Your COA: HEAT-R 30mg / lot 102-30-0001');
    file = await mf.dispatchFetch(origin + linkIn(sent.at(-1)));
    assert.equal(file.status, 200); assert.equal(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'), heatR30.sha256);
  }
  const beforeInvalid = sent.length;
  for (const [index, lot] of ['1023000001', '10230001', '0102300001', '1O2300001'].entries()) {
    r = await post({ productId: 745, email: `wrong-${index}@example.invalid`, lot }, { ip: 40 + index }); assert.equal(r.status, 202); assert.equal(r.body.review, true);
  }
  for (const [index, lot] of ['102/30/0001', '102.30.0001', '<b>102300001</b>'].entries()) {
    r = await post({ productId: 745, email: `invalid-${index}@example.invalid`, lot }, { ip: 50 + index }); assert.equal(r.status, 400);
  }
  assert.equal(sent.length, beforeInvalid, 'Wrong or malformed lots send nothing');
  // Provider failure: customer told to retry, link never becomes usable.
  providerOk = false; r = await post({ productId: 745, email: 'fail@example.invalid', lot: '102-30-0001' }, { ip: 6 }); assert.equal(r.status, 502);
  const failed = sent.at(-1); assert.equal((await mf.dispatchFetch(origin + linkIn(failed))).status, 404, 'Unsent link stays dead'); providerOk = true;
  // Rate limit per email address.
  let last; for (let i = 0; i < 5; i++) last = await post({ productId: 745, email: 'repeat@example.invalid', lot: '102-30-0001' }, { ip: 10 + i });
  assert.equal(last.status, 429);
  const beforeAmbiguous = sent.length;
  await DB.prepare('INSERT INTO coa_original_reports VALUES(?,?,1)').bind('f'.repeat(64), JSON.stringify({ ...heatR30, lot: '102300001', sha256: 'f'.repeat(64) })).run();
  r = await post({ productId: 1389, email: 'ambiguous@example.invalid', lot: '102300001' }, { ip: 60 });
  assert.equal(r.status, 202); assert.equal(r.body.review, true); assert.equal(sent.length, beforeAmbiguous, 'Canonical lot collisions cannot select an automatic report');
  // A saved exact report association resolves the collision; a manual hash or default cannot.
  await DB.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=json_set(product_overrides.data,\'$.batch\',json_extract(excluded.data,\'$.batch\'))').bind(heatR30.productId, JSON.stringify({batch:{lot:heatR30.lot,reportRef:'private:'+heatR30.sha256,coaAvailable:true}})).run();
  r = await post({ productId: 1389, email: 'resolved@example.invalid', lot: '102300001' }, { ip: 61 });
  assert.equal(r.status, 200); assert.equal(sent.length, beforeAmbiguous + 1);
  file = await mf.dispatchFetch(origin + linkIn(sent.at(-1)));assert.equal(file.status,200);assert.equal(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'),heatR30.sha256);
  assert.equal(forbidden, 0);
  console.log('PASS: built Worker Request by email: the vial lot decides the report (wrong-page lot sends the right report, unknown lot goes to review, lot required), instant email with a private link (no attachment, no compound name), link serves the verified original, tampered/unknown/expired/unsent links refused, no-COA product sends nothing, validation, origin guard, provider failure and per-email rate limit. Synthetic fixtures only.');
} finally { await mf.dispose(); await fs.rm(temporary, { recursive: true, force: true }); }
