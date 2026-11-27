// Checkout contact step (owner, Nov 27 2026). A guest's email address and mobile number are asked for
// first and saved the moment they press Continue, so the store can support the order and reach the
// buyer even when checkout is not finished. The number then carries forward into the delivery address.
//
// One record per browser session, kept in `requests` (kind checkout_contact, owner guest:<session id>)
// next to the guest record, so no table is added. It never appears in the request inbox: that reads
// other kinds. An email given in the leaving pop-up is remembered the same way, so checkout starts
// with it filled in.
//
// Two separate permissions are recorded with the exact wording shown:
//  - sale emails: the box starts ticked. A ticked box adds the address to `email_signups`, and never
//    re-subscribes an address that has unsubscribed.
//  - marketing texts: the box starts unticked and must be ticked by the buyer.
// Nothing here sends an email or a text.
import { cleanGuestEmail, guestOwner } from './guest-checkout';
import { CHECKOUT_EMAIL_OPTIN_TEXT, CHECKOUT_EMAIL_OPTIN_VERSION, CHECKOUT_TEXT_CONSENT_TEXT, CHECKOUT_TEXT_CONSENT_VERSION, formatUsPhone, usPhoneDigits } from './checkout-contact-wording';

export const CONTACT_KIND = 'checkout_contact';
type Permission = { at: number; version: string; text: string };
type ContactRecord = { email: string; phone: string; emailOptIn: Permission | null; textConsent: Permission | null; first: number; updated: number; source: 'popup' | 'checkout' };
/** What the checkout page gets back. `complete` means both an email and a number are saved. */
export type CheckoutContact = { email: string; phone: string; complete: boolean; emailOptIn: boolean; textConsent: boolean };
export type CheckoutContactRow = { email: string; phone: string; started: number; saleEmails: boolean; textPermission: boolean; order: 'paid' | 'started' | 'none' };

const validSession = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const parse = (value: string | null | undefined): Record<string, unknown> | null => { try { const v: unknown = JSON.parse(value || 'null'); return v && typeof v === 'object' ? v as Record<string, unknown> : null; } catch { return null; } };
const permission = (value: unknown): Permission | null => {
  const p = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  return p && typeof p.at === 'number' && Number.isFinite(p.at) && typeof p.version === 'string' && typeof p.text === 'string' ? { at: p.at, version: p.version, text: p.text } : null;
};
const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const stored = (data: string | null | undefined): ContactRecord | null => {
  const saved = parse(data);
  const email = cleanGuestEmail(saved?.email);
  if (!saved || !email) return null;
  return { email, phone: usPhoneDigits(saved.phone), emailOptIn: permission(saved.emailOptIn), textConsent: permission(saved.textConsent), first: time(saved.first), updated: time(saved.updated), source: saved.source === 'popup' ? 'popup' : 'checkout' };
};
const shown = (record: ContactRecord): CheckoutContact => ({ email: record.email, phone: formatUsPhone(record.phone), complete: Boolean(record.phone), emailOptIn: Boolean(record.emailOptIn), textConsent: Boolean(record.textConsent) });

async function row(db: D1Database, sessionId: string) {
  return db.prepare('SELECT id,data FROM requests WHERE owner=? AND kind=? ORDER BY created DESC LIMIT 1').bind(guestOwner(sessionId), CONTACT_KIND).first<{ id: string; data: string }>();
}
async function write(db: D1Database, sessionId: string, existingId: string | undefined, record: ContactRecord, now: number, id: string) {
  if (existingId) await db.prepare('UPDATE requests SET data=? WHERE id=? AND kind=?').bind(JSON.stringify(record), existingId, CONTACT_KIND).run();
  else await db.prepare('INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)').bind(id, guestOwner(sessionId), CONTACT_KIND, JSON.stringify(record), now).run();
}

/** The contact saved for this browser session, or null. */
export async function readCheckoutContact(db: D1Database, sessionId: unknown): Promise<CheckoutContact | null> {
  if (!validSession(sessionId)) return null;
  const record = stored((await row(db, sessionId))?.data);
  return record ? shown(record) : null;
}

/**
 * Save the email and mobile number given on the first checkout screen. Throws the sentence the form
 * shows. A permission keeps its original time while the buyer keeps it for the same address or number.
 */
