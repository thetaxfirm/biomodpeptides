// Leaving pop-up sign-ups (owner, Nov 27 2026). A visitor who is not signed in leaves an email to hear
// about private sales. No discount code is given. Addresses live in the `email_signups` table of the
// store's D1 database with the consent wording they agreed to. Nothing here sends email: campaigns are
// sent only when the owner approves each one, from contact@trybiomod.com, with the unsubscribe link below.
import { EMAIL_CONSENT_TEXT, EMAIL_CONSENT_VERSION } from './email-offer-wording';

export type EmailSignup = { email: string; signedUp: number; page: string; unsubscribed: number | null };

export function cleanSignupEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>"',;]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email) ? email : '';
}
const cleanPath = (value: unknown) => { const path = String(value ?? '/').split(/[?#]/)[0]; return /^\/[\w\-/.]{0,200}$/.test(path) ? path : '/'; };
export const unsubscribeUrl = (origin: string, token: string) => origin.replace(/\/$/, '') + '/api/email-offer/unsubscribe?token=' + token;

/**
 * Save the address (or re-subscribe it). Throws the sentence the panel shows.
 * `trap` is a field people never see; when a bot fills it the call pretends to succeed and saves nothing.
 */
export async function emailOfferSignup(db: D1Database, input: { email?: unknown; consent?: unknown; path?: unknown; trap?: unknown }, now: number, token: string): Promise<{ saved: boolean; email: string }> {
  const email = cleanSignupEmail(input.email);
  if (!email) throw new Error('Enter a valid email address.');
  if (input.consent !== true) throw new Error('Please press the button to sign up.');
  if (String(input.trap ?? '').trim()) return { saved: false, email };
  await db.prepare(`INSERT INTO email_signups(email,source_path,consent_version,consent_text,unsubscribe_token,created,updated) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET consent_version=excluded.consent_version,consent_text=excluded.consent_text,updated=excluded.updated,unsubscribed_at=NULL`)
    .bind(email, cleanPath(input.path), EMAIL_CONSENT_VERSION, EMAIL_CONSENT_TEXT, token, now, now).run();
  return { saved: true, email };
}

/** One-click unsubscribe. The row is kept so the address is never mailed again. */
export async function emailOfferUnsubscribe(db: D1Database, token: string, now: number): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/.test(token)) return false;
  const result = await db.prepare('UPDATE email_signups SET unsubscribed_at=COALESCE(unsubscribed_at,?),updated=? WHERE unsubscribe_token=?').bind(now, now, token).run();
  return Boolean(result.meta?.changes);
}

/** Sign-ups for staff, newest first. */
export async function emailSignups(db: D1Database, limit = 5000): Promise<EmailSignup[]> {
  const rows = (await db.prepare('SELECT email,source_path,created,unsubscribed_at FROM email_signups ORDER BY created DESC LIMIT ?').bind(limit).all<{ email: string; source_path: string; created: number; unsubscribed_at: number | null }>()).results;
  return rows.map(r => ({ email: r.email, signedUp: r.created, page: r.source_path, unsubscribed: r.unsubscribed_at }));
}
