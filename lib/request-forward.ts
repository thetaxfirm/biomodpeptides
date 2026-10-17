// Forward a customer request to another BioMod team member (active staff or an owner).
// Internal only: the customer receives nothing. The forwarder is the reply-to address.
import { coaEmail, coaSender } from './coa-delivery';
type Env = Record<string, string | undefined> & { DB: D1Database };
type Actor = { email: string; role: string };
export type RequestForward = { id: string; to: string; by: string; note: string; status: 'sending' | 'unknown' | 'accepted' | 'failed'; created: number };
const DAILY_CAP = 100;
const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };
const owners = (env: Env) => (env.STORE_ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
export async function teamMembers(env: Env): Promise<{ email: string; name: string; role: string }[]> {
  let staff: { email: string; name: string | null; role: string }[] = [];
  try { staff = (await env.DB.prepare('SELECT email,name,role FROM staff WHERE active=1 ORDER BY email').all<{ email: string; name: string | null; role: string }>()).results; } catch { staff = []; }
  const list = [...owners(env).map(email => ({ email, name: '', role: 'owner' })), ...staff.map(s => ({ email: s.email.toLowerCase(), name: s.name || '', role: s.role }))];
  return list.filter((item, index) => coaEmail(item.email) && list.findIndex(other => other.email === item.email) === index);
}
export async function forwardsFor(env: Env, ids: string[]): Promise<Record<string, RequestForward[]>> {
  const out: Record<string, RequestForward[]> = {};
  const unique = [...new Set(ids)].filter(v => /^[a-f0-9-]{36}$/.test(v)).slice(0, 200);
  for (let i = 0; i < unique.length; i += 60) {
    const chunk = unique.slice(i, i + 60);
    try {
      const rows = (await env.DB.prepare(`SELECT id,request_id,to_email,by_email,note,status,created FROM request_forwards WHERE request_id IN (${chunk.map(() => '?').join(',')}) ORDER BY created`).bind(...chunk).all<any>()).results;
      for (const r of rows) (out[r.request_id] ||= []).push({ id: r.id, to: r.to_email, by: r.by_email, note: r.note, status: r.status === 'sending' ? 'unknown' : r.status, created: r.created });
    } catch { /* table not migrated yet */ }
  }
  return out;
}
const unconfirmed = 'Email status unconfirmed. Check the mail provider before retrying.';
const text = (v: unknown) => typeof v === 'string' ? v : '';
export async function forwardRequest(env: Env, input: { requestId: string; to: string; note?: string }, actor: Actor, deps: { fetch?: typeof fetch; now?: () => number } = {}): Promise<RequestForward> {
  if (!['owner', 'manager', 'support'].includes(actor.role)) fail('Forwarding is not permitted.', 403);
  if (!/^[a-f0-9-]{36}$/.test(input.requestId)) fail('Choose an existing request.', 400);
  const to = coaEmail(input.to); if (!to) fail('Choose a team member.', 400);
  if (!(await teamMembers(env)).some(m => m.email === to)) fail('You can forward only to a current BioMod team member.', 403);
  const note = text(input.note).slice(0, 2000).trim();
  const key = env.RESEND_API_KEY?.trim(), sender = coaSender(env.COA_EMAIL_FROM || env.ORDER_EMAIL_FROM || 'BIOMOD <contact@trybiomod.com>');
  if (!key || !sender) fail('Team email is not configured on the website.', 503);
  const now = (deps.now || Date.now)();
  const today = await env.DB.prepare('SELECT COUNT(*) n FROM request_forwards WHERE created>?').bind(now - 86400000).first<{ n: number }>();
  if ((today?.n || 0) >= DAILY_CAP) fail('Daily forward limit reached. Try again tomorrow.', 429);
  const request = await env.DB.prepare("SELECT id,data,created FROM requests WHERE id=? AND kind IN ('contact','affiliate','stock')").bind(input.requestId).first<{ id: string; data: string; created: number }>();
  if (!request) fail('Request not found.', 404);
  let data: Record<string, unknown> = {}; try { data = JSON.parse(request!.data); } catch { data = {}; }
  const history = (await env.DB.prepare('SELECT direction,body,created FROM request_reply_messages WHERE request_id=? ORDER BY created DESC LIMIT 6').bind(input.requestId).all<{ direction: string; body: string; created: number }>()).results.reverse();
  const plain = (v: string) => v.replace(/<blockquote[\s\S]*<\/blockquote>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  const subject = 'Fwd: ' + (text(data.subject) || 'Website message').slice(0, 150);
  const body = [
    `${actor.email} forwarded this customer request to you from TryBiomod admin.`,
    ...(note ? ['', 'Note:', note] : []),
    '', '---',
    `From: ${text(data.name) || 'Customer'} <${text(data.email)}>`,
    `Received: ${new Date(request!.created).toUTCString()}`,
    `Subject: ${text(data.subject) || 'Website message'}`,
    '', text(data.message).slice(0, 8000) || '(No message text)',
    ...history.flatMap(m => ['', '---', `${m.direction === 'incoming' ? 'Customer' : 'BioMod reply'} · ${new Date(m.created).toUTCString()}`, plain(m.body).slice(0, 4000)]),
    '', `Open it in admin: https://trybiomod.com/admin?tab=requests`,
    'Replying to this email reaches ' + actor.email + ', not the customer.',
  ].join('\n');
  const id = crypto.randomUUID();
  // Keep an unresolved attempt locked until its provider outcome is known. The
  // conditional insert is atomic, including simultaneous clicks by different staff.
  // Existing 'sending' rows also fail closed after a crash or an older uncertain send.
  const claimed = await env.DB.prepare("INSERT INTO request_forwards(id,request_id,to_email,by_email,note,status,created) SELECT ?,?,?,?,?,'sending',? WHERE NOT EXISTS (SELECT 1 FROM request_forwards WHERE request_id=? AND to_email=? AND status='sending')").bind(id, input.requestId, to, actor.email, note, now, input.requestId, to).run();
  if (!claimed.meta.changes) fail(unconfirmed);
  let status: 'sending' | 'accepted' | 'failed' = 'sending', providerId: string | null = null;
  try {
    const response = await (deps.fetch || fetch)('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': 'request-forward-' + id }, body: JSON.stringify({ from: sender, to: [to], reply_to: actor.email, subject, text: body }), redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (response.ok) { const out = await response.json() as { id?: unknown }; if (typeof out.id === 'string' && /^[a-f0-9-]{36}$/i.test(out.id)) { status = 'accepted'; providerId = out.id; } }
    // Only explicit client rejections establish that this attempt was not accepted.
    // Timeouts, conflicting idempotency results, 5xx, and unreadable responses are unknown.
    else if (response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status)) status = 'failed';
  } catch { /* A lost acknowledgement cannot establish whether the email was accepted. */ }
  try { await env.DB.prepare('UPDATE request_forwards SET status=?,provider_id=? WHERE id=?').bind(status, providerId, id).run(); }
  catch { fail(unconfirmed, 502); } // Provider may have accepted; the durable lock remains unresolved.
  if (status === 'sending') fail(unconfirmed, 502);
  if (status === 'failed') fail('The email provider rejected the forward. Correct the issue and try again.', 502);
  return { id, to: to!, by: actor.email, note, status, created: now };
}

// Everything done on a request, newest last: status changes, replies sent (and with which report), customer follow-ups, forwards.
export type RequestActivity = { at: number; text: string };
export async function activityFor(env: Env, ids: string[]): Promise<Record<string, RequestActivity[]>> {
  const out: Record<string, RequestActivity[]> = {};
  const unique = [...new Set(ids)].filter(v => /^[a-f0-9-]{36}$/.test(v)).slice(0, 200);
  const add = (id: string, at: number, text: string) => { (out[id] ||= []).push({ at, text }); };
  const statusWords: Record<string, string> = { resolved: 'Archived', spam: 'Marked as spam', deleted: 'Deleted', new: 'Moved back to To reply', in_progress: 'Opened for reply', reviewed: 'Marked reviewed' };
  for (let i = 0; i < unique.length; i += 60) {
    const chunk = unique.slice(i, i + 60), marks = chunk.map(() => '?').join(',');
    try {
      const events = (await env.DB.prepare(`SELECT entity_id,occurred_at,actor,actor_type,changes FROM change_events WHERE entity_type='request' AND action!='request.insert' AND entity_id IN (${marks}) ORDER BY occurred_at LIMIT 2000`).bind(...chunk).all<any>()).results;
      for (const e of events) {
        let changes: any[] = []; try { changes = JSON.parse(e.changes || '[]'); } catch { changes = []; }
        const status = changes.find(c => c?.field === 'Status');
        if (!status || status.after == null) continue;
        const who = e.actor === 'Jarvis reply bridge' ? 'automatically after the reply was sent' : e.actor && e.actor_type !== 'unknown' ? 'by ' + e.actor : '';
        add(e.entity_id, e.occurred_at, `${statusWords[status.after] || 'Status changed to ' + status.after}${who ? ' ' + who : ''}`);
      }
    } catch { /* history unavailable */ }
    try {
      const messages = (await env.DB.prepare(`SELECT m.request_id,m.direction,m.created,m.attachment_hash,d.coa_json,d.approved_by,d.prepared_by FROM request_reply_messages m LEFT JOIN request_reply_drafts d ON d.id=m.reply_job_id WHERE m.request_id IN (${marks}) ORDER BY m.created`).bind(...chunk).all<any>()).results;
      for (const m of messages) {
        if (m.direction === 'incoming') { add(m.request_id, m.created, 'Customer replied'); continue; }
        let file = ''; try { const coa = JSON.parse(m.coa_json || '{}'); if (m.attachment_hash && coa.sha256 === m.attachment_hash) file = coa.filename || coa.reportId || ''; } catch { file = ''; }
        const by = m.approved_by || '';
        add(m.request_id, m.created, `Reply sent${by ? ' by ' + by : ''}${m.attachment_hash ? ' with PDF ' + (file || 'report') : ''}`);
      }
    } catch { /* no replies yet */ }
    for (const [id, list] of Object.entries(await forwardsFor(env, chunk))) for (const f of list) add(id, f.created, `${f.status === 'failed' ? 'Forward failed to' : f.status === 'accepted' ? 'Forwarded to' : 'Forward status unconfirmed to'} ${f.to} by ${f.by}${f.note ? ': "' + f.note.slice(0, 140) + '"' : ''}`);
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.at - b.at);
  return out;
}
