// Order conversations and case tracking for the reply desk. Never sends email.
import { withAuditDb } from './change-history';
import { coaEmail } from './coa-delivery';
import { isIssue, isResolution, type RequestIssue } from './request-issues';
import { winBackTemplates, winBackTemplate, type WinBackContext } from './win-back';
import { products } from './catalog';
import { prepareRequestReply } from './request-replies';
import { orderFollowUp } from './customer-context';
type Env = { DB: D1Database };
type Actor = { email: string; role: string };
const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };
const UUID = /^[a-f0-9-]{36}$/;
export const orderNumber = (id: string) => '#' + id.slice(0, 8).toUpperCase();
/** Open (or reuse) a desk conversation for one order. The order context is for staff and the AI only; it is never quoted to the customer. */
export async function startOrderConversation(env: Env, orderId: string, actor: Actor, options: { subject?: string } = {}): Promise<{ requestId: string; created: boolean }> {
  if (!['owner', 'manager', 'support'].includes(actor.role)) fail('Not permitted.', 403);
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(orderId)) fail('Choose an existing order.', 400);
  const order = await env.DB.prepare('SELECT id,status,data,created FROM orders WHERE id=?').bind(orderId).first<{ id: string; status: string; data: string; created: number }>();
  if (!order) fail('Order not found.', 404);
  const existing = await env.DB.prepare("SELECT id FROM requests WHERE kind='contact' AND json_extract(data,'$.orderId')=? AND status!='deleted' ORDER BY created DESC LIMIT 1").bind(orderId).first<{ id: string }>();
  if (existing) return { requestId: existing.id, created: false };
  let data: any = {}; try { data = JSON.parse(order!.data); } catch { data = {}; }
  const email = coaEmail(data.email); if (!email) fail('This order has no usable customer email.', 400);
  const items = (Array.isArray(data.items) ? data.items : []).map((item: any) => `${Number(item.quantity) || 1} × ${String(item.product?.name || 'Product').slice(0, 120)}${item.product?.activePreorder ? ' (preorder)' : ''}`).join('; ');
  const number = orderNumber(order!.id);
  const recovery = await env.DB.prepare('SELECT status,savings,accepted_at FROM checkout_recovery WHERE order_id=?').bind(orderId).first<{ status: string; savings: number; accepted_at: number | null }>().catch(() => null);
  const context = [`Order snapshot recorded ${new Date().toUTCString()}; refresh purchase and contact history before replying. Order ${number} placed ${new Date(order!.created).toUTCString()}.`, `Items: ${items || 'not recorded'}.`, `Order status: ${order!.status}${data.shipment?.status ? ', shipment ' + data.shipment.status : ''}.`,
    ...(recovery?.status === 'accepted' ? [`The email provider accepted an automatic checkout reminder${recovery.accepted_at ? ' on ' + new Date(recovery.accepted_at).toUTCString() : ''} with an extra $${(recovery.savings / 100).toFixed(2)} off this order. Inbox delivery is unverified.`] : []),
    'Staff opened this conversation from an order; this note is not a customer message.'].join(' ');
  const id = crypto.randomUUID();
  const record = { name: String(data.address?.name || '').slice(0, 100), email, subject: (options.subject || `Your BioMod order ${number}`).slice(0, 150), message: context, origin: 'order', orderId, startedBy: actor.email };
  await withAuditDb(env.DB, { source: 'admin', actor: actor.email, actorType: 'staff', action: 'request.order_conversation' }).prepare("INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,NULL,'contact',?,'new',?)").bind(id, JSON.stringify(record), Date.now()).run();
  return { requestId: id, created: true };
}
export async function saveRequestIssue(env: Env, input: { requestId: string; issue: string; resolutions?: string[]; note?: string }, actor: Actor): Promise<RequestIssue> {
  if (!['owner', 'manager', 'support'].includes(actor.role)) fail('Not permitted.', 403);
  if (!UUID.test(input.requestId)) fail('Choose an existing request.', 400);
  if (!isIssue(input.issue)) fail('Choose an issue type.', 400);
  const resolutions = [...new Set((input.resolutions || []).filter(isResolution))];
  const note = typeof input.note === 'string' ? input.note.slice(0, 1000).trim() : '';
  const exists = await env.DB.prepare("SELECT id FROM requests WHERE id=? AND kind IN ('contact','affiliate','stock')").bind(input.requestId).first();
  if (!exists) fail('Request not found.', 404);
  if (input.issue === 'owner_review' && !note) fail('Explain what needs an owner decision.', 400);
  const previous = await env.DB.prepare('SELECT issue FROM request_issues WHERE request_id=?').bind(input.requestId).first<{ issue: string }>();
  if (previous?.issue === 'owner_review' && input.issue !== 'owner_review' && actor.role !== 'owner') fail('Only an owner can clear owner review.', 403);
  const now = Date.now();
  const saved = await env.DB.prepare("INSERT INTO request_issues(request_id,issue,resolutions,note,updated,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET issue=excluded.issue,resolutions=excluded.resolutions,note=excluded.note,updated=excluded.updated,updated_by=excluded.updated_by WHERE request_issues.issue!='owner_review' OR excluded.issue='owner_review' OR ?=1").bind(input.requestId, input.issue, JSON.stringify(resolutions), note, now, actor.email, actor.role === 'owner' ? 1 : 0).run();
  if (!saved.meta.changes) fail('Only an owner can clear owner review.', 403);
  return { issue: input.issue as RequestIssue['issue'], resolutions: resolutions as RequestIssue['resolutions'], note, updated: now, updatedBy: actor.email };
}
export async function issuesFor(env: Env, ids: string[]): Promise<Record<string, RequestIssue>> {
  const out: Record<string, RequestIssue> = {};
  const unique = [...new Set(ids)].filter(v => UUID.test(v)).slice(0, 200);
  for (let i = 0; i < unique.length; i += 60) {
    const chunk = unique.slice(i, i + 60);
    try {
      const rows = (await env.DB.prepare(`SELECT * FROM request_issues WHERE request_id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<any>()).results;
      for (const r of rows) { let resolutions: any[] = []; try { resolutions = JSON.parse(r.resolutions); } catch { resolutions = []; } out[r.request_id] = { issue: r.issue, resolutions, note: r.note, updated: r.updated, updatedBy: r.updated_by }; }
    } catch { /* not migrated yet */ }
  }
  return out;
}
/** Every tracked case, for the Issues & rules page: issue, how it was resolved, note, customer name. */
export async function caseLog(env: Env): Promise<{ requestId: string; issue: string; resolutions: string[]; note: string; updated: number; updatedBy: string; name: string; subject: string }[]> {
  try {
    const rows = (await env.DB.prepare("SELECT i.*,json_extract(r.data,'$.name') name,json_extract(r.data,'$.subject') subject FROM request_issues i JOIN requests r ON r.id=i.request_id WHERE r.status!='deleted' ORDER BY i.updated DESC LIMIT 500").all<any>()).results;
    return rows.map(r => { let resolutions: string[] = []; try { resolutions = JSON.parse(r.resolutions); } catch { resolutions = []; } return { requestId: r.request_id, issue: r.issue, resolutions, note: r.note, updated: r.updated, updatedBy: r.updated_by, name: String(r.name || ''), subject: String(r.subject || '') }; });
  } catch { return []; }
}

export type OrderHold = { issue: string; note: string; by: string; at: number };
/** Put an order on hold for a problem (or clear it). A held order cannot get a label or be marked shipped. */
export async function setOrderHold(env: Env, orderId: string, hold: { issue: string; note?: string } | null, actor: Actor): Promise<OrderHold | null> {
  if (!['owner', 'manager', 'support'].includes(actor.role)) fail('Not permitted.', 403);
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(orderId)) fail('Choose an existing order.', 400);
  const db = withAuditDb(env.DB, { source: 'admin', actor: actor.email, actorType: 'staff', action: hold ? 'order.hold' : 'order.hold_cleared', summary: hold ? 'Order put on hold for a problem' : 'Order hold cleared' });
  if (!hold) {
    const r = await db.prepare("UPDATE orders SET data=json_remove(data,'$.hold'),updated=? WHERE id=? AND json_extract(data,'$.hold') IS NOT NULL").bind(Date.now(), orderId).run();
    if (!r.meta.changes) fail('This order is not on hold.', 409);
    return null;
  }
  if (!isIssue(hold.issue)) fail('Choose what the problem is.', 400);
  const value: OrderHold = { issue: hold.issue, note: typeof hold.note === 'string' ? hold.note.slice(0, 500).trim() : '', by: actor.email, at: Date.now() };
  const r = await db.prepare("UPDATE orders SET data=json_set(data,'$.hold',json(?)),updated=? WHERE id=? AND status NOT IN ('refunded','cancelled','canceled','failed','delivered')").bind(JSON.stringify(value), Date.now(), orderId).run();
  if (!r.meta.changes) fail('Only open orders can be put on hold.', 409);
  return value;
}

async function winBackContext(env: Env, orderId: string): Promise<WinBackContext> {
  const evidence = await orderFollowUp(env.DB, orderId);
  if (!evidence.eligible) fail(evidence.reason, 409);
  const order = evidence.order!;
  let data: any = {}; try { data = JSON.parse(order!.data); } catch { data = {}; }
  const items = (Array.isArray(data.items) ? data.items : []).map((item: any) => { const product = products.find(p => p.id === item.id); return { name: String(item.product?.name || product?.name || 'your item'), url: product ? 'https://trybiomod.com/product/' + product.slug : 'https://trybiomod.com/shop' }; })
    .filter((item: { name: string }, index: number, all: { name: string }[]) => all.findIndex(other => other.name === item.name) === index);
  const recovery = await env.DB.prepare("SELECT savings FROM checkout_recovery WHERE order_id=? AND status='accepted'").bind(orderId).first<{ savings: number }>().catch(() => null);
  return { firstName: String(data.address?.name || '').trim().split(/\s+/)[0]?.slice(0, 40) || '', items, orderNumber: orderNumber(order!.id), ordersUrl: 'https://trybiomod.com/account/orders', autoRecovery: recovery ? { savingsCents: recovery.savings } : null };
}
/** Rendered win-back templates for one desk conversation started from an unpaid order. */
export async function winBackPreview(env: Env, requestId: string) {
  if (!UUID.test(requestId)) fail('Choose an existing request.', 400);
  const request = await env.DB.prepare("SELECT data FROM requests WHERE id=? AND kind='contact'").bind(requestId).first<{ data: string }>();
  let data: any = {}; try { data = JSON.parse(request?.data || '{}'); } catch { data = {}; }
  if (data.origin !== 'order' || typeof data.orderId !== 'string') return [];
  const evidence = await orderFollowUp(env.DB, data.orderId);
  if (!evidence.eligible) return [];
  const context = await winBackContext(env, data.orderId);
  return winBackTemplates.map(t => ({ id: t.id, label: t.label, why: t.why, body: t.body(context) }));
}
/** Start (or reuse) the order conversation, tag it, and put the chosen template in as a draft. Never sends. */
export async function startWinBack(env: Env, orderId: string, templateId: string, actor: Actor): Promise<{ requestId: string }> {
  const template = winBackTemplate(templateId); if (!template) fail('Choose an email template.', 400);
  const context = await winBackContext(env, orderId);
  const first = context.items[0]?.name || 'BioMod';
  const conversation = await startOrderConversation(env, orderId, actor, { subject: `${context.firstName ? context.firstName + ', your ' : 'Your '}${first} order is saved` });
  const known = (await issuesFor(env, [conversation.requestId]))[conversation.requestId];
  if (!known) await saveRequestIssue(env, { requestId: conversation.requestId, issue: 'unfinished_checkout' }, actor);
  const draft = await env.DB.prepare('SELECT revision,status FROM request_reply_drafts WHERE request_id=?').bind(conversation.requestId).first<{ revision: number; status: string }>();
  if (draft?.status === 'sending') fail('A reply to this customer is sending right now.', 409);
  await prepareRequestReply(env, { requestId: conversation.requestId, mode: 'staff', purpose: 'checkout_recovery', body: template!.body(context), instruction: '', expectedRevision: draft?.revision ?? null }, actor);
  return { requestId: conversation.requestId };
}
