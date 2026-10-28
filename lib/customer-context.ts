// Read-only customer evidence for staff drafts. Missing coverage never means no purchases or messages.
const VIP_WORDS = /\b(partner(ship)?s?|wholesale|distribut\w*|bulk|reseller|white[ -]?label|private[ -]?label|co-?brand\w*|expo|olympia|trade ?show|booth|met (you|jeff|logan|ash|chris)|gyms?|clinics?|pharmac\w+|retail\w*|stockists?|ceo|founder|owner of)\b/i;
export type VipSignal = { vip: boolean; why: string };
/** A routing hint from the message, never permission to impersonate an owner. */
export function vipSignal(_email: string, text: string): VipSignal {
    const word = String(text || '').match(VIP_WORDS)?.[0];
    return { vip: Boolean(word), why: word ? 'mentions "' + word.toLowerCase() + '"' : '' };
}
const STATUS_WORDS: Record<string, string> = {
    creating: 'checkout started; payment not confirmed', awaiting_payment: 'payment not confirmed',
    pending: 'payment confirmation pending', review: 'payment needs staff verification',
    paid: 'payment recorded; awaiting fulfillment', labeling: 'payment recorded; label preparation in progress',
    shipped: 'payment recorded; shipment recorded', delivered: 'payment recorded; delivery recorded',
    cancelled: 'cancelled', canceled: 'cancelled', refunded: 'refunded', failed: 'payment not confirmed',
};
export type OrderRow = { id: string; owner?: string | null; status: string; total: number; created: number; data: string; payment_ref?: string | null; notification_id?: string | null };
type Statement = { bind: (...values: unknown[]) => Statement; all: <T>() => Promise<{ results: T[] }>; first: <T>() => Promise<T | null> };
type Database = { prepare: (sql: string) => Statement };
type Coverage = 'available' | 'limited' | 'unavailable';
type OrderKind = 'live' | 'test' | 'unclassified';
export type ContactEvidence = { at: number; source: 'customer_request' | 'desk' | 'mailbox' | 'manual' | 'recovery'; direction: 'incoming' | 'outgoing' | 'note'; status: string };
export type CustomerContext = {
    vip: boolean; vipWhy?: string;
    orders: { number: string; placed: string; status: string; items: string; total: string; environment: OrderKind }[];
    purchaseHistory: { state: Coverage; checkedAt: number; matchedOrders: number | null; confirmedLivePurchases: number | null; testOrders: number | null; unclassifiedOrders: number | null; note: string };
    communicationHistory: { state: Coverage; checkedAt: number; outgoingCount: number | null; incomingCount: number | null; lastOutgoingAt: number | null; lastIncomingAt: number | null; lastReplyAt: number | null; recent: ContactEvidence[]; note: string };
};
const parse = (value: string): any => { try { return JSON.parse(value); } catch { return {}; } };
const normalizeEmail = (value: string) => String(value || '').trim().toLowerCase();
const PURCHASED = new Set(['paid', 'labeling', 'shipped', 'delivered', 'refunded']);
const COMPLETE_LIMIT = 200;
const orderKind = (row: OrderRow): OrderKind => { const d = parse(row.data); return d.internalTest || /(?:sandbox|test)/i.test(String(d.environment || '')) ? 'test' : d.environment === 'authorizenet:live' ? 'live' : 'unclassified'; };
export function orderSummary(row: OrderRow): CustomerContext['orders'][number] {
    const data = parse(row.data);
    const items = Array.isArray(data.items) ? data.items.slice(0, 12).map((i: any) => String(i?.product?.name || 'item') + (Number(i?.quantity) > 1 ? ' x' + Number(i.quantity) : '')).join(', ') : '';
    return { number: String(row.id).slice(0, 8).toUpperCase(), placed: new Date(row.created).toISOString().slice(0, 10), status: STATUS_WORDS[row.status] || 'unrecognized state; staff verification required', items: items || 'items not listed', total: '$' + (Number(row.total) / 100).toFixed(2), environment: orderKind(row) };
}
async function matchingOrders(db: Database, email: string): Promise<OrderRow[]> {
    if (!email) throw Error('Customer identity unavailable.');
    // Account ownership is an authoritative link. A matching name alone is not.
    return (await db.prepare("SELECT id,owner,status,total,created,data,payment_ref,notification_id FROM orders WHERE lower(trim(json_extract(data,'$.email')))=? OR (owner IS NOT NULL AND owner!='' AND owner IN (SELECT owner FROM orders WHERE lower(trim(json_extract(data,'$.email')))=? AND owner IS NOT NULL AND owner!='')) ORDER BY created DESC LIMIT 201").bind(email, email).all<OrderRow>()).results;
}
const unavailablePurchases = (now: number): CustomerContext['purchaseHistory'] => ({ state: 'unavailable', checkedAt: now, matchedOrders: null, confirmedLivePurchases: null, testOrders: null, unclassifiedOrders: null, note: 'Store purchase lookup unavailable. Do not claim that the customer has not bought. Offline purchases and unconnected sales channels are not checked.' });
function purchaseEvidence(rows: OrderRow[], now: number): CustomerContext['purchaseHistory'] {
    return { state: rows.length > COMPLETE_LIMIT ? 'limited' : 'available', checkedAt: now, matchedOrders: rows.length > COMPLETE_LIMIT ? null : rows.length, confirmedLivePurchases: rows.filter(r => orderKind(r) === 'live' && PURCHASED.has(r.status)).length, testOrders: rows.filter(r => orderKind(r) === 'test').length, unclassifiedOrders: rows.filter(r => orderKind(r) === 'unclassified').length, note: 'Checkout email and linked store account checked. Purchase counts use recorded live order states, including refunded purchases; they are not a fresh payment-provider verification. Tests and unclassified records are separate. Amounts are saved order amounts, not net revenue. Offline purchases and unlinked sales channels remain unverified.' };
}
async function communicationEvidence(db: Database, email: string, now: number): Promise<CustomerContext['communicationHistory']> {
    if (!email) throw Error('Customer identity unavailable.');
    // Only metadata is added to draft context. Customer message bodies are not copied across conversations.
    const rows = (await db.prepare(`WITH customer_requests AS (
      SELECT id,data,created FROM requests WHERE lower(trim(json_extract(data,'$.email')))=? AND kind IN ('contact','affiliate','stock')
    ), contact AS (
      SELECT m.created at,'desk' source,m.direction,'recorded' status FROM request_reply_messages m JOIN customer_requests r ON r.id=m.request_id
      UNION ALL SELECT e.sent_at,e.source,CASE WHEN e.source='manual' THEN 'note' ELSE 'outgoing' END,'recorded' FROM request_external_replies e JOIN customer_requests r ON r.id=e.request_id
      UNION ALL SELECT r.created,'customer_request','incoming',CASE WHEN json_extract(r.data,'$.origin')='coa-link' THEN 'submitted_coa_form' ELSE 'submitted' END FROM customer_requests r WHERE COALESCE(json_extract(r.data,'$.origin'),'')!='order'
      UNION ALL SELECT COALESCE(c.accepted_at,c.updated,c.created),'recovery','outgoing','accepted_by_provider' FROM checkout_recovery c JOIN orders o ON o.id=c.order_id WHERE lower(trim(json_extract(o.data,'$.email')))=? AND c.status='accepted'
    ) SELECT *,SUM(CASE WHEN direction='outgoing' THEN 1 ELSE 0 END) OVER() outgoing_count,SUM(CASE WHEN direction='incoming' THEN 1 ELSE 0 END) OVER() incoming_count,MAX(CASE WHEN direction='outgoing' THEN at ELSE NULL END) OVER() last_outgoing,MAX(CASE WHEN direction='incoming' THEN at ELSE NULL END) OVER() last_incoming,MAX(CASE WHEN direction='outgoing' AND source!='recovery' THEN at ELSE NULL END) OVER() last_reply FROM contact ORDER BY at DESC LIMIT 12`).bind(email, email).all<ContactEvidence & { outgoing_count: number; incoming_count: number; last_outgoing: number | null; last_incoming: number | null; last_reply: number | null }>()).results;
    return { state: 'available', checkedAt: now, outgoingCount: rows[0]?.outgoing_count || 0, incomingCount: rows[0]?.incoming_count || 0, lastOutgoingAt: rows[0]?.last_outgoing || null, lastIncomingAt: rows[0]?.last_incoming || null, lastReplyAt: rows[0]?.last_reply || null, recent: rows.map(({ at, source, direction, status }) => ({ at, source, direction, status })), note: 'Incoming contact includes website forms and email; a COA form is not an email written by the customer. Desk messages, recorded outside replies and accepted checkout reminders checked. Provider acceptance is not delivery. This is not a fresh search of all connected mailboxes. Unrecorded email, calls and texts remain unverified.' };
}
const unavailableCommunications = (now: number): CustomerContext['communicationHistory'] => ({ state: 'unavailable', checkedAt: now, outgoingCount: null, incomingCount: null, lastOutgoingAt: null, lastIncomingAt: null, lastReplyAt: null, recent: [], note: 'Contact history unavailable. Do not say this is the first email or that nobody has replied. Mailbox history and unrecorded calls or texts are unverified.' });
export async function customerContext(db: Database, email: string, message: string, now = Date.now()): Promise<CustomerContext> {
    const signal = vipSignal(email, message), address = normalizeEmail(email);
    const [purchases, communication] = await Promise.allSettled([matchingOrders(db, address), communicationEvidence(db, address, now)]);
    const rows = purchases.status === 'fulfilled' ? purchases.value : [];
    return { vip: signal.vip, ...(signal.vip ? { vipWhy: signal.why } : {}), orders: rows.slice(0, 10).map(orderSummary), purchaseHistory: purchases.status === 'fulfilled' ? purchaseEvidence(rows, now) : unavailablePurchases(now), communicationHistory: communication.status === 'fulfilled' ? communication.value : unavailableCommunications(now) };
}
export type OrderFollowUp = { eligible: boolean; reasonCode: string; reason: string; customer: CustomerContext; order: OrderRow | null };
/** Read-only guard for staff checkout-follow-up drafts. Never alters or sends automatic reminders. */
export async function orderFollowUp(db: Database, orderId: string, now = Date.now()): Promise<OrderFollowUp> {
    const order = await db.prepare('SELECT id,owner,status,total,created,data,payment_ref,notification_id FROM orders WHERE id=?').bind(orderId).first<OrderRow>();
    const data = order ? parse(order.data) : {};
    const customer = await customerContext(db, data.email || '', '', now);
    const stop = (reasonCode: string, reason: string): OrderFollowUp => ({ eligible: false, reasonCode, reason, customer, order });
    if (!order) return stop('order_missing', 'This order is no longer available.');
    if (orderKind(order) !== 'live') return stop('test_or_unclassified', 'Confirm that this is a live customer checkout before following up.');
    if (!['creating', 'awaiting_payment', 'pending'].includes(order.status) || order.payment_ref || order.notification_id || data.hold) return stop('not_unpaid', 'This order needs payment or fulfillment review, not a checkout reminder.');
    if (customer.purchaseHistory.state !== 'available') return stop('purchase_history_unavailable', 'Purchase history could not be fully checked. Review the customer before following up.');
    const rows = await matchingOrders(db, normalizeEmail(data.email)).catch(() => null);
    if (!rows) return stop('purchase_history_unavailable', 'Purchase history could not be checked. Review the customer before following up.');
    const later = rows.find(r => r.id !== order.id && r.created >= order.created && orderKind(r) !== 'test' && (PURCHASED.has(r.status) || Boolean(r.payment_ref)));
    if (later) return stop(orderKind(later) === 'live' ? 'later_purchase' : 'later_purchase_unclassified', 'Another purchase is recorded after this checkout. Check that order before contacting the customer.');
    if (customer.communicationHistory.state !== 'available') return stop('contact_history_unavailable', 'Contact history could not be checked. Review previous contact before following up.');
    if (customer.communicationHistory.recent.some(e => e.source === 'manual' && e.at >= order.created)) return stop('outside_contact_recorded', 'Staff recorded contact outside email. Review that contact before following up.');
    const { lastIncomingAt, lastOutgoingAt, lastReplyAt } = customer.communicationHistory;
    if (lastIncomingAt && lastIncomingAt >= order.created && (!lastReplyAt || lastIncomingAt > lastReplyAt)) return stop('customer_replied', 'The customer has contacted us. Review their request instead of sending a checkout reminder.');
    if (lastOutgoingAt && now - lastOutgoingAt < 86400000) return stop('recent_contact', 'A message was already recorded in the last 24 hours. Review that contact before following up.');
    return { eligible: true, reasonCode: 'reviewed', reason: 'Store purchases and recorded contact checked. Purchases or messages outside these records remain unverified.', customer, order };
}
