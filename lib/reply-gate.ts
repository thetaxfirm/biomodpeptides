// Certainty gate for AI reply drafts (owner, Oct 30 2026).
//
// The owner rejected every pending AI draft: they answered people who had already been answered,
// chased a cancelled order two weeks late, asked a customer for an order number he had already
// given, and replied to a supplier pitch. This runs when a draft is about to be written, not when it
// was requested, so the facts are current. It decides whether an AI draft may be written at all and
// finds the person's orders by email, order number or exact name. When it stops, the desk shows the
// reason and the facts found; a person decides. It never sends, edits or deletes customer data.
import { orderSummary, type OrderRow } from './customer-context';

type Statement = { bind: (...values: unknown[]) => Statement; all: <T>() => Promise<{ results: T[] }>; first: <T>() => Promise<T | null> };
type Database = { prepare: (sql: string) => Statement };
export type GateRequest = { id: string; kind: string; data: string; created: number; status?: string | null };
export type LinkedOrder = ReturnType<typeof orderSummary> & { matchedBy: 'email' | 'order number' | 'name' };
export type GateResult = { stop: string | null; latestIncomingAt: number; linkedEmails: string[]; linkedOrders: LinkedOrder[] };

const DAY = 86400000;
/** A customer message older than this gets no AI draft; a person checks what happened first. */
export const STALE_AFTER = 3 * DAY;
const parse = (value: string): any => { try { return JSON.parse(value); } catch { return {}; } };
const email = (value: unknown) => typeof value === 'string' && /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(value.trim()) ? value.trim().toLowerCase() : '';
const day = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
/** "Aaron M Lambert" and "aaron lambert" are the same person; one-word names never match. */
export function nameKey(value: unknown): string {
  const parts = String(value || '').normalize('NFKD').replace(/[^\p{L}\s'-]/gu, ' ').toLowerCase().split(/\s+/).filter(p => p.length > 1);
  return parts.length >= 2 ? parts[0] + ' ' + parts[parts.length - 1] : '';
}
/** Order numbers a customer gave: "Order 601ff4db", "#B329EB36", "ORDER-B329EB36" (the form's lot box), or a linked order id. */
export function orderReferences(data: Record<string, unknown>): string[] {
  const text = [data.subject, data.message, data.labelLot].filter(v => typeof v === 'string').join('\n');
  const found = [...text.matchAll(/(?:\border[\s#:-]*(?:number|no\.?)?[\s#:-]*|#)([a-f0-9]{8})(?![a-z0-9])/gi)].map(m => m[1].toLowerCase());
  if (typeof data.orderId === 'string' && /^[a-f0-9]{8}/i.test(data.orderId)) found.push(data.orderId.slice(0, 8).toLowerCase());
  return [...new Set(found)];
}
/** The message is about an order (status, shipping, missing or wrong items, payment), not a general question. */
export const ORDER_TOPIC = /\b(?:my order|order\s*#?\s*[a-f0-9]{8}|package|shipp(?:ed|ing)|tracking|deliver(?:ed|y)|missing|never (?:got|received|arrived)|didn'?t (?:get|receive)|wrong (?:item|product|vial)|damaged|refund|charged|charge|payment|under review)\b/i;
/** Supplier and seller pitches: payment rails, chat handles and "we ship from our warehouse" are not customer questions. */
const CRYPTO = /\b(?:bitcoin|btc|usdt|usdc|eth(?:ereum)?|crypto)\b/i;
const CHAT_HANDLE = /\b(?:whats\s*app|telegram|wechat|signal)\b/i;
const SELLER_WORDS = /\b(?:supplier|manufacturer|factory|warehouse|wholesale|clearance customs|domestic shipp(?:ed|ing)|purity peptides|big sale|price list|catalog(?:ue)?)\b/i;
export function looksLikeSolicitation(subject: string, message: string): boolean {
  const value = subject + '\n' + message;
  const signals = [CRYPTO.test(value), CHAT_HANDLE.test(value), SELLER_WORDS.test(value), /https?:\/\/(?!(?:www\.)?trybiomod\.com)/i.test(value)].filter(Boolean).length;
  return signals >= 2;
}

async function orderRows(db: Database, sql: string, ...values: unknown[]) {
  return (await db.prepare(sql).bind(...values).all<OrderRow>()).results;
}
const ORDER_COLUMNS = 'id,owner,status,total,created,data,payment_ref,notification_id';

/** Find this person's orders. Email first; then any order number they gave; then an exact first+last name
 * match, used only when every name match shares one checkout email (otherwise it is not certain). */
export async function linkCustomer(db: Database, request: GateRequest): Promise<{ emails: string[]; orders: LinkedOrder[] }> {
  const d = parse(request.data), primary = email(d.email);
  const found = new Map<string, { row: OrderRow; matchedBy: LinkedOrder['matchedBy'] }>();
  const add = (rows: OrderRow[], matchedBy: LinkedOrder['matchedBy']) => { for (const row of rows) if (!found.has(row.id)) found.set(row.id, { row, matchedBy }); };
  if (primary) add(await orderRows(db, `SELECT ${ORDER_COLUMNS} FROM orders WHERE lower(trim(json_extract(data,'$.email')))=? ORDER BY created DESC LIMIT 20`, primary), 'email');
  for (const reference of orderReferences(d)) {
    const rows = await orderRows(db, `SELECT ${ORDER_COLUMNS} FROM orders WHERE lower(substr(id,1,8))=? LIMIT 2`, reference);
    if (rows.length === 1) add(rows, 'order number');
  }
  const key = nameKey(d.name);
  if (key && !found.size) {
    const [first, last] = key.split(' ');
    const rows = (await orderRows(db, `SELECT ${ORDER_COLUMNS} FROM orders WHERE lower(json_extract(data,'$.address.name')) LIKE ? AND lower(json_extract(data,'$.address.name')) LIKE ? ORDER BY created DESC LIMIT 20`, '%' + first + '%', '%' + last + '%'))
      .filter(row => nameKey(parse(row.data)?.address?.name) === key);
    if (new Set(rows.map(row => email(parse(row.data).email))).size === 1) add(rows, 'name');
  }
  const emails = [...new Set([primary, ...[...found.values()].map(v => email(parse(v.row.data).email))].filter(Boolean))].slice(0, 5);
  const orders = [...found.values()].sort((a, b) => b.row.created - a.row.created).slice(0, 10).map(v => ({ ...orderSummary(v.row), matchedBy: v.matchedBy }));
  return { emails, orders };
}

/** Latest time the customer wrote on this request: the form itself or a later reply in its thread. */
async function latestIncoming(db: Database, request: GateRequest): Promise<number> {
  const row = await db.prepare("SELECT MAX(created) at FROM request_reply_messages WHERE request_id=? AND direction='incoming'").bind(request.id).first<{ at: number | null }>();
  return Math.max(request.created, Number(row?.at) || 0);
}
/** Anything BioMod sent this person (any of their emails) after they last wrote: desk replies, recorded outside replies. */
async function answeredAfter(db: Database, emails: string[], since: number): Promise<number | null> {
  if (!emails.length) return null;
  const marks = emails.map(() => '?').join(',');
  const desk = await db.prepare(`SELECT MAX(m.created) at FROM request_reply_messages m JOIN requests r ON r.id=m.request_id WHERE m.direction='outgoing' AND m.created>? AND lower(trim(json_extract(r.data,'$.email'))) IN (${marks})`).bind(since, ...emails).first<{ at: number | null }>();
  const outside = await db.prepare(`SELECT MAX(e.sent_at) at FROM request_external_replies e JOIN requests r ON r.id=e.request_id WHERE e.sent_at>? AND lower(trim(json_extract(r.data,'$.email'))) IN (${marks})`).bind(since, ...emails).first<{ at: number | null }>();
  const at = Math.max(Number(desk?.at) || 0, Number(outside?.at) || 0);
  return at > 0 ? at : null;
}

export async function aiDraftGate(db: Database, request: GateRequest, now = Date.now(), followUp?: () => Promise<{ eligible: boolean; reason: string }>): Promise<GateResult> {
  const d = parse(request.data);
  const linked = await linkCustomer(db, request);
  const latest = await latestIncoming(db, request);
  const result = (stop: string | null): GateResult => ({ stop, latestIncomingAt: latest, linkedEmails: linked.emails, linkedOrders: linked.orders });
  if (looksLikeSolicitation(String(d.subject || ''), String(d.message || ''))) return result('This looks like a supplier or sales pitch, not a customer. No AI reply; mark it spam.');
  if (d.origin === 'order') {
    const check = followUp ? await followUp() : { eligible: false, reason: 'Order follow-up could not be checked.' };
    if (!check.eligible) return result('No AI follow-up: ' + check.reason);
  }
  const answered = await answeredAfter(db, linked.emails, latest);
  if (answered) return result(`Already answered on ${day(answered)}, after the customer last wrote. No AI draft; check that conversation first.`);
  if (now - latest > STALE_AFTER) return result(`The customer wrote on ${day(latest)}, more than 3 days ago. No AI draft; check what has happened since.`);
  const about = String(d.subject || '') + '\n' + String(d.message || '');
  if (d.origin !== 'order' && ORDER_TOPIC.test(about) && !linked.orders.length) return result('This is about an order, but no order matched this person by email, order number or name. No AI draft; find the order first.');
  return result(null);
}
