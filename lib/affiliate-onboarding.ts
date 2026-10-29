/** Affiliate onboarding after an invited application: W-9 details and an ID photo held as
 * AES-GCM ciphertext, the owner's offer (code, customer discount, commission), a one-page
 * talking-points document, an electronically signed offer packet, recorded payouts and the
 * 1099 report. Money still moves outside the store; these are the records of it.
 */
import { z } from 'zod';
import { affiliateState, affiliateSchedule, type Agreement, type Member } from './affiliate-program';
import { saveStoredPromo } from './promo-codes';

const stmt = (db: D1Database, sql: string, ...args: (string | number | null)[]) => db.prepare(sql).bind(...args);
const event = (db: D1Database, owner: string | null, actor: string, action: string, detail: unknown, now: number) =>
 stmt(db, 'INSERT INTO affiliate_events(id,owner,actor,action,detail,created) VALUES(?,?,?,?,?,?)', crypto.randomUUID(), owner, actor, action, JSON.stringify(detail), now);

// ---- Vault: AFFILIATE_VAULT_KEY is a base64 32-byte Worker secret. Without it nothing sensitive is saved.
const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), c => c.charCodeAt(0));
async function vaultKey(secret: string | undefined) {
 const raw = secret ? (() => { try { return unb64(secret.trim()); } catch { return null; } })() : null;
 if (!raw || raw.length !== 32) throw Error('Secure storage is not configured. Ask Biomod to finish setup before submitting tax details.');
 return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealBytes(secret: string | undefined, bytes: Uint8Array<ArrayBuffer>) {
 const iv = crypto.getRandomValues(new Uint8Array(12));
 return 'v1:' + b64(iv) + ':' + b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(secret), bytes)));
}
export async function openBytes(secret: string | undefined, sealed: string) {
 const [version, iv, data] = sealed.split(':');
 if (version !== 'v1' || !iv || !data) throw Error('Unreadable sealed record.');
 return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await vaultKey(secret), unb64(data)));
}
export const seal = (secret: string | undefined, text: string) => sealBytes(secret, new TextEncoder().encode(text));
export const unseal = async (secret: string | undefined, sealed: string) => new TextDecoder().decode(await openBytes(secret, sealed));
export async function sha256(text: string | Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof text === 'string' ? new TextEncoder().encode(text) : new Uint8Array(text)))].map(b => b.toString(16).padStart(2, '0')).join(''); }

// ---- Talking points: the one page partners may say. Owners publish versions; offers snapshot one.
export const defaultTalkingPoints = {
 version: '2026-10-29.1', title: 'Biomod partner talking points',
 body: `WHAT YOU CAN SAY ABOUT BIOMOD (ONE PAGE)

Your code: {CODE} gives your customers {DISCOUNT}% off at trybiomod.com, online or in person.
Required disclosure, every post, video or conversation where you share the code:
"I earn a commission from Biomod on orders through my link or code."

YOU MAY SAY
- Biomod sells laboratory research compounds for research use only.
- Every lot has a certificate of analysis (COA) from third-party testing; look up the lot on the product page.
- Use code {CODE} for {DISCOUNT}% off at trybiomod.com.
- Products ship from the United States. Ask Biomod support for order or shipping questions.
- Your own honest opinion of Biomod's service, packaging and documentation.

YOU MAY NOT SAY OR DO
- Anything about human or animal use: dosing, injecting, mixing, reconstituting, stacking or protocols.
- That any product treats, cures, prevents or helps any disease or condition, or causes weight loss, muscle gain, healing or anti-aging results.
- Before-and-after claims, personal "results", or testimonials about using a product on yourself or others.
- That a product is FDA approved, a drug, a supplement or safe for consumption.
- That a COA proves a product is safe or effective in people.
- Post your code on coupon sites or forums, run paid ads with the Biomod name, or buy with your own code.
- Promise income or make up reviews.

IF SOMEONE ASKS HOW TO USE IT
Say: "Biomod products are for laboratory research only. I can't give use or dosing advice." Send other questions to Biomod support.

IN PERSON
Give the customer your code. They enter it at checkout, or Biomod staff record the sale under your code. Do not take payment for Biomod yourself.

Breaking these rules can end your partnership and any unearned commission. Ask Biomod before posting if you are unsure.`,
};
export const talkingPointsInput = z.object({ version: z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/), title: z.string().trim().min(3).max(200), body: z.string().trim().min(200).max(8000), confirmed: z.literal(true) });
export type TalkingPoints = { id: string; version: string; title: string; body: string; created: number };
export async function currentTalkingPoints(db: D1Database) {
 return db.prepare("SELECT id,version,title,body,created FROM affiliate_documents WHERE kind='talking_points' ORDER BY created DESC LIMIT 1").first<TalkingPoints>();
}
export async function publishTalkingPoints(db: D1Database, actor: string, raw: unknown, now = Date.now()) {
 const input = talkingPointsInput.parse(raw), id = crypto.randomUUID();
 await db.batch([stmt(db, "INSERT INTO affiliate_documents(id,kind,version,title,body,created,actor) VALUES(?,'talking_points',?,?,?,?,?)", id, input.version, input.title, input.body, now, actor), event(db, null, actor, 'talking_points.published', { id, version: input.version }, now)]);
 return { message: 'Talking points version ' + input.version + ' published. New offers include it; signed packets keep the version they signed.' };
}
export const personalizeTalkingPoints = (body: string, code: string | null, discount: number | null) => body.replaceAll('{CODE}', code || '[your code]').replaceAll('{DISCOUNT}', String(discount ?? 0));