export async function saveCheckoutContact(db: D1Database, sessionId: string, input: { email?: unknown; phone?: unknown; emailOptIn?: unknown; textConsent?: unknown }, now: number, id: string): Promise<CheckoutContact> {
  if (!validSession(sessionId)) throw new Error('Refresh the page and try again.');
  const email = cleanGuestEmail(input.email);
  if (!email) throw new Error('Enter a valid email address.');
  const phone = usPhoneDigits(input.phone);
  if (!phone) throw new Error('Enter a 10-digit U.S. mobile number.');
  const existing = await row(db, sessionId);
  const before = stored(existing?.data);
  const record: ContactRecord = {
    email, phone,
    emailOptIn: input.emailOptIn === true ? (before?.email === email && before.emailOptIn) || { at: now, version: CHECKOUT_EMAIL_OPTIN_VERSION, text: CHECKOUT_EMAIL_OPTIN_TEXT } : null,
    textConsent: input.textConsent === true ? (before?.phone === phone && before.textConsent) || { at: now, version: CHECKOUT_TEXT_CONSENT_VERSION, text: CHECKOUT_TEXT_CONSENT_TEXT } : null,
    first: before?.first || now, updated: now, source: 'checkout',
  };
  await write(db, sessionId, existing?.id, record, now, id);
  return shown(record);
}

/** An email given in the leaving pop-up is kept for this session so checkout starts with it. Never replaces a checkout contact. */
export async function rememberPopupEmail(db: D1Database, sessionId: unknown, emailInput: unknown, now: number, id: string): Promise<void> {
  const email = cleanGuestEmail(emailInput);
  if (!validSession(sessionId) || !email) return;
  const existing = await row(db, sessionId);
  const before = stored(existing?.data);
  if (before?.phone) return;
  await write(db, sessionId, existing?.id, { email, phone: '', emailOptIn: null, textConsent: null, first: before?.first || now, updated: now, source: 'popup' }, now, id);
}

/** Add a checkout buyer who left the sale-email box ticked. An existing row, subscribed or unsubscribed, is left exactly as it is. */
export async function subscribeFromCheckout(db: D1Database, emailInput: unknown, now: number, token: string): Promise<boolean> {
  const email = cleanGuestEmail(emailInput);
  if (!email || !/^[a-f0-9-]{36}$/.test(token)) return false;
  const result = await db.prepare(`INSERT INTO email_signups(email,source_path,consent_version,consent_text,unsubscribe_token,created,updated) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(email) DO NOTHING`).bind(email, '/checkout', CHECKOUT_EMAIL_OPTIN_VERSION, CHECKOUT_EMAIL_OPTIN_TEXT, token, now, now).run();
  return Boolean(result.meta?.changes);
}

/** Everyone who gave an email and number at checkout, newest first, for staff. */
export async function checkoutContacts(db: D1Database, limit = 5000): Promise<CheckoutContactRow[]> {
  const rows = (await db.prepare('SELECT data,created FROM requests WHERE kind=? ORDER BY created DESC LIMIT ?').bind(CONTACT_KIND, limit).all<{ data: string; created: number }>()).results;
  const records = rows.map(r => ({ record: stored(r.data), created: r.created })).filter((r): r is { record: ContactRecord; created: number } => Boolean(r.record?.phone));
  if (!records.length) return [];
  const safe = async <T,>(read: () => Promise<T[]>): Promise<T[]> => { try { return await read(); } catch { return []; } };
  const subscribed = new Set((await safe(async () => (await db.prepare('SELECT email FROM email_signups WHERE unsubscribed_at IS NULL').all<{ email: string }>()).results)).map(r => r.email));
  const orders = new Map<string, 'paid' | 'started'>();
  for (const o of await safe(async () => (await db.prepare("SELECT lower(json_extract(data,'$.email')) AS email,status FROM orders WHERE COALESCE(json_extract(data,'$.internalTest'),0)=0").all<{ email: string | null; status: string }>()).results)) {
    if (!o.email) continue;
    if (['paid', 'labeling', 'shipped', 'delivered'].includes(o.status)) orders.set(o.email, 'paid');
    else if (!orders.has(o.email)) orders.set(o.email, 'started');
  }
  const seen = new Set<string>();
  return records.filter(r => !seen.has(r.record.email) && Boolean(seen.add(r.record.email))).map(({ record, created }) => ({
    email: record.email, phone: formatUsPhone(record.phone), started: record.first || created,
    saleEmails: subscribed.has(record.email), textPermission: Boolean(record.textConsent), order: orders.get(record.email) || 'none',
  }));
}
