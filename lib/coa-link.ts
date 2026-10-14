// Owner request, October 13, 2026: "Request by email" sends the customer a private link to the
// original COA right away. Only the original report attached to the product's current lot is ever
// linked, the link expires, and the PDF is served only after its hash is re-verified.
import { coaEmail, coaHash, coaReportByHash, coaSender, readCoaOriginal, verifiedCoaAttachment, type OriginalCoaMetadata } from './coa-delivery';
import { loadCoaBatchContext } from './product-batch';
import { readCoaConfig, type CoaEnvironment } from './coa-outbox';

export const COA_LINK_DAYS = 30;
const DAY = 86400000;
type Dependencies = { now?: () => number; fetch?: typeof fetch; uuid?: () => string; random?: () => string };
export class CoaLinkError extends Error { constructor(message: string, readonly status = 400) { super(message); this.name = 'CoaLinkError'; } }
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const esc = (v: string) => v.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
export const coaLinkUrl = (id: string, secret: string) => `https://trybiomod.com/api/coa-file/${id}.${secret}`;

/** The original report attached to this product's current lot, or null. */
export async function currentCoaFor(db: D1Database, productId: number): Promise<OriginalCoaMetadata | null> {
    const { originals, associations } = await loadCoaBatchContext(db);
    const association = associations.find(a => a.productId === productId);
    if (!association?.coaAvailable || !association.reportRef?.startsWith('private:')) return null;
    return coaReportByHash(association.reportRef.slice('private:'.length), originals, associations);
}

export function coaLinkEmail(report: OriginalCoaMetadata, link: string) {
    const subject = `Your COA: ${report.productName} / lot ${report.lot}`;
    const text = `Here is the original Certificate of Analysis you requested for ${report.productName} (${report.strength}), lot ${report.lot}.\n\nOpen the COA: ${link}\n\nThe link works for ${COA_LINK_DAYS} days. Compare the lot on the report with the lot on your vial. For laboratory research use only. Questions? Reply to this email.`;
    const html = '<div style="font-family:Arial,sans-serif;color:#141414;max-width:520px;margin:0 auto;padding:20px">'
        + '<p style="font-size:20px;font-weight:bold;color:#2b1030;letter-spacing:2px;margin:0 0 16px">BIOMOD</p>'
        + `<p>Here is the original Certificate of Analysis you requested for <strong>${esc(report.productName)}</strong> (${esc(report.strength)}), lot <strong>${esc(report.lot)}</strong>.</p>`
        + `<p><a href="${esc(link)}" style="display:inline-block;background:#2b1030;color:#fbf1ea;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open the COA</a></p>`
        + `<p style="font-size:13px;color:#5c5c5c">The link works for ${COA_LINK_DAYS} days. Compare the lot on the report with the lot on your vial.</p>`
        + '<p style="font-size:12px;color:#5c5c5c">For laboratory research use only. Questions? Reply to this email.</p></div>';
    return { subject, text, html };
}

/** Records the request, then emails the link. Throws CoaLinkError with a customer-safe message. */
export async function sendCoaLink(env: CoaEnvironment, input: { productId: unknown; email: unknown }, deps: Dependencies = {}) {
    const email = coaEmail(input.email);
    if (!email) throw new CoaLinkError('Enter a valid email address.');
    const productId = Number(input.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) throw new CoaLinkError('Choose a product.');
    const report = await currentCoaFor(env.DB, productId);
    // Owner rule (Oct 14): only the on-request HEAT products are emailed. Everything else is read on the page.
    if (!report) throw new CoaLinkError('This COA cannot be sent by email yet. Contact us and we will send it.', 404);
    const sender = coaSender(env.COA_EMAIL_FROM || env.ORDER_EMAIL_FROM || 'BIOMOD <no-reply@trybiomod.com>');
    if (!env.RESEND_API_KEY?.trim() || !sender) throw new CoaLinkError('COA email is not available right now. Contact us and we will send it.', 503);
    const now = (deps.now || Date.now)();
    const id = (deps.uuid || (() => crypto.randomUUID()))();
    const secret = (deps.random || (() => hex(crypto.getRandomValues(new Uint8Array(32)))))();
    const link = coaLinkUrl(id, secret);
    const record = { email, productId, productName: report.productName, lot: report.lot, reportId: report.reportId, sha256: report.sha256, tokenHash: await coaHash(secret), expires: now + COA_LINK_DAYS * DAY, opens: 0 };
    await env.DB.prepare('INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,?,?,?,?,?)').bind(id, null, 'coa_link', JSON.stringify(record), 'sending', now).run();
    const message = coaLinkEmail(report, link);
    const replyTo = (await readCoaConfig(env)).replyTo;
    let accepted = false;
    try {
        const response = await (deps.fetch || fetch)('https://api.resend.com/emails', {
            method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY!.trim(), 'Content-Type': 'application/json', 'Idempotency-Key': 'coa-link-' + id },
            body: JSON.stringify({ from: sender, to: [email], reply_to: replyTo, subject: message.subject, text: message.text, html: message.html }),
            redirect: 'manual', signal: AbortSignal.timeout(10000),
        });
        accepted = response.ok;
    } catch { /* reported below */ }
    await env.DB.prepare('UPDATE requests SET status=? WHERE id=?').bind(accepted ? 'sent' : 'failed', id).run();
    if (!accepted) throw new CoaLinkError('The email could not be sent. Try again, or contact us and we will send it.', 502);
    return { productName: report.productName, lot: report.lot };
}

/** Returns the verified original PDF for a valid, unexpired link. Never reveals why a link failed. */
export async function openCoaLink(env: CoaEnvironment, token: string, deps: Dependencies = {}) {
    const match = /^([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(token);
    if (!match) return null;
    const row = await env.DB.prepare("SELECT data,status FROM requests WHERE id=? AND kind='coa_link'").bind(match[1]).first<{ data: string; status: string }>();
    if (!row || row.status !== 'sent') return null;
    let data: Record<string, any>;
    try { data = JSON.parse(row.data); } catch { return null; }
    const given = await coaHash(match[2]);
    if (typeof data.tokenHash !== 'string' || data.tokenHash.length !== given.length) return null;
    let diff = 0; for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ data.tokenHash.charCodeAt(i);
    if (diff || !(Number(data.expires) > (deps.now || Date.now)())) return null;
    const { originals } = await loadCoaBatchContext(env.DB);
    const metadata = originals.find(r => r.sha256 === data.sha256 && r.productId === data.productId && r.lot === data.lot);
    const original = metadata && await readCoaOriginal(env.DB, metadata);
    if (!original) return null;
    const pdf = await verifiedCoaAttachment(original).catch(() => null);
    if (!pdf) return null;
    await env.DB.prepare("UPDATE requests SET data=json_set(data,'$.opens',coalesce(json_extract(data,'$.opens'),0)+1,'$.lastOpened',?) WHERE id=?").bind((deps.now || Date.now)(), match[1]).run().catch(() => undefined);
    return { filename: pdf.filename, bytes: Uint8Array.from(atob(pdf.content), c => c.charCodeAt(0)) };
}
