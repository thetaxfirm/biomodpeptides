/**
 * Invitations that carry their terms (owner, Nov 21 2026: "the terms, percentages and name they are
 * agreeing to, like lupe10 or lupe15, and she gets 15% for everyone she refers. Or 10 and 10.
 * Depends on the situation").
 *
 * Before this, the owner could only authorize an email address. The code, the customer discount and
 * the commission had to wait until that person had signed in and applied, on a second form further
 * down the page. Now the owner sets all three while inviting, and saving does the rest of the site:
 *
 *  - the code is created (or repriced) in the ordinary stored-promo row, so checkout, the Promo
 *    codes tab and the code report read it exactly as they read every other code;
 *  - the terms wait on the invitation and become the partner's offer the moment they apply
 *    (see applyAffiliate), so the partner sees them on their own page and signs them;
 *  - the owner can email the invitation, with those terms in it, from the same screen.
 *
 * Nothing here is a second pricing path or a second kind of offer. An invitation's terms turn into
 * the same immutable schedule the per-partner offer form writes.
 */
import { z } from 'zod';
import { affiliateState, inviteAffiliate } from './affiliate-program';
import { builtInCodes, saveStoredPromo, switchOffStoredPromo, MAX_PERCENT_OFF } from './promo-codes';
import { partnerSlots } from './restaurant-partners';
import { withAuditDb, recordChange } from './change-history';
import {
    partnerCode, invitationMessage, percentText, INVITE_LINK,
    DEFAULT_HOLD_DAYS, DEFAULT_PAYOUT_METHODS, DEFAULT_CHANNELS, MAX_NOTE_LENGTH,
    type InviteTerms, type InvitationMessage,
} from './affiliate-invite-terms';

type Actor = { id: string; email: string };
type Env = Record<string, string | undefined> & { DB: D1Database };
type Row = { email: string; active: number; name: string; code: string | null; discount_percent: number | null; commission_bps: number | null; hold_days: number | null; payout_methods: string | null; channels: string | null };

const stmt = (db: D1Database, sql: string, ...args: (string | number | null)[]) => db.prepare(sql).bind(...args);
const event = (db: D1Database, actor: string, action: string, detail: unknown, now: number) =>
    stmt(db, 'INSERT INTO affiliate_events(id,owner,actor,action,detail,created) VALUES(?,NULL,?,?,?,?)', crypto.randomUUID(), actor, action, JSON.stringify(detail), now);
const emailField = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);

