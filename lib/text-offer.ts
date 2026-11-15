// Text sign-up offer (owner, Nov 14 2026): a visitor enters a mobile number, presses one button and
// gets a 10% code; the store keeps the number and the consent it was given under.
//
// With a text provider connected (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM) the code is sent
// only by text, so the number has to be real. Until then the code is shown on screen (the route applies
// it to the cart), and the number is still saved. Sign-ups live in `requests` (kind text_offer), one row per
// number, so no table is added. Nothing here sends marketing beyond the one message that was asked for.
import { saveStoredPromo, storedPromoList } from './promo-codes';
import { TEXT_OFFER_CODE, TEXT_OFFER_PERCENT, TEXT_CONSENT_VERSION, TEXT_CONSENT_TEXT } from './text-offer-wording';

export const TEXT_OFFER_KIND = 'text_offer';
export { TEXT_OFFER_CODE, TEXT_OFFER_PERCENT, TEXT_CONSENT_VERSION, TEXT_CONSENT_TEXT };
/** One text per number per day, whatever the visitor presses. */
export const RESEND_MS = 24 * 3600000;

type Environment = Record<string, string | undefined>;
export type TextOfferResult =
    | { status: 'texted' | 'already_texted'; message: string }
    | { status: 'shown'; code: string; percentOff: number; message: string };
type Signup = { phone: string; consent: { version: string; text: string; at: number }; first: number; lastSendAt: number | null; sends: number; delivery: 'texted' | 'shown' };

/** A U.S. mobile or landline number as +1XXXXXXXXXX, or '' when it is not one. */
export function cleanUsPhone(value: unknown): string {
    const digits = String(value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? '+1' + digits : '';
}
export function textProvider(env: Environment): { sid: string; token: string; from: string } | null {
    const sid = (env.TWILIO_ACCOUNT_SID || '').trim(), token = (env.TWILIO_AUTH_TOKEN || '').trim(), from = (env.TWILIO_FROM || '').trim();
    return /^AC[a-f0-9]{32}$/i.test(sid) && token.length >= 16 && (cleanUsPhone(from) || /^MG[a-f0-9]{32}$/i.test(from)) ? { sid, token, from: cleanUsPhone(from) || from } : null;
}
export const textOfferBody = (origin: string) => `Biomod: your ${TEXT_OFFER_PERCENT}% off code is ${TEXT_OFFER_CODE}. Enter it at checkout on ${origin.replace(/^https?:\/\//, '')}. Reply STOP to opt out.`;

/** The offer code exists and is switched on. An owner who turned it off in Promo codes has ended the offer. */
export async function offerOpen(db: D1Database): Promise<boolean> {
    const existing = (await storedPromoList(db)).find(promo => promo.code === TEXT_OFFER_CODE);
    if (existing) return existing.active && existing.percentOff > 0;
    await saveStoredPromo(db, TEXT_OFFER_CODE, TEXT_OFFER_PERCENT, 'Text sign-up offer');
    return true;
}

const parse = (value: string | null | undefined): any => { try { return JSON.parse(value || 'null'); } catch { return null; } };
async function sendText(provider: NonNullable<ReturnType<typeof textProvider>>, to: string, body: string, request: typeof fetch): Promise<boolean> {
    const form = new URLSearchParams({ To: to, Body: body, ...(provider.from.startsWith('MG') ? { MessagingServiceSid: provider.from } : { From: provider.from }) });
    try {
        const response = await request('https://api.twilio.com/2010-04-01/Accounts/' + provider.sid + '/Messages.json', {
            method: 'POST', headers: { Authorization: 'Basic ' + btoa(provider.sid + ':' + provider.token), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(), redirect: 'manual', signal: AbortSignal.timeout(15000) });
        return response.status === 201 || response.status === 200;
    } catch { return false; }
}

/**
 * Record a sign-up and deliver the code. Throws the sentence the form shows when the number or the
 * consent is missing, the offer has ended, or the text could not be sent.
 */
export async function textOfferSignup(db: D1Database, env: Environment, input: { phone?: unknown; consent?: unknown }, origin: string, now: number, id: string, request: typeof fetch = fetch): Promise<TextOfferResult> {
    const phone = cleanUsPhone(input.phone);
    if (!phone) throw new Error('Enter a 10-digit U.S. mobile number.');
    if (input.consent !== true) throw new Error('Press the button to agree to receive the text.');
    if (!await offerOpen(db)) throw new Error('This offer has ended.');
    const row = await db.prepare("SELECT id,data FROM requests WHERE kind=? AND json_extract(data,'$.phone')=? ORDER BY created LIMIT 1").bind(TEXT_OFFER_KIND, phone).first<{ id: string; data: string }>();
    const saved = parse(row?.data) as Signup | null;
    const provider = textProvider(env);
    const consent = { version: TEXT_CONSENT_VERSION, text: TEXT_CONSENT_TEXT, at: now };
    const write = async (next: Signup) => row
        ? db.prepare('UPDATE requests SET data=? WHERE id=? AND kind=?').bind(JSON.stringify(next), row.id, TEXT_OFFER_KIND).run()
        : db.prepare('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)').bind(id, null, TEXT_OFFER_KIND, JSON.stringify(next), now).run();
    if (!provider) {
        await write({ phone, consent: saved?.consent || consent, first: saved?.first || now, lastSendAt: saved?.lastSendAt ?? null, sends: saved?.sends || 0, delivery: saved?.delivery === 'texted' ? 'texted' : 'shown' });
        return { status: 'shown', code: TEXT_OFFER_CODE, percentOff: TEXT_OFFER_PERCENT, message: `Your code is ${TEXT_OFFER_CODE}: ${TEXT_OFFER_PERCENT}% off.` };
    }
    if (saved?.lastSendAt && now - saved.lastSendAt < RESEND_MS)
        return { status: 'already_texted', message: 'We already texted your code to this number. Check your messages.' };
    // Save first, so a number is kept even when the provider refuses it, then record the send.
    const base: Signup = { phone, consent: saved?.consent || consent, first: saved?.first || now, lastSendAt: saved?.lastSendAt ?? null, sends: saved?.sends || 0, delivery: saved?.delivery || 'shown' };
    await write(base);
    if (!await sendText(provider, phone, textOfferBody(origin), request)) throw new Error('We could not text that number. Check it and try again.');
    await db.prepare("UPDATE requests SET data=? WHERE kind=? AND json_extract(data,'$.phone')=?").bind(JSON.stringify({ ...base, lastSendAt: now, sends: base.sends + 1, delivery: 'texted' }), TEXT_OFFER_KIND, phone).run();
    return { status: 'texted', message: `Sent. Your ${TEXT_OFFER_PERCENT}% off code is on its way by text.` };
}

/** Sign-ups for staff, newest first. */
export async function textSignups(db: D1Database, limit = 5000): Promise<{ phone: string; signedUp: number; delivery: string; sends: number }[]> {
    const rows = (await db.prepare('SELECT data,created FROM requests WHERE kind=? ORDER BY created DESC LIMIT ?').bind(TEXT_OFFER_KIND, limit).all<{ data: string; created: number }>()).results;
    return rows.map(r => ({ saved: parse(r.data) as Signup | null, created: r.created })).filter(r => r.saved && cleanUsPhone(r.saved.phone))
        .map(r => ({ phone: r.saved!.phone, signedUp: r.saved!.first || r.created, delivery: r.saved!.delivery === 'texted' ? 'Texted' : 'Shown on screen', sends: r.saved!.sends || 0 }));
}
