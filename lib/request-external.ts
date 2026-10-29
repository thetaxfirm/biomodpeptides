// Replies made outside the reply desk: a connected mailbox (found by Jarvis) or a staff note (phone, text).
// They mark a request as answered so nobody replies twice. Never sends anything.
import { coaEmail, coaHash } from './coa-delivery';
import { withAuditDb } from './change-history';
type Env = { DB: D1Database };
type Actor = { email: string; role: string };
export type ExternalReply = { at: number; source: 'mailbox' | 'manual'; account: string; body: string; preview: boolean; verified: boolean };
const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };
const UUID = /^[a-f0-9-]{36}$/;
const VERIFIED_MAILBOX = 'Jarvis exact conversation check';
const BUSINESS_SENDERS = new Set(['contact@trybiomod.com', 'research@biomodpeptides.com']);
const subjectKey = (value: unknown) => typeof value === 'string' ? value.replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase() : '';
const requestData = (raw: string): Record<string, unknown> => { try { return JSON.parse(raw); } catch { return {}; } };
/** Run before inserting the newly verified answer, in the same transaction. A repeated
 * mailbox receipt must never retire a newer draft prepared after the first import. */
function answeredStateStatements(db: D1Database, requestId: string, externalId: string, sentAt: number, now: number): D1PreparedStatement[] {
  const fresh = "NOT EXISTS(SELECT 1 FROM request_external_replies previous WHERE previous.id=? AND (previous.source='manual' OR previous.recorded_by='Jarvis exact conversation check'))";
  // A delayed mailbox discovery is useful history, but does not answer a newer question.
  // Equal incoming/provider timestamps are ambiguous, so keep the case open for review.
  const answered = "EXISTS(SELECT 1 FROM requests source WHERE source.id=? AND source.status NOT IN ('spam','deleted') AND source.created<=? AND NOT EXISTS(SELECT 1 FROM request_reply_messages incoming WHERE incoming.request_id=source.id AND incoming.direction='incoming' AND incoming.created>=?))";
  return [
    db.prepare(`UPDATE request_reply_drafts SET status='needs_review',revision=revision+1,ready_id=NULL,approved_at=NULL,approved_by=NULL,lease_token=NULL,lease_until=NULL,reason='answered_elsewhere',updated=? WHERE request_id=? AND status IN ('queued','preparing','ready','needs_review') AND send_locked_at IS NULL AND ${fresh} AND ${answered}`).bind(now, requestId, externalId, requestId, sentAt, sentAt),
    db.prepare(`UPDATE requests SET status='resolved' WHERE id=? AND status NOT IN ('spam','deleted','resolved') AND ${fresh} AND ${answered}`).bind(requestId, externalId, requestId, sentAt, sentAt),
  ];
}
/** Open requests Jarvis should look for in the mailboxes: recent, not spam/deleted. */
export async function openRequestsForBridge(env: Env) {
  const rows = (await env.DB.prepare("SELECT id,data,created FROM requests WHERE kind IN ('contact','affiliate','stock') AND status NOT IN ('spam','deleted') AND created>? ORDER BY created DESC LIMIT 300").bind(Date.now() - 60 * 86400000).all<{ id: string; data: string; created: number }>()).results;
  return rows.flatMap(r => { let d: any = {}; try { d = JSON.parse(r.data); } catch { d = {}; } const email = coaEmail(d.email); return email ? [{ id: r.id, email, subject: typeof d.subject === 'string' ? d.subject : '', created: r.created }] : []; });
}
export async function recordMailboxReplies(env: Env, replies: unknown) {
  if (!Array.isArray(replies) || replies.length > 50) fail('Send at most 50 replies.', 400);
  let saved = 0;
  for (const raw of replies as any[]) {
    if (!raw || typeof raw !== 'object' || !UUID.test(raw.requestId) || typeof raw.messageId !== 'string' || !raw.messageId || raw.messageId.length > 300 || !coaEmail(raw.account) || !Number.isSafeInteger(raw.sentAt) || typeof raw.body !== 'string') fail('Invalid reply.', 400);
    const request = await env.DB.prepare("SELECT created,data,status FROM requests WHERE id=?").bind(raw.requestId).first<{ created: number; data: string; status: string }>();
    if (!request || ['spam', 'deleted'].includes(request.status) || raw.sentAt < request.created - 60000 || raw.sentAt > Date.now() + 300000) continue;
    const data = requestData(request.data), recipient = coaEmail(data.email), subject = subjectKey(data.subject);
    if (!recipient || coaEmail(raw.recipient) !== recipient || !BUSINESS_SENDERS.has(coaEmail(raw.account) || '') || !subject || subjectKey(raw.subject) !== subject) continue;
    // Email address alone cannot tell which issue a message answered. Ambiguous
    // same-subject requests remain unlinked rather than closing both.
    const candidates = (await env.DB.prepare("SELECT id,data FROM requests WHERE kind IN ('contact','affiliate','stock') AND status NOT IN ('spam','deleted') AND lower(trim(json_extract(data,'$.email')))=? AND created<=?").bind(recipient, raw.sentAt + 60000).all<{ id: string; data: string }>()).results;
    if (candidates.filter(r => subjectKey(requestData(r.data).subject) === subject).length !== 1) continue;
    // Desk sends are already in the conversation.
    if (await env.DB.prepare('SELECT 1 FROM request_reply_messages WHERE provider_message_id=? LIMIT 1').bind(raw.messageId).first()) continue;
    const id = await coaHash('mailbox:' + raw.account + ':' + raw.messageId + ':' + raw.requestId);
    const existing = await env.DB.prepare('SELECT request_id,source,account,message_id,sent_at FROM request_external_replies WHERE id=?').bind(id).first<{request_id:string;source:string;account:string;message_id:string;sent_at:number}>();
    if (existing && (existing.request_id !== raw.requestId || existing.source !== 'mailbox' || coaEmail(existing.account) !== coaEmail(raw.account) || existing.message_id !== raw.messageId || existing.sent_at !== raw.sentAt)) fail('This mailbox receipt conflicts with the saved message.');
    const now = Date.now(), db = withAuditDb(env.DB, {source:'system',actor:'Jarvis exact conversation check',actorType:'system'});
    const result = await db.batch([
      ...answeredStateStatements(db, raw.requestId, id, raw.sentAt, now),
      db.prepare("INSERT OR IGNORE INTO request_external_replies(id,request_id,source,account,message_id,sent_at,body,preview,recorded_by,created) VALUES(?,?,'mailbox',?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET recorded_by=excluded.recorded_by WHERE request_external_replies.recorded_by!=excluded.recorded_by").bind(id, raw.requestId, coaEmail(raw.account), raw.messageId, raw.sentAt, raw.body.slice(0, 20000), raw.preview ? 1 : 0, VERIFIED_MAILBOX, now),
    ]);
    saved += result[result.length - 1].meta.changes || 0;
  }
  return { ok: true, saved };
}
export async function markReplied(env: Env, input: { requestId: string; note?: string }, actor: Actor) {
  if (!['owner', 'manager', 'support'].includes(actor.role)) fail('Not permitted.', 403);
  if (!UUID.test(input.requestId)) fail('Choose an existing request.', 400);
  if (!(await env.DB.prepare("SELECT 1 FROM requests WHERE id=?").bind(input.requestId).first())) fail('Request not found.', 404);
  const note = (typeof input.note === 'string' ? input.note.slice(0, 1000).trim() : '') || 'Replied outside email (phone or text).';
  const now = Date.now(), id = crypto.randomUUID(), db = withAuditDb(env.DB, {source:'admin',actor:actor.email,actorType:'staff'});
  await db.batch([
    ...answeredStateStatements(db, input.requestId, id, now, now),
    db.prepare("INSERT INTO request_external_replies(id,request_id,source,account,message_id,sent_at,body,preview,recorded_by,created) VALUES(?,?,'manual',?,NULL,?,?,0,?,?)").bind(id, input.requestId, actor.email, now, note, actor.email, now),
  ]);
  return { at: now, source: 'manual' as const, account: actor.email, body: note, preview: false, verified: true };
}
export async function externalRepliesFor(env: Env, ids: string[]): Promise<Record<string, ExternalReply[]>> {
  const out: Record<string, ExternalReply[]> = {};
  const unique = [...new Set(ids)].filter(v => UUID.test(v)).slice(0, 200);
  for (let i = 0; i < unique.length; i += 60) {
    const chunk = unique.slice(i, i + 60);
    try {
      const rows = (await env.DB.prepare(`SELECT request_id,source,account,sent_at,body,preview,recorded_by FROM request_external_replies WHERE request_id IN (${chunk.map(() => '?').join(',')}) ORDER BY sent_at`).bind(...chunk).all<any>()).results;
      for (const r of rows) (out[r.request_id] ||= []).push({ at: r.sent_at, source: r.source, account: r.account, body: r.body, preview: Boolean(r.preview), verified: r.source === 'manual' || r.recorded_by === VERIFIED_MAILBOX });
    } catch { /* not migrated yet */ }
  }
  return out;
}