export const invitationTermsInput = z.object({
    email: emailField,
    name: z.string().max(200).transform(value => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
        .pipe(z.string().min(1, 'Enter the partner’s name.').max(80, 'Keep the name under 80 characters.')),
    // Left empty, the code is the name and the discount: Lupe at 10% is LUPE10.
    code: z.string().trim().toUpperCase().max(40).optional(),
    discountPercent: z.number({ invalid_type_error: 'Enter the customer discount.' }).int('The customer discount is a whole number.').min(1, 'The customer discount is from 1 to ' + MAX_PERCENT_OFF + '%.').max(MAX_PERCENT_OFF, 'The customer discount is from 1 to ' + MAX_PERCENT_OFF + '%.'),
    commissionBps: z.number({ invalid_type_error: 'Enter what the partner earns.' }).int('Enter what the partner earns as a percentage, such as 15.').min(0, 'What the partner earns is from 0 to 100%.').max(10000, 'What the partner earns is from 0 to 100%.'),
    holdDays: z.number().int().min(0, 'The hold is from 0 to 365 days.').max(365, 'The hold is from 0 to 365 days.').default(DEFAULT_HOLD_DAYS),
    payoutMethods: z.string().trim().min(2, 'Say how the partner is paid, such as Check or ACH.').max(300).default(DEFAULT_PAYOUT_METHODS),
    channels: z.array(z.enum(['online', 'in_person'])).min(1, 'Choose where the code works.').default(['online', 'in_person']),
});

export function termsFromRow(row: Row | null | undefined): InviteTerms | null {
    if (!row || !row.code || row.discount_percent == null || row.commission_bps == null) return null;
    return {
        name: row.name || row.email, code: row.code, discountPercent: row.discount_percent, commissionBps: row.commission_bps,
        holdDays: row.hold_days ?? DEFAULT_HOLD_DAYS, payoutMethods: row.payout_methods || DEFAULT_PAYOUT_METHODS,
        channels: (row.channels || DEFAULT_CHANNELS.join(',')).split(',').filter(Boolean),
    };
}
const invitationRow = (db: D1Database, email: string) =>
    stmt(db, 'SELECT email,active,name,code,discount_percent,commission_bps,hold_days,payout_methods,channels FROM affiliate_invitations WHERE email=? COLLATE NOCASE', email).first<Row>();

/** Who else is already promised this code. '' when it is free for this invitation. */
async function codeTakenBy(db: D1Database, code: string, email: string): Promise<'invitation' | 'partner' | 'business' | ''> {
    if (await stmt(db, 'SELECT 1 FROM affiliate_invitations WHERE code=? AND active=1 AND email<>? COLLATE NOCASE', code, email).first()) return 'invitation';
    if (await stmt(db, 'SELECT 1 FROM affiliate_members WHERE code=? AND email<>? COLLATE NOCASE', code, email).first()) return 'partner';
    if (await stmt(db, 'SELECT 1 FROM affiliate_schedule_state ss JOIN affiliate_schedules f ON f.id=ss.schedule_id JOIN affiliate_members m ON m.owner=ss.owner WHERE f.code=? AND m.email<>? COLLATE NOCASE', code, email).first()) return 'partner';
    // A Businesses slot owns its code, current or retired: that screen switches its codes on and off
    // as slots change, and would take a partner's code down with it.
    if ((await partnerSlots(db)).some(slot => slot.code === code || slot.previous.includes(code))) return 'business';
    return '';
}

/**
 * Switches a code off once nothing is promised it any more. Called when an invitation is revoked or
 * its code changes, so no discount is left live for a partner who was never set up. A code a partner
 * has since applied with is theirs now and is left alone.
 */
async function retireCode(db: D1Database, code: string, email: string): Promise<boolean> {
    if (await codeTakenBy(db, code, email)) return false;
    if (await stmt(db, 'SELECT 1 FROM affiliate_members WHERE code=?', code).first()) return false;
    if (await stmt(db, 'SELECT 1 FROM affiliate_schedule_state ss JOIN affiliate_schedules f ON f.id=ss.schedule_id WHERE f.code=?', code).first()) return false;
    return switchOffStoredPromo(db, code);
}

/** The promo-code write is the one part of this that prices orders, so it carries the staff member's
 * name into the shared change log, the same way the Promo codes tab records its own edits. */
const staffContext = (actor: Actor) => ({ source: 'admin' as const, actor: actor.email || actor.id, actorType: 'staff' as const });
const auditedDb = (db: D1Database, actor: Actor) => withAuditDb(db, staffContext(actor));
async function logCodeChange(db: D1Database, actor: Actor, code: string, summary: string) {
    try { await recordChange(db, { ...staffContext(actor), action: 'store.promo_code', entityType: 'setting', entityId: code, status: 'succeeded', changes: [], summary }); }
    catch { /* the code is saved; a missing history row must not suggest otherwise */ }
}

/**
 * Saves an invitation with its terms and makes the code real.
 *
 * The invitation is written first and the code second. If the code write fails the owner sees why
 * and saves again; nothing is live in the meantime. The other order could leave a working discount
 * that no invitation knows about.
 */
export async function saveInvitationTerms(db: D1Database, actor: Actor, raw: unknown, now = Date.now()) {
    const input = invitationTermsInput.parse(raw);
    const code = input.code || partnerCode(input.name, input.discountPercent);
    if (!/^[A-Z0-9]{3,40}$/.test(code)) throw Error('Codes are 3 to 40 letters and digits, such as LUPE10.');
    if (builtInCodes().includes(code)) throw Error(code + ' is a built-in store code. Choose a different partner code.');
    if (!(await affiliateState(db)).agreement) throw Error('Publish an agreement first.');
    if (await stmt(db, 'SELECT 1 FROM affiliate_members WHERE email=? COLLATE NOCASE', input.email).first())
        throw Error('This person has already applied. Change their terms with “Send a new offer” under Applications and partners.');
    const taken = await codeTakenBy(db, code, input.email);
    if (taken === 'business') throw Error(code + ' is used by a Businesses slot. Choose a different partner code.');
    if (taken) throw Error(code + ' already belongs to another partner. Choose a different code.');

    const before = await invitationRow(db, input.email);
    const detail = { email: input.email, name: input.name, code, discountPercent: input.discountPercent, commissionBps: input.commissionBps, holdDays: input.holdDays, payoutMethods: input.payoutMethods, channels: input.channels };
    await db.batch([
        // A revoked invitation still holding this code gives it up, so a mistyped address can be
        // revoked and the right one invited with the same code.
        stmt(db, 'UPDATE affiliate_invitations SET code=NULL WHERE code=? AND active=0 AND email<>? COLLATE NOCASE', code, input.email),
        stmt(db, `INSERT INTO affiliate_invitations(email,active,created,updated,actor,name,code,discount_percent,commission_bps,hold_days,payout_methods,channels) VALUES(?,1,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(email) DO UPDATE SET active=1,updated=excluded.updated,actor=excluded.actor,name=excluded.name,code=excluded.code,discount_percent=excluded.discount_percent,commission_bps=excluded.commission_bps,hold_days=excluded.hold_days,payout_methods=excluded.payout_methods,channels=excluded.channels`,
            input.email, now, now, actor.id, input.name, code, input.discountPercent, input.commissionBps, input.holdDays, input.payoutMethods, input.channels.join(',')),
        ...(before?.active ? [] : [event(db, actor.id, 'invitation.authorized', { email: input.email }, now)]),
        event(db, actor.id, 'invitation.terms', detail, now),
    ]);

    const by = ((actor.email || actor.id) + ' for partner ' + input.name).slice(0, 120);
    const promo = await saveStoredPromo(auditedDb(db, actor), code, input.discountPercent, by, now);
    if (promo !== 'unchanged') await logCodeChange(db, actor, code, 'Promo code ' + code + (promo === 'created' ? ' created at ' : ' set to ') + input.discountPercent + '% off for partner ' + input.name + '.');
    let retired = '';
    if (before?.code && before.code !== code && await retireCode(auditedDb(db, actor), before.code, input.email)) {
        retired = before.code;
        await logCodeChange(db, actor, retired, 'Promo code ' + retired + ' turned off: partner ' + input.name + ' now uses ' + code + '.');
    }

    return {
        code, promo, retired,
        message: 'Saved. ' + input.name + '’s code is ' + code + ': customers get ' + input.discountPercent + '% off and ' + input.name + ' earns ' + percentText(input.commissionBps) + '% of each sale. '
            + (promo === 'created' ? code + ' works at checkout now and is listed under Promo codes. ' : promo === 'updated' ? code + ' is now ' + input.discountPercent + '% off at checkout. ' : '')
            + (retired ? 'The old code ' + retired + ' was switched off. ' : '')
            + 'Nothing has been emailed yet.',
    };
}

/** Authorize or revoke an address. Revoking also takes the invitation's code down, unless a partner
 * has since applied with it. Authorizing again brings the saved code back. */
export async function setInvitationAccess(db: D1Database, actor: Actor, raw: unknown, now = Date.now()) {
    const result = await inviteAffiliate(db, actor.id, raw, now);
    const input = z.object({ email: emailField, active: z.boolean() }).parse(raw);
    const row = await invitationRow(db, input.email);
    if (!row?.code || row.discount_percent == null) return result;
    if (input.active) {
        // While the invitation was revoked its code may have gone to someone else. Then this
        // invitation has no code any more, rather than repricing the one they now hold.
        if (await codeTakenBy(db, row.code, row.email)) {
            await stmt(db, 'UPDATE affiliate_invitations SET code=NULL WHERE email=? COLLATE NOCASE', row.email).run();
            return { message: 'Invitation access saved. Code ' + row.code + ' now belongs to someone else, so set new terms for this person. Nothing has been emailed.' };
        }
        const promo = await saveStoredPromo(auditedDb(db, actor), row.code, row.discount_percent, ((actor.email || actor.id) + ' for partner ' + (row.name || row.email)).slice(0, 120), now);
        if (promo !== 'unchanged') await logCodeChange(db, actor, row.code, 'Promo code ' + row.code + ' turned on again with its partner invitation.');
        return { message: 'Invitation access saved. Code ' + row.code + ' works at checkout. Nothing has been emailed.' };
    }
    const retired = await retireCode(auditedDb(db, actor), row.code, row.email);
    if (retired) await logCodeChange(db, actor, row.code, 'Promo code ' + row.code + ' turned off with its revoked partner invitation.');
    return { message: 'Invitation revoked.' + (retired ? ' Code ' + row.code + ' was switched off; it stays in the Promo codes list.' : ' An existing partner is suspended separately.') };
}

// ---- The invitation email. Sent only when the owner presses send, to the one address on the row.
export const INVITE_EMAIL_DAILY_CAP = 50;
/** How long a claimed send blocks a second one. Long enough for two clicks, short enough that a
 * crashed attempt cannot lock an address out for good. */
const SENDING_LOCK_MS = 120000;
const DEFAULT_SENDER = 'BIOMOD <contact@trybiomod.com>';
const SENDER_NAME = 'Biomod Partner Program';
const address = (value: unknown): string => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length <= 254 && !/[\x00-\x1f\x7f]/.test(text) && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(text) ? text.toLowerCase() : '';
};
/** The store's configured mailbox under the programme's own name. '' when the setting is unusable. */
export function partnerMailFrom(sender: unknown): string {
    if (typeof sender !== 'string' || sender.length > 200) return '';
    const match = /^(?:[^<>]+ <([^<>]+)>|([^<>]+))$/.exec(sender.trim());
    const mailbox = address(match?.[1] || match?.[2]);
    return mailbox ? SENDER_NAME + ' <' + mailbox + '>' : '';
}
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
/** The same words as the text part, in the plum and cream the store's other emails use. */
export function invitationHtml(message: InvitationMessage): string {
    const p = (html: string, gap = 14) => '<p style="margin:0 0 ' + gap + 'px;line-height:1.55">' + html + '</p>';
    const link = esc(INVITE_LINK);
    const [codeLine, ...otherTerms] = message.terms;
    const [codeLabel, ...codeValue] = codeLine.split(': ');
    return '<div style="background:#fbf1ea;padding:24px 16px"><div style="font-family:Arial,sans-serif;font-size:15px;color:#141414;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e9d9ef;border-radius:8px;overflow:hidden">'
        + '<div style="background:#2b1030;color:#fbf1ea;padding:16px 20px;font-size:20px;font-weight:bold;letter-spacing:2px">BIOMOD</div><div style="padding:20px">'
        + p(esc(message.greeting))
        + (message.note ? p(esc(message.note).replace(/\n/g, '<br>')) : '')
        + p(esc(message.intro))
        + '<div style="background:#fbf1ea;border-radius:6px;padding:14px 16px 2px;margin:0 0 16px">'
        + p(esc(codeLabel) + ': <strong style="font-size:18px;letter-spacing:1px;color:#2b1030">' + esc(codeValue.join(': ')) + '</strong>', 10)
        + otherTerms.map(line => p(esc(line), 10)).join('')
        + '</div>'
        + p('<strong>' + esc(message.stepsTitle) + '</strong>', 6)
        + '<ol style="margin:0 0 16px;padding-left:22px;line-height:1.55">' + message.steps.map(step => '<li style="margin-bottom:6px">' + esc(step).replace(link, '<a href="' + link + '" style="color:#2b1030">' + link + '</a>') + '</li>').join('') + '</ol>'
        + p('<a href="' + link + '" style="display:inline-block;background:#2b1030;color:#fbf1ea;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Open your invitation</a>')
        + message.closing.map(line => p(esc(line))).join('')
        + p(message.signature.map(esc).join('<br>'))
        + '<p style="margin:18px 0 0;font-size:12px;color:#5c5c5c">Biomod products are sold for laboratory research use only.</p>'
        + '</div></div></div>';
}