// ---- Offer: owner sets the code, the customer's percent off and the partner's commission in one step.
export const offerInput = z.object({
 owner: z.string().min(1).max(100), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,40}$/, 'Codes are 3 to 40 letters and digits, such as DRMATT10.'),
 discountPercent: z.number().int().min(1).max(90), commissionBps: z.number().int().min(0).max(10000), holdDays: z.number().int().min(0).max(365),
 payoutMethods: z.string().trim().min(2).max(300), channels: z.array(z.enum(['online', 'in_person'])).min(1),
});
export type Offer = z.infer<typeof offerInput>;
/** Records a new immutable schedule carrying the offer, creates or reprices the store code, and
 * points the partner at it. The partner must sign the packet before new orders earn commission. */
export async function sendOffer(db: D1Database, actor: string, raw: unknown, now = Date.now()) {
 const input = offerInput.parse(raw);
 if (input.owner === actor) throw Error('Another administrator must set your offer.');
 const state = await affiliateState(db), points = await currentTalkingPoints(db);
 if (!state.agreement) throw Error('Publish an agreement first.');
 if (!points) throw Error('Publish the one-page talking points first.');
 const m = await stmt(db, 'SELECT owner,status,code FROM affiliate_members WHERE owner=?', input.owner).first<{ owner: string; status: string; code: string | null }>();
 if (!m) throw Error('Select a partner who has applied.');
 const taken = await stmt(db, 'SELECT owner FROM affiliate_members WHERE code=? AND owner<>?', input.code, input.owner).first();
 const offered = await stmt(db, 'SELECT f.owner FROM affiliate_schedule_state ss JOIN affiliate_schedules f ON f.id=ss.schedule_id WHERE f.code=? AND ss.owner<>?', input.code, input.owner).first();
 if (taken || offered) throw Error(input.code + ' already belongs to another partner. Choose a different code.');
 const promo = await saveStoredPromo(db, input.code, input.discountPercent, actor, now);
 const id = crypto.randomUUID();
 await db.batch([
  stmt(db, 'INSERT INTO affiliate_schedules(id,owner,agreement_id,commission_bps,hold_days,payout_methods,code,discount_percent,channels,talking_points_id,created,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, input.owner, state.agreement.id, input.commissionBps, input.holdDays, input.payoutMethods, input.code, input.discountPercent, input.channels.join(','), points.id, now, actor),
  stmt(db, 'INSERT INTO affiliate_schedule_state(owner,schedule_id) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET schedule_id=excluded.schedule_id', input.owner, id),
  // An approved partner keeps earning only after signing; their code moves to the new one at approval.
  event(db, input.owner, actor, 'offer.sent', { id, code: input.code, discountPercent: input.discountPercent, commissionBps: input.commissionBps, holdDays: input.holdDays, channels: input.channels, talkingPoints: points.version, promo }, now),
 ]);
 return { message: 'Offer saved: code ' + input.code + ' gives customers ' + input.discountPercent + '% off and pays ' + input.commissionBps / 100 + '% commission. ' + (promo === 'created' ? 'The code was created and works at checkout now. ' : promo === 'updated' ? 'The code’s discount was updated. ' : '') + 'The partner signs it from their affiliate page; nothing was emailed.' };
}

// ---- W-9 and ID: the partner enters their own; staff see only the last four digits unless an owner reveals them.
export const classifications = { individual: 'Individual', sole_proprietor: 'Sole proprietor', single_member_llc: 'Single-member LLC', llc_c: 'LLC taxed as C corporation', llc_s: 'LLC taxed as S corporation', llc_p: 'LLC taxed as partnership', c_corp: 'C corporation', s_corp: 'S corporation', partnership: 'Partnership', other: 'Other' } as const;
const addressSchema = z.object({ line1: z.string().trim().min(3).max(150), line2: z.string().trim().max(150).default(''), city: z.string().trim().min(2).max(100), state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a two-letter state, such as NV.'), zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Enter a 5-digit ZIP code.') });
export const taxInput = z.object({
 legalName: z.string().trim().min(2).max(150), businessName: z.string().trim().max(150).default(''),
 classification: z.enum(Object.keys(classifications) as [keyof typeof classifications, ...(keyof typeof classifications)[]]),
 tinType: z.enum(['ssn', 'ein']), tin: z.string().transform(v => v.replace(/\D/g, '')).refine(v => /^\d{9}$/.test(v), 'Enter all 9 digits.'),
 address: addressSchema, phone: z.string().trim().regex(/^[0-9+().\-\s]{7,30}$/, 'Enter a valid phone number.'),
}).superRefine((v, ctx) => {
 if (v.tinType === 'ssn' && (/^(000|666|9)/.test(v.tin) || v.tin.slice(3, 5) === '00' || v.tin.endsWith('0000'))) ctx.addIssue({ code: 'custom', path: ['tin'], message: 'That is not a valid Social Security number.' });
});
const MAX_IMAGE_BYTES = 900000;
export const idInput = z.object({ side: z.enum(['front', 'back']), dataUrl: z.string().max(1300000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Upload a JPEG, PNG or WebP photo.') });
export type TaxSummary = { legal_name: string; business_name: string; classification: string; tin_type: string; tin_last4: string; address: string; phone: string; status: string; review_note: string; updated: number };
async function member(db: D1Database, owner: string) {
 const row = await stmt(db, 'SELECT * FROM affiliate_members WHERE owner=?', owner).first<Member>();
 if (!row) throw Error('Submit your application first.');
 if (row.status === 'rejected' || row.status === 'suspended') throw Error('Your partnership is not active. Contact Biomod.');
 return row;
}
export async function saveTaxProfile(db: D1Database, vault: string | undefined, owner: string, raw: unknown, now = Date.now()) {
 const input = taxInput.parse(raw); await member(db, owner);
 const cipher = await seal(vault, input.tin);
 const signed = await stmt(db, 'SELECT 1 FROM affiliate_signatures WHERE owner=? LIMIT 1', owner).first();
 await db.batch([
  stmt(db, `INSERT INTO affiliate_tax_profiles(owner,legal_name,business_name,classification,tin_type,tin_cipher,tin_last4,address,phone,status,review_note,created,updated) VALUES(?,?,?,?,?,?,?,?,?,'submitted','',?,?)
  ON CONFLICT(owner) DO UPDATE SET legal_name=excluded.legal_name,business_name=excluded.business_name,classification=excluded.classification,tin_type=excluded.tin_type,tin_cipher=excluded.tin_cipher,tin_last4=excluded.tin_last4,address=excluded.address,phone=excluded.phone,status='submitted',review_note='',reviewer=NULL,reviewed=NULL,updated=excluded.updated`,
  owner, input.legalName, input.businessName, input.classification, input.tinType, cipher, input.tin.slice(-4), JSON.stringify(input.address), input.phone, now, now),
  event(db, owner, owner, 'tax.submitted', { tinType: input.tinType, last4: input.tin.slice(-4) }, now),
 ]);
 return { message: signed ? 'Tax details updated. Biomod will re-verify them; your signed packet keeps the details you signed.' : 'Tax details saved securely. Only the last four digits are shown to staff.' };
}
export async function saveIdDocument(db: D1Database, vault: string | undefined, owner: string, raw: unknown, now = Date.now()) {
 const input = idInput.parse(raw); await member(db, owner);
 const [, mime, data] = /^data:(image\/[a-z]+);base64,(.+)$/.exec(input.dataUrl)!;
 const bytes = unb64(data);
 if (bytes.length > MAX_IMAGE_BYTES) throw Error('That photo is too large. Retake it or choose a smaller image.');
 const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8, png = bytes[0] === 0x89 && bytes[1] === 0x50, webp = bytes[8] === 0x57 && bytes[9] === 0x45;
 if (!(mime === 'image/jpeg' ? jpeg : mime === 'image/png' ? png : webp)) throw Error('Upload a JPEG, PNG or WebP photo.');
 const id = crypto.randomUUID(), hash = await sha256(bytes), cipher = await sealBytes(vault, bytes);
 await db.batch([
  stmt(db, 'UPDATE affiliate_id_documents SET archived=? WHERE owner=? AND side=? AND archived IS NULL', now, owner, input.side),
  stmt(db, 'INSERT INTO affiliate_id_documents(id,owner,side,mime,bytes,sha256,cipher,created) VALUES(?,?,?,?,?,?,?,?)', id, owner, input.side, mime, bytes.length, hash, cipher, now),
  stmt(db, "UPDATE affiliate_tax_profiles SET status='submitted',updated=? WHERE owner=? AND status='verified'", now, owner),
  event(db, owner, owner, 'id.uploaded', { side: input.side, bytes: bytes.length }, now),
 ]);
 return { message: 'Driver’s license ' + input.side + ' saved securely.' };
}
export async function idDocuments(db: D1Database, owner: string) {
 return (await stmt(db, 'SELECT id,side,mime,bytes,created FROM affiliate_id_documents WHERE owner=? AND archived IS NULL ORDER BY created DESC', owner).all<{ id: string; side: string; mime: string; bytes: number; created: number }>()).results;
}
export async function taxSummary(db: D1Database, owner: string) {
 return stmt(db, 'SELECT legal_name,business_name,classification,tin_type,tin_last4,address,phone,status,review_note,updated FROM affiliate_tax_profiles WHERE owner=?', owner).first<TaxSummary>();
}

// ---- Packet: exactly what the partner signs. Rebuilt the same way for display and for signing.
export const ESIGN_CONSENT = 'I agree to use electronic records and signatures. My drawn signature and typed name below are my legal signature on this packet, with the same effect as signing on paper. I can download a copy, and I may ask Biomod for a paper copy at no charge.';
export const W9_CERTIFICATION = 'Under penalties of perjury, I certify that: (1) the taxpayer identification number shown is my correct taxpayer identification number; (2) I am not subject to backup withholding because (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; (3) I am a U.S. citizen or other U.S. person; and (4) any FATCA code entered (none) indicating that I am exempt from FATCA reporting is correct. The Internal Revenue Service does not require your consent to any provision of this document other than the certifications required to avoid backup withholding.';
export async function offerPacket(db: D1Database, owner: string) {
 const state = await affiliateState(db), schedule = await affiliateSchedule(db, owner) as (Awaited<ReturnType<typeof affiliateSchedule>> & { code: string | null; discount_percent: number | null; channels: string; talking_points_id: string | null }) | null;
 const m = await stmt(db, 'SELECT * FROM affiliate_members WHERE owner=?', owner).first<Member>();
 const tax = await taxSummary(db, owner), ids = await idDocuments(db, owner);
 const points = schedule?.talking_points_id ? await stmt(db, 'SELECT id,version,title,body,created FROM affiliate_documents WHERE id=?', schedule.talking_points_id).first<TalkingPoints>() : null;
 const agreement: Agreement | null = state.agreement;
 const missing = [!m && 'application', !tax && 'tax details (W-9)', !ids.some(d => d.side === 'front') && 'driver’s license photo', !schedule && 'an offer from Biomod', schedule && !schedule.code && 'a promo code on the offer', !agreement && 'a published agreement'].filter(Boolean) as string[];
 if (missing.length || !m || !tax || !schedule || !agreement) return { ready: false as const, missing, signed: schedule?.accepted ? true : false };
 const address = JSON.parse(tax.address) as z.infer<typeof addressSchema>;
 const packet = {
  packetVersion: 1, affiliate: { owner, email: m.email, name: m.name, website: m.website },
  offer: { scheduleId: schedule.id, code: schedule.code, customerDiscountPercent: schedule.discount_percent, commissionPercent: schedule.commission_bps / 100, holdDays: schedule.hold_days, payoutMethods: schedule.payout_methods, channels: schedule.channels.split(','), minimumPayoutCents: agreement.minimum_payout_cents, payoutSchedule: agreement.payout_schedule, offered: schedule.created },
  agreement: { id: agreement.id, version: agreement.version, title: agreement.title, company: agreement.company, contact: agreement.contact, bodySha256: await sha256(agreement.body) },
  talkingPoints: points ? { id: points.id, version: points.version, title: points.title, body: personalizeTalkingPoints(points.body, schedule.code, schedule.discount_percent) } : null,
  w9: { legalName: tax.legal_name, businessName: tax.business_name, classification: classifications[tax.classification as keyof typeof classifications] || tax.classification, tinType: tax.tin_type.toUpperCase(), tinLast4: tax.tin_last4, address, certification: W9_CERTIFICATION },
  consent: ESIGN_CONSENT,
 };
 const text = JSON.stringify(packet);
 return { ready: true as const, missing: [], signed: Boolean(schedule.accepted), needsAgreement: m.agreement_id !== agreement.id, packet, agreementBody: agreement.body, sha256: await sha256(text) };
}
export const signInput = z.object({ scheduleId: z.string().uuid(), packetSha256: z.string().regex(/^[a-f0-9]{64}$/), typedName: z.string().trim().min(2).max(150), signature: z.string().max(400000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/), consent: z.literal(true), certify: z.literal(true) });
export async function signOfferPacket(db: D1Database, owner: string, raw: unknown, context: { ip: string; userAgent: string }, now = Date.now()) {
 const input = signInput.parse(raw), current = await offerPacket(db, owner);
 if (!current.ready) throw Error('Finish these first: ' + current.missing.join(', ') + '.');
 if (current.signed) throw Error('This offer is already signed.');
 if (current.packet.offer.scheduleId !== input.scheduleId || current.sha256 !== input.packetSha256) throw Error('The offer or your details changed. Reload and review the packet before signing.');
 if (input.typedName.toLowerCase().replace(/\s+/g, ' ') !== current.packet.w9.legalName.toLowerCase().replace(/\s+/g, ' ')) throw Error('Type your full legal name exactly as on your W-9: ' + current.packet.w9.legalName + '.');
 const png = unb64(input.signature.split(',')[1]);
 if (png.length < 600 || png[0] !== 0x89 || png[1] !== 0x50) throw Error('Draw your signature in the box before signing.');
 const agreementId = current.packet.agreement.id, id = crypto.randomUUID(), packet = JSON.stringify(current.packet);
 // One batch: agreement acceptance (when a new version is pending), the signature record and the
 // schedule acceptance either all land or none do. Each repeats the current-state checks in SQL.
 const results = await db.batch([
  stmt(db, `UPDATE affiliate_members SET agreement_id=?,accepted=?,updated=? WHERE owner=? AND agreement_id<>? AND EXISTS(SELECT 1 FROM affiliate_program_state WHERE id=1 AND agreement_id=?)`, agreementId, now, now, owner, agreementId, agreementId),
  stmt(db, `INSERT OR IGNORE INTO affiliate_acceptances(owner,agreement_id,accepted) SELECT owner,agreement_id,accepted FROM affiliate_members WHERE owner=? AND agreement_id=?`, owner, agreementId),
  stmt(db, `INSERT INTO affiliate_signatures(id,owner,schedule_id,packet,packet_sha256,typed_name,signature_png,consent,ip,user_agent,signed)
   SELECT ?,ss.owner,ss.schedule_id,?,?,?,?,?,?,?,? FROM affiliate_schedule_state ss JOIN affiliate_schedules f ON f.id=ss.schedule_id JOIN affiliate_members m ON m.owner=ss.owner AND m.agreement_id=f.agreement_id
   WHERE ss.owner=? AND ss.schedule_id=? AND NOT EXISTS(SELECT 1 FROM affiliate_schedule_acceptances WHERE schedule_id=f.id)`,
   id, packet, input.packetSha256, input.typedName, input.signature, ESIGN_CONSENT, context.ip.slice(0, 64), context.userAgent.slice(0, 300), now, owner, input.scheduleId),
  stmt(db, `INSERT INTO affiliate_schedule_acceptances(schedule_id,owner,accepted) SELECT schedule_id,owner,signed FROM affiliate_signatures WHERE id=?`, id),
  stmt(db, `INSERT INTO affiliate_events(id,owner,actor,action,detail,created) SELECT ?,owner,owner,'packet.signed',?,signed FROM affiliate_signatures WHERE id=?`, crypto.randomUUID(), JSON.stringify({ signatureId: id, scheduleId: input.scheduleId, sha256: input.packetSha256 }), id),
 ]);
 if (!results[2].meta.changes) throw Error('The offer changed or was already signed. Reload before signing.');
 return { message: 'Signed. Your signed packet is saved, and Biomod will review and activate your code.', signatureId: id };
}
export async function signatureRecord(db: D1Database, id: string) {
 return stmt(db, 'SELECT id,owner,schedule_id,packet,packet_sha256,typed_name,signature_png,consent,ip,user_agent,signed FROM affiliate_signatures WHERE id=?', id).first<{ id: string; owner: string; schedule_id: string; packet: string; packet_sha256: string; typed_name: string; signature_png: string; consent: string; ip: string; user_agent: string; signed: number }>();
}

// ---- Staff review of W-9/ID, in-person sales, payouts and the 1099 report.
export async function reviewTaxProfile(db: D1Database, actor: string, raw: unknown, now = Date.now()) {
 const input = z.object({ owner: z.string().min(1).max(100), status: z.enum(['verified', 'rejected']), note: z.string().trim().max(1000).default('') }).parse(raw);
 if (input.owner === actor) throw Error('Another administrator must verify your tax details.');
 if (input.status === 'rejected' && input.note.length < 3) throw Error('Explain what the partner must fix.');
 const r = await db.batch([stmt(db, 'UPDATE affiliate_tax_profiles SET status=?,review_note=?,reviewer=?,reviewed=? WHERE owner=?', input.status, input.note, actor, now, input.owner), event(db, input.owner, actor, 'tax.' + input.status, { note: input.note }, now)]);
 if (!r[0].meta.changes) throw Error('No tax details are saved for this partner.');
 return { message: input.status === 'verified' ? 'W-9 and ID marked verified.' : 'Returned to the partner to fix.' };
}
export async function revealTin(db: D1Database, vault: string | undefined, actor: string, owner: string, now = Date.now()) {
 const row = await stmt(db, 'SELECT tin_cipher,tin_type FROM affiliate_tax_profiles WHERE owner=?', owner).first<{ tin_cipher: string; tin_type: string }>();
 if (!row) throw Error('No tax details are saved for this partner.');
 const tin = await unseal(vault, row.tin_cipher);
 await event(db, owner, actor, 'tax.revealed', { tinType: row.tin_type }, now).run();
 return { tin: row.tin_type === 'ssn' ? tin.replace(/^(\d{3})(\d{2})(\d{4})$/, '$1-$2-$3') : tin.replace(/^(\d{2})(\d{7})$/, '$1-$2'), tinType: row.tin_type };
}
export async function readIdDocument(db: D1Database, vault: string | undefined, actor: string, id: string, now = Date.now()) {
 const row = await stmt(db, 'SELECT owner,mime,cipher,side FROM affiliate_id_documents WHERE id=?', id).first<{ owner: string; mime: string; cipher: string; side: string }>();
 if (!row) throw Error('Document not found.');
 const bytes = await openBytes(vault, row.cipher);
 await event(db, row.owner, actor, 'id.viewed', { id, side: row.side }, now).run();
 return { mime: row.mime, bytes };
}
export const manualSaleInput = z.object({ owner: z.string().min(1).max(100), soldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), basisCents: z.number().int().min(1).max(100000000), note: z.string().trim().min(3).max(500) });
export async function recordManualSale(db: D1Database, actor: string, raw: unknown, now = Date.now()) {
 const input = manualSaleInput.parse(raw);
 if (input.owner === actor) throw Error('Another administrator must record your in-person sale.');
 const s = await affiliateSchedule(db, input.owner) as { commission_bps: number; accepted: number | null; code: string | null } | null;
 const m = await stmt(db, 'SELECT status,code FROM affiliate_members WHERE owner=?', input.owner).first<{ status: string; code: string | null }>();
 if (!m || m.status !== 'approved' || !s?.accepted) throw Error('The partner must be approved with a signed offer first.');
 const id = crypto.randomUUID();
 await db.batch([stmt(db, 'INSERT INTO affiliate_manual_sales(id,owner,sold_on,basis_cents,commission_bps,code,note,actor,created) VALUES(?,?,?,?,?,?,?,?,?)', id, input.owner, input.soldOn, input.basisCents, s.commission_bps, m.code || s.code || '', input.note, actor, now), event(db, input.owner, actor, 'sale.in_person', { id, basisCents: input.basisCents }, now)]);
 return { message: 'In-person sale credited at ' + s.commission_bps / 100 + '%: $' + (Math.round(input.basisCents * s.commission_bps / 10000) / 100).toFixed(2) + ' commission.' };
}
export async function manualSales(db: D1Database, owner?: string) {
 return (await stmt(db, `SELECT id,owner,sold_on,basis_cents,commission_bps,code,note,created FROM affiliate_manual_sales ${owner ? 'WHERE owner=?' : ''} ORDER BY sold_on DESC,created DESC LIMIT 500`, ...(owner ? [owner] : [])).all<{ id: string; owner: string; sold_on: string; basis_cents: number; commission_bps: number; code: string; note: string; created: number }>()).results
  .map(r => ({ ...r, commission_cents: Math.round(r.basis_cents * r.commission_bps / 10000) }));
}
export const payoutInput = z.object({ owner: z.string().min(1).max(100), amountCents: z.number().int().min(-100000000).max(100000000).refine(v => v !== 0, 'Enter an amount.'), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.string().trim().min(2).max(100), reference: z.string().trim().max(200).default(''), note: z.string().trim().max(500).default('') });
export async function recordPayout(db: D1Database, actor: string, raw: unknown, now = Date.now()) {
 const input = payoutInput.parse(raw);
 if (input.owner === actor) throw Error('Another administrator must record your payout.');
 if (input.amountCents > 0 && !(await stmt(db, "SELECT 1 FROM affiliate_tax_profiles WHERE owner=? AND status='verified'", input.owner).first())) throw Error('Verify this partner’s W-9 and ID before recording a payment.');
 const id = crypto.randomUUID();
 await db.batch([stmt(db, 'INSERT INTO affiliate_payouts(id,owner,amount_cents,paid_on,method,reference,note,actor,created) VALUES(?,?,?,?,?,?,?,?,?)', id, input.owner, input.amountCents, input.paidOn, input.method, input.reference, input.note, actor, now), event(db, input.owner, actor, 'payout.recorded', { id, amountCents: input.amountCents, paidOn: input.paidOn }, now)]);
 return { message: (input.amountCents < 0 ? 'Correction' : 'Payout') + ' recorded. No money was moved by the store.' };
}
export async function payouts(db: D1Database, owner?: string) {
 return (await stmt(db, `SELECT id,owner,amount_cents,paid_on,method,reference,note,created FROM affiliate_payouts ${owner ? 'WHERE owner=?' : ''} ORDER BY paid_on DESC,created DESC LIMIT 1000`, ...(owner ? [owner] : [])).all<{ id: string; owner: string; amount_cents: number; paid_on: string; method: string; reference: string; note: string; created: number }>()).results;
}
/** 1099-NEC reporting threshold: $600 for payments through 2025, $2,000 from 2026 (P.L. 119-21). Confirm with the accountant. */
export const threshold1099Cents = (year: number) => year >= 2026 ? 200000 : 60000;
export async function report1099(db: D1Database, year: number) {
 const rows = (await stmt(db, `SELECT p.owner,SUM(p.amount_cents) total,COUNT(*) payments,m.name,m.email,t.legal_name,t.business_name,t.classification,t.tin_type,t.tin_last4,t.address,t.status tax_status
  FROM affiliate_payouts p JOIN affiliate_members m ON m.owner=p.owner LEFT JOIN affiliate_tax_profiles t ON t.owner=p.owner WHERE substr(p.paid_on,1,4)=? GROUP BY p.owner ORDER BY total DESC`, String(year)).all<{ owner: string; total: number; payments: number; name: string; email: string; legal_name: string | null; business_name: string | null; classification: string | null; tin_type: string | null; tin_last4: string | null; address: string | null; tax_status: string | null }>()).results;
 const threshold = threshold1099Cents(year);
 return { year, thresholdCents: threshold, rows: rows.map(r => ({ ...r, address: r.address ? JSON.parse(r.address) : null, reportable: r.total >= threshold && !['c_corp', 's_corp', 'llc_c', 'llc_s'].includes(r.classification || ''), warnings: [!r.legal_name && 'No W-9 on file', r.tax_status && r.tax_status !== 'verified' && 'W-9 not verified', ['c_corp', 's_corp', 'llc_c', 'llc_s'].includes(r.classification || '') && 'Corporation: usually exempt from 1099-NEC'].filter(Boolean) as string[] })) };
}
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
export const csv = (rows: unknown[][]) => rows.map(r => r.map(v => '"' + csvCell(v).replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
export async function export1099(db: D1Database, vault: string | undefined, actor: string, year: number, now = Date.now()) {
 const report = await report1099(db, year), lines: unknown[][] = [['Tax year', 'Recipient legal name', 'Business name', 'TIN type', 'TIN', 'Address', 'City', 'State', 'ZIP', 'Email', 'Box 1 nonemployee compensation (USD)', 'Payments', 'Over threshold', 'Warnings']];
 for (const r of report.rows) {
  const cipher = (await stmt(db, 'SELECT tin_cipher FROM affiliate_tax_profiles WHERE owner=?', r.owner).first<{ tin_cipher: string }>())?.tin_cipher;
  const a = r.address || {};
  lines.push([year, r.legal_name || r.name, r.business_name || '', (r.tin_type || '').toUpperCase(), cipher ? await unseal(vault, cipher) : '', [a.line1, a.line2].filter(Boolean).join(' '), a.city || '', a.state || '', a.zip || '', r.email, (r.total / 100).toFixed(2), r.payments, r.reportable ? 'Yes' : 'No', r.warnings.join('; ')]);
 }
 await event(db, null, actor, 'tax.exported1099', { year, recipients: report.rows.length }, now).run();
 return csv(lines);
}
/** Everything the admin affiliate screen needs beyond the base program. Never includes full TINs or images. */
export async function onboardingAdmin(db: D1Database) {
 const taxes = (await db.prepare('SELECT owner,legal_name,business_name,classification,tin_type,tin_last4,address,phone,status,review_note,updated FROM affiliate_tax_profiles').all<TaxSummary & { owner: string }>()).results;
 const ids = (await db.prepare('SELECT id,owner,side,mime,bytes,created FROM affiliate_id_documents WHERE archived IS NULL ORDER BY created DESC').all()).results;
 const signatures = (await db.prepare('SELECT id,owner,schedule_id,packet_sha256,typed_name,signed FROM affiliate_signatures ORDER BY signed DESC').all()).results;
 const offers = (await db.prepare('SELECT f.id,f.owner,f.code,f.discount_percent,f.commission_bps,f.hold_days,f.payout_methods,f.channels,f.created,fa.accepted FROM affiliate_schedule_state ss JOIN affiliate_schedules f ON f.id=ss.schedule_id LEFT JOIN affiliate_schedule_acceptances fa ON fa.schedule_id=f.id').all()).results;
 const year = new Date().getUTCFullYear();
 return { taxes, ids, signatures, offers, talkingPoints: await currentTalkingPoints(db), defaultTalkingPoints, manualSales: await manualSales(db), payouts: await payouts(db), report1099: await report1099(db, year), years: (await db.prepare("SELECT DISTINCT substr(paid_on,1,4) y FROM affiliate_payouts ORDER BY y DESC").all<{ y: string }>()).results.map(r => Number(r.y)) };
}
export async function onboardingPortal(db: D1Database, owner: string) {
 const packet = await offerPacket(db, owner), signature = await stmt(db, 'SELECT id,signed,packet_sha256 FROM affiliate_signatures WHERE owner=? ORDER BY signed DESC LIMIT 1', owner).first<{ id: string; signed: number; packet_sha256: string }>();
 const sales = await manualSales(db, owner), paid = await payouts(db, owner);
 return { tax: await taxSummary(db, owner), ids: await idDocuments(db, owner), packet, signature, manualSales: sales, payouts: paid, classifications };
}
