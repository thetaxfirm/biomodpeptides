// Every message BioMod sent a customer, per order, for the Orders tab.
// Owner request, Oct 15 2026: "anyone we send a message to, show that and when."
// Read-only. It reports provider ACCEPTANCE times; inbox delivery is never claimed.
// Never returns message bodies, only what was sent and when.
type Env = { DB: D1Database };

export type OrderMessageKind = 'auto_reminder' | 'reply' | 'mailbox' | 'manual' | 'tracking' | 'tracking_unconfirmed' | 'coa';
export type OrderMessage = { kind: OrderMessageKind; at: number; by?: string };
export type OrderMessageLog = { count: number; last: OrderMessage | null; items: OrderMessage[] };

export const orderMessageLabel: Record<OrderMessageKind, string> = {
  auto_reminder: 'Automatic checkout reminder',
  reply: 'Email reply',
  mailbox: 'Email from your mailbox',
  manual: 'Phone or text (logged)',
  tracking: 'Tracking email',
  tracking_unconfirmed: 'Tracking email (not confirmed)',
  coa: 'Lab report email',
};

type OrderRef = { id: string; created: number; data?: { email?: unknown } | null };
const MAX_ITEMS = 12;
const CHUNK = 40; // D1 bound-parameter headroom

const emailOf = (order: OrderRef) => {
  const raw = typeof order.data?.email === 'string' ? order.data.email.trim().toLowerCase() : '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw) ? raw : '';
};
const chunks = <T,>(list: T[]) => { const out: T[][] = []; for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK)); return out; };
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

async function rows<T>(env: Env, sql: string, binds: unknown[]): Promise<T[]> {
  try { return (await env.DB.prepare(sql).bind(...binds).all<T>()).results || []; }
  catch { return []; } // a table not migrated yet must not break the Orders tab
}

export async function orderMessageLogs(env: Env, orders: OrderRef[]): Promise<Record<string, OrderMessageLog>> {
  const found = new Map<string, OrderMessage[]>();
  const push = (orderId: string, message: OrderMessage) => {
    if (!Number.isFinite(message.at) || message.at <= 0) return;
    const list = found.get(orderId) || [];
    list.push(message);
    found.set(orderId, list);
  };
  const byId = new Map(orders.map(o => [o.id, o]));
  const ids = [...byId.keys()];
  // Customer email → that customer's orders on this page. Messages that are not
  // tied to an order count for orders placed before the message was sent.
  const byEmail = new Map<string, OrderRef[]>();
  for (const order of orders) { const email = emailOf(order); if (email) byEmail.set(email, [...(byEmail.get(email) || []), order]); }
  const emails = [...byEmail.keys()];
  const toCustomer = (email: string, at: number, message: OrderMessage, alreadyFor = new Set<string>()) => {
    for (const order of byEmail.get(email.toLowerCase()) || []) {
      if (alreadyFor.has(order.id) || at < order.created) continue;
      push(order.id, message);
    }
  };

  for (const part of chunks(ids)) {
    // 1. The automatic unpaid-checkout reminder.
    for (const r of await rows<{ order_id: string; accepted_at: number }>(env,
      `SELECT order_id,accepted_at FROM checkout_recovery WHERE status='accepted' AND accepted_at IS NOT NULL AND order_id IN (${marks(part.length)})`, part))
      push(r.order_id, { kind: 'auto_reminder', at: r.accepted_at });
    // 2. Tracking emails, from the shared change history (admin and automatic labels).
    for (const r of await rows<{ entity_id: string; occurred_at: number; status: string; actor: string }>(env,
      `SELECT entity_id,occurred_at,status,actor FROM change_events WHERE action='shipping.tracking_email' AND entity_type='order' AND status IN ('succeeded','observed') AND entity_id IN (${marks(part.length)})`, part))
      push(r.entity_id, { kind: r.status === 'succeeded' ? 'tracking' : 'tracking_unconfirmed', at: r.occurred_at, by: r.actor });
  }

  // 3. Desk conversations: those started from an order, plus any sent to the customer's address.
  const linked = new Map<string, string>(); // request id → order id
  for (const part of chunks(ids))
    for (const r of await rows<{ id: string; order_id: string }>(env,
      `SELECT id,json_extract(data,'$.orderId') order_id FROM requests WHERE status!='deleted' AND json_extract(data,'$.orderId') IN (${marks(part.length)})`, part))
      linked.set(r.id, r.order_id);
  const linkedIds = [...linked.keys()];
  const seenReply = new Set<string>();
  for (const part of chunks(linkedIds)) {
    for (const r of await rows<{ id: string; request_id: string; created: number; sender: string }>(env,
      `SELECT id,request_id,created,sender FROM request_reply_messages WHERE direction='outgoing' AND request_id IN (${marks(part.length)})`, part)) {
      seenReply.add(r.id);
      push(linked.get(r.request_id)!, { kind: 'reply', at: r.created, by: r.sender });
    }
    for (const r of await rows<{ request_id: string; sent_at: number; source: string; recorded_by: string }>(env,
      `SELECT request_id,sent_at,source,recorded_by FROM request_external_replies WHERE request_id IN (${marks(part.length)})`, part))
      push(linked.get(r.request_id)!, { kind: r.source === 'mailbox' ? 'mailbox' : 'manual', at: r.sent_at, by: r.recorded_by });
  }
  for (const part of chunks(emails)) {
    for (const r of await rows<{ id: string; request_id: string; created: number; sender: string; recipient: string }>(env,
      `SELECT id,request_id,created,sender,lower(recipient) recipient FROM request_reply_messages WHERE direction='outgoing' AND lower(recipient) IN (${marks(part.length)})`, part)) {
      if (seenReply.has(r.id)) continue;
      const linkedOrder = linked.get(r.request_id);
      toCustomer(r.recipient, r.created, { kind: 'reply', at: r.created, by: r.sender }, new Set(linkedOrder ? [linkedOrder] : []));
    }
    // 4. Lab report (COA) emails to the same address.
    for (const r of await rows<{ recipient: string; accepted_at: number }>(env,
      `SELECT lower(recipient) recipient,accepted_at FROM coa_delivery_outbox WHERE purpose='coa' AND status='accepted' AND accepted_at IS NOT NULL AND lower(recipient) IN (${marks(part.length)})`, part))
      toCustomer(r.recipient, r.accepted_at, { kind: 'coa', at: r.accepted_at });
  }

  const out: Record<string, OrderMessageLog> = {};
  for (const id of ids) {
    const items = (found.get(id) || []).sort((a, b) => b.at - a.at);
    out[id] = { count: items.length, last: items[0] || null, items: items.slice(0, MAX_ITEMS) };
  }
  return out;
}