/**
 * Emails one invitation. The text is rebuilt here from the saved terms: the browser supplies only
 * the address and the owner's optional note, never the offer.
 *
 * A row is claimed before the provider is called and resolved after it. Only an explicit rejection
 * counts as "not sent"; a timeout or an unreadable answer is recorded as unknown, because telling
 * the owner it failed when it went out would have them send it twice.
 */
export async function sendInvitationEmail(env: Env, actor: Actor, raw: unknown, deps: { fetch?: typeof fetch; now?: () => number } = {}) {
    const input = z.object({ email: emailField, note: z.string().max(MAX_NOTE_LENGTH, 'Keep your note under ' + MAX_NOTE_LENGTH + ' characters.').default('') }).parse(raw);
    const db = env.DB, now = (deps.now || Date.now)();
    const row = await invitationRow(db, input.email);
    if (!row || !row.active) throw Error('Save this invitation before emailing it.');
    const terms = termsFromRow(row);
    if (!terms) throw Error('Set this partner’s terms before emailing the invitation.');
    if (await stmt(db, 'SELECT 1 FROM affiliate_members WHERE email=? COLLATE NOCASE', row.email).first()) throw Error('This person has already applied, so there is no invitation left to send.');
    const state = await affiliateState(db);
    if (!state.agreement) throw Error('Publish an agreement first.');
    if (!state.open) throw Error('Invited applications are paused. Open them before emailing an invitation.');
    const key = env.RESEND_API_KEY?.trim(), from = partnerMailFrom(env.COA_EMAIL_FROM || env.ORDER_EMAIL_FROM || DEFAULT_SENDER);
    if (!key || !from) throw Error('Store email is not set up, so nothing was sent. Copy the invitation and send it yourself.');
    const recent = await stmt(db, "SELECT COUNT(*) n FROM affiliate_invitation_emails WHERE created>? AND status<>'failed'", now - 86400000).first<{ n: number }>();
    if ((recent?.n || 0) >= INVITE_EMAIL_DAILY_CAP) throw Error('Daily invitation email limit reached. Try again tomorrow, or copy the invitation and send it yourself.');

    const message = invitationMessage({ terms, program: { minimumPayoutCents: state.agreement.minimum_payout_cents, payoutSchedule: state.agreement.payout_schedule }, email: row.email, note: input.note });
    // Replies go where the store's other customer mail is answered; the sending mailbox otherwise.
    let replyTo = /<([^<>]+)>$/.exec(from)![1];
    try {
        const saved = await db.prepare("SELECT value FROM settings WHERE key='coa_delivery_v1'").first<{ value: string }>();
        replyTo = address(saved?.value ? JSON.parse(saved.value)?.replyTo : '') || replyTo;
    } catch { /* an unreadable setting leaves replies on the sending mailbox */ }

    const id = crypto.randomUUID();
    const claimed = await stmt(db, "INSERT INTO affiliate_invitation_emails(id,email,status,subject,actor,created) SELECT ?,?,'sending',?,?,? WHERE NOT EXISTS(SELECT 1 FROM affiliate_invitation_emails WHERE email=? AND status='sending' AND created>?)",
        id, row.email, message.subject, actor.id, now, row.email, now - SENDING_LOCK_MS).run();
    if (!claimed.meta.changes) throw Error('An invitation to this address is already being sent. Wait a minute, then check its status.');

    let status: 'accepted' | 'failed' | 'unknown' = 'unknown', providerId: string | null = null;
    try {
        const response = await (deps.fetch || fetch)('https://api.resend.com/emails', {
            method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': 'affiliate-invitation-' + id },
            body: JSON.stringify({ from, to: [row.email], reply_to: replyTo, subject: message.subject, text: message.text, html: invitationHtml(message) }),
            redirect: 'manual', signal: AbortSignal.timeout(10000),
        });
        if (response.ok) { const out = await response.json() as { id?: unknown }; if (typeof out.id === 'string' && out.id.length <= 100) { status = 'accepted'; providerId = out.id; } }
        else if (response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)) status = 'failed';
    } catch { /* a lost answer cannot say whether the email was accepted */ }
    await db.batch([
        stmt(db, 'UPDATE affiliate_invitation_emails SET status=?,provider_id=? WHERE id=?', status, providerId, id),
        event(db, actor.id, 'invitation.emailed', { email: row.email, code: terms.code, status }, now),
    ]);
    if (status === 'failed') throw Error('The email provider rejected this invitation, so nothing was sent. Check the address, or copy the invitation and send it yourself.');
    if (status === 'unknown') throw Error('The email provider did not confirm this invitation. It may or may not have gone out, so check before sending it again.');
    return { status, message: 'Invitation emailed to ' + row.email + ' with code ' + terms.code + ' (' + terms.discountPercent + '% off for customers, ' + percentText(terms.commissionBps) + '% to ' + terms.name + ').' };
}
