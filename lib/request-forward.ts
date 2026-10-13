// Forward a customer request to another BioMod team member (active staff or an owner).
// Internal only: the customer receives nothing. The forwarder is the reply-to address.
import { coaEmail, coaSender } from './coa-delivery';
type Env = Record<string, string | undefined> & { DB: D1Database };
type Actor = { email: string; role: string };
export type RequestForward = { id: string; to: string; by: string; note: string; status: 'sending' | 'accepted' | 'failed'; created: number };
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
      for (const r of rows) (out[r.request_id] ||= []).push({ id: r.id, to: r.to_email, by: r.by_email, note: r.note, status: r.status, created: r.created });
    } catch { /* table not migrated yet */ }
  }
  return out;
}
const text = (v: unknown) => typeof v === 'string' ? v : '';
export async function forwardRequest(env: Env, input: { requestId: string; to: string; note?: string }, actor: Actor, deps: { fetch?: typeof fetch; now?: () => number } = {}): Promise<RequestForward> {
  if (!['owner', 'manager', 'support'].includes(actor.role)) fail('Forwarding is not permitted.', 403);
  if (!/^[a-f0-9-]{36}$/.test(input.requestId)) fail('Choose an existing request.', 400);
  const to = coaEmail(input.to); if (!to) fail('Choose a team member.', 400);
  if (!(await teamMembers(env)).some(m => m.email === to)) fail('You can forward only to a current BioMod team member.', 403);
  const note = text(input.note).slice(0, 2000).trim();
  const key = env.RESEND_API_KEY?.trim(), sender = coaSender(env.COA_EMAIL_FROM || env.ORDER_EMAIL_FROM || 'BIOMOD <no-reply@trybiomod.com>');
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
  await env.DB.prepare("INSERT INTO request_forwards(id,request_id,to_email,by_email,note,status,created) VALUES(?,?,?,?,?,'sending',?)").bind(id, input.requestId, to, actor.email, note, now).run();
  let status: RequestForward['status'] = 'failed', providerId: string | null = null;
  try {
    const response = await (deps.fetch || fetch)('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': 'request-forward-' + id }, body: JSON.stringify({ from: sender, to: [to], reply_to: actor.email, subject, text: body }), redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (response.ok) { const out = await response.json() as { id?: unknown }; if (typeof out.id === 'string') { status = 'accepted'; providerId = out.id.slice(0, 100); } }
  } catch { status = 'failed'; }
  await env.DB.prepare('UPDATE request_forwards SET status=?,provider_id=? WHERE id=?').bind(status, providerId, id).run();
  if (status === 'failed') fail('The forward did not go out. Try again in a minute.', 502);
  return { id, to: to!, by: actor.email, note, status, created: now };
}
