// Replies made outside the reply desk: a connected mailbox (found by Jarvis) or a staff note (phone, text).
// They mark a request as answered so nobody replies twice. Never sends anything.
import { coaEmail, coaHash } from './coa-delivery';
type Env = { DB: D1Database };
type Actor = { email: string; role: string };
export type ExternalReply = { at: number; source: 'mailbox' | 'manual'; account: string; body: string; preview: boolean };
const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };
const UUID = /^[a-f0-9-]{36}$/;
/** Open requests Jarvis should look for in the mailboxes: recent, not spam/deleted. */
export async function openRequestsForBridge(env: Env) {
  const rows = (await env.DB.prepare("SELECT id,data,created FROM requests WHERE kind IN ('contact','affiliate','stock') AND status NOT IN ('spam','deleted') AND created>? ORDER BY created DESC LIMIT 300").bind(Date.now() - 60 * 86400000).all<{ id: string; data: string; created: number }>()).results;
  return rows.flatMap(r => { let d: any = {}; try { d = JSON.parse(r.data); } catch { d = {}; } const email = coaEmail(d.email); return email ? [{ id: r.id, email, created: r.created }] : []; });
}
export async function recordMailboxReplies(env: Env, replies: unknown) {
  if (!Array.isArray(replies) || replies.length > 50) fail('Send at most 50 replies.', 400);
  let saved = 0;
  for (const raw of replies as any[]) {
    if (!raw || typeof raw !== 'object' || !UUID.test(raw.requestId) || typeof raw.messageId !== 'string' || !raw.messageId || raw.messageId.length > 300 || !coaEmail(raw.account) || !Number.isSafeInteger(raw.sentAt) || typeof raw.body !== 'string') fail('Invalid reply.', 400);
    const request = await env.DB.prepare("SELECT created FROM requests WHERE id=?").bind(raw.requestId).first<{ created: number }>();
    if (!request || raw.sentAt < request.created - 60000 || raw.sentAt > Date.now() + 300000) continue;
    // Desk sends are already in the conversation.
    if (await env.DB.prepare('SELECT 1 FROM request_reply_messages WHERE provider_message_id=? LIMIT 1').bind(raw.messageId).first()) continue;
    const id = await coaHash('mailbox:' + raw.account + ':' + raw.messageId + ':' + raw.requestId);
    const r = await env.DB.prepare("INSERT OR IGNORE INTO request_external_replies(id,request_id,source,account,message_id,sent_at,body,preview,recorded_by,created) VALUES(?,?,'mailbox',?,?,?,?,?,'Jarvis mailbox check',?)").bind(id, raw.requestId, coaEmail(raw.account), raw.messageId, raw.sentAt, raw.body.slice(0, 20000), raw.preview ? 1 : 0, Date.now()).run();
    saved += r.meta.changes || 0;
  }
  return { ok: true, saved };
}
export async function markReplied(env: Env, input: { requestId: string; note?: string }, actor: Actor) {
  if (!['owner', 'manager', 'support'].includes(actor.role)) fail('Not permitted.', 403);
  if (!UUID.test(input.requestId)) fail('Choose an existing request.', 400);
  if (!(await env.DB.prepare("SELECT 1 FROM requests WHERE id=?").bind(input.requestId).first())) fail('Request not found.', 404);
  const note = (typeof input.note === 'string' ? input.note.slice(0, 1000).trim() : '') || 'Replied outside email (phone or text).';
  const now = Date.now();
  await env.DB.prepare("INSERT INTO request_external_replies(id,request_id,source,account,message_id,sent_at,body,preview,recorded_by,created) VALUES(?,?,'manual',?,NULL,?,?,0,?,?)").bind(crypto.randomUUID(), input.requestId, actor.email, now, note, actor.email, now).run();
  return { at: now, source: 'manual' as const, account: actor.email, body: note, preview: false };
}
export async function externalRepliesFor(env: Env, ids: string[]): Promise<Record<string, ExternalReply[]>> {
  const out: Record<string, ExternalReply[]> = {};
  const unique = [...new Set(ids)].filter(v => UUID.test(v)).slice(0, 200);
  for (let i = 0; i < unique.length; i += 60) {
    const chunk = unique.slice(i, i + 60);
    try {
      const rows = (await env.DB.prepare(`SELECT request_id,source,account,sent_at,body,preview FROM request_external_replies WHERE request_id IN (${chunk.map(() => '?').join(',')}) ORDER BY sent_at`).bind(...chunk).all<any>()).results;
      for (const r of rows) (out[r.request_id] ||= []).push({ at: r.sent_at, source: r.source, account: r.account, body: r.body, preview: Boolean(r.preview) });
    } catch { /* not migrated yet */ }
  }
  return out;
}
