// Order conversations and case tracking for the reply desk. Never sends email.
import { withAuditDb } from './change-history';
import { coaEmail } from './coa-delivery';
import { isIssue, isResolution, type RequestIssue } from './request-issues';
type Env = { DB: D1Database };
type Actor = { email: string; role: string };
const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };
const UUID = /^[a-f0-9-]{36}$/;
export const orderNumber = (id: string) => '#' + id.slice(0, 8).toUpperCase();
/** Open (or reuse) a desk conversation for one order. The order context is for staff and the AI only; it is never quoted to the customer. */
export async function startOrderConversation(env: Env, orderId: string, actor: Actor): Promise<{ requestId: string; created: boolean }> {
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
  const context = [`Order ${number} placed ${new Date(order!.created).toUTCString()}.`, `Items: ${items || 'not recorded'}.`, `Order status: ${order!.status}${data.shipment?.status ? ', shipment ' + data.shipment.status : ''}.`, 'BioMod started this conversation; the customer has not written in.'].join(' ');
  const id = crypto.randomUUID();
  const record = { name: String(data.address?.name || '').slice(0, 100), email, subject: `Your BioMod order ${number}`, message: context, origin: 'order', orderId, startedBy: actor.email };
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
  const now = Date.now();
  await env.DB.prepare('INSERT INTO request_issues(request_id,issue,resolutions,note,updated,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET issue=excluded.issue,resolutions=excluded.resolutions,note=excluded.note,updated=excluded.updated,updated_by=excluded.updated_by').bind(input.requestId, input.issue, JSON.stringify(resolutions), note, now, actor.email).run();
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
