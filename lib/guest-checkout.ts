// Guest checkout (owner, Nov 14 2026). A buyer no longer has to become a member before paying.
// They give an email, confirm they are a research professional buying for laboratory research, and
// check out from their browser session. The order belongs to "guest:<session id>" until the buyer
// signs in with the same verified email, when it moves to their account. After the first paid order
// the store enrols them: the usual verification email is sent so they can claim the account.
//
// The guest record lives in `requests` (kind guest_shopper, owner guest:<session id>), next to quote
// receipts, so no table is added. It never appears in the request inbox: that reads other kinds.

export const GUEST_KIND = 'guest_shopper';
/** Bump when the wording below changes, so each order records exactly what its buyer agreed to. */
export const ATTESTATION_VERSION = 'research-professional-v1';
export const ATTESTATION_TEXT = 'I am a research professional, or I am buying for a laboratory, university or other research organization. I am 21 or older. These products are for laboratory research use only. They are not drugs, foods, supplements or cosmetics and are not for human or animal use, and I will not use or resell them for that purpose.';
export const SMS_CONSENT_TEXT = 'Text me order and shipping updates at the phone number I give at checkout. Message and data rates may apply. Reply STOP to opt out.';

/** False until a text-message provider is connected. The opt-in box is shown only when texts can be sent. */
export const SMS_UPDATES_READY = false;

export type GuestShopper = { id: string; email: string; name: string; guest: true };
/** Same choices as the membership form, so guests and members are described the same way. */
export const BUSINESS_TYPES = { university: 'University', researcher: 'Researcher', laboratory: 'Laboratory', medical_professional: 'Medical professional', other: 'Other research organization' } as const;
export type BusinessType = keyof typeof BUSINESS_TYPES;
type GuestRecord = { email: string; businessType: BusinessType; attestation: { version: string; at: number }; smsConsent: { at: number; text: string } | null; enrolledAt?: number };

export const guestOwner = (sessionId: string) => 'guest:' + sessionId;
export const isGuestOwner = (owner: unknown): owner is string => typeof owner === 'string' && /^guest:[a-f0-9-]{36}$/.test(owner);
const validSession = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const parse = (value: string | null | undefined): any => { try { return JSON.parse(value || 'null'); } catch { return null; } };
const emailPattern = /^[^\s@<>"']{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
export const cleanGuestEmail = (value: unknown): string => { const text = String(value ?? '').trim().toLowerCase(); return text.length <= 200 && emailPattern.test(text) ? text : ''; };

async function row(db: D1Database, sessionId: string) {
    return db.prepare('SELECT id,data FROM requests WHERE owner=? AND kind=? ORDER BY created DESC LIMIT 1').bind(guestOwner(sessionId), GUEST_KIND).first<{ id: string; data: string }>();
}
export async function readGuestRecord(db: D1Database, sessionId: unknown): Promise<GuestRecord | null> {
    if (!validSession(sessionId)) return null;
    const saved = parse((await row(db, sessionId))?.data);
    return saved && cleanGuestEmail(saved.email) && Object.hasOwn(BUSINESS_TYPES, saved.businessType) && saved.attestation?.version === ATTESTATION_VERSION && Number.isFinite(saved.attestation?.at) ? saved as GuestRecord : null;
}
/** The guest for this browser session, or null. A guest exists only after agreeing to the current statement. */
export async function readGuest(db: D1Database, sessionId: unknown): Promise<GuestShopper | null> {
    const record = await readGuestRecord(db, sessionId);
    return record && validSession(sessionId) ? { id: guestOwner(sessionId), email: record.email, name: '', guest: true } : null;
}
/** Save (or replace) this session's guest. Throws the message the form shows when something is missing. */
export async function saveGuest(db: D1Database, sessionId: string, input: { email?: unknown; businessType?: unknown; attested?: unknown; smsConsent?: unknown }, now: number, id: string): Promise<GuestShopper> {
    if (!validSession(sessionId)) throw new Error('Refresh the page and try again.');
    const email = cleanGuestEmail(input.email);
    if (!email) throw new Error('Enter a valid email address.');
    const businessType = typeof input.businessType === 'string' && Object.hasOwn(BUSINESS_TYPES, input.businessType) ? input.businessType as BusinessType : null;
    if (!businessType) throw new Error('Choose your type of research organization.');
    if (input.attested !== true) throw new Error('Confirm the research statement to continue.');
    const record: GuestRecord = { email, businessType, attestation: { version: ATTESTATION_VERSION, at: now }, smsConsent: input.smsConsent === true ? { at: now, text: SMS_CONSENT_TEXT } : null };
    const existing = await row(db, sessionId);
    // A returning guest with the same email is not enrolled (emailed) a second time.
    const before = parse(existing?.data);
    if (before?.email === email && Number.isFinite(before?.enrolledAt)) record.enrolledAt = before.enrolledAt;
    if (existing) await db.prepare('UPDATE requests SET data=? WHERE id=? AND kind=?').bind(JSON.stringify(record), existing.id, GUEST_KIND).run();
    else await db.prepare('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)').bind(id, guestOwner(sessionId), GUEST_KIND, JSON.stringify(record), now).run();
    return { id: guestOwner(sessionId), email, name: '', guest: true };
}
/** What the order keeps about its buyer's agreement. Stored on every guest order. */
export function guestOrderRecord(record: GuestRecord | null) {
    return record ? { guest: true, businessType: record.businessType, attestation: { ...record.attestation, text: ATTESTATION_TEXT }, ...(record.smsConsent ? { smsConsent: record.smsConsent } : {}) } : {};
}

/**
 * Move a guest's orders to the account that has just signed in. Only for an email the sign-in
 * provider has verified, and only orders placed with that same email. One order at a time: an
 * account may hold a single unpaid checkout, so a clash leaves that guest order where it is.
 */
export async function transferGuestOrders(db: D1Database, userId: string, verifiedEmail: string): Promise<number> {
    const email = cleanGuestEmail(verifiedEmail);
    if (!email || !userId || isGuestOwner(userId)) return 0;
    const orders = (await db.prepare("SELECT id,owner FROM orders WHERE owner LIKE 'guest:%' AND lower(json_extract(data,'$.email'))=? LIMIT 50").bind(email).all<{ id: string; owner: string }>()).results;
    let moved = 0;
    for (const order of orders) {
        if (!isGuestOwner(order.owner)) continue;
        try { const result = await db.prepare('UPDATE orders SET owner=? WHERE id=? AND owner=?').bind(userId, order.id, order.owner).run(); if (result.meta.changes) moved++; } catch { /* the account already has an unpaid checkout */ }
    }
    return moved;
}

type Signup = (path: string, body: unknown) => Promise<unknown>;
/**
 * Enrol a guest after their first paid order: the sign-in provider creates the account and emails
 * the verification link. The password is random and never shown; the buyer sets their own with
 * "Forgot password?". Once per guest record. Never throws: a paid order must not fail on this.
 */
export async function enrollGuest(db: D1Database, owner: string, order: { email?: unknown; address?: { name?: unknown; phone?: unknown } }, origin: string, signup: Signup, now: number, password: string): Promise<boolean> {
    if (!isGuestOwner(owner)) return false;
    const sessionId = owner.slice(6);
    try {
        const existing = await row(db, sessionId), record = parse(existing?.data) as GuestRecord | null;
        const email = cleanGuestEmail(order.email);
        if (!existing || !record || record.enrolledAt || !email || record.email !== email) return false;
        // Claim first, so two payment notifications for one order cannot both send the email.
        const claimed = await db.prepare('UPDATE requests SET data=? WHERE id=? AND data=?').bind(JSON.stringify({ ...record, enrolledAt: now }), existing.id, existing.data).run();
        if (!claimed.meta.changes) return false;
        await signup('signup?redirect_to=' + encodeURIComponent(origin + '/login'), { email, password, data: { name: String(order.address?.name || '').slice(0, 100), phone: String(order.address?.phone || '').slice(0, 30), business_type: record.businessType, guest_checkout: true } });
        return true;
    } catch { return false; }
}
