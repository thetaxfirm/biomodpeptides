// Once a day (morning, Pacific time): one email to the owner listing customers who have waited over a day
// for a reply. Internal only; customers are never emailed. Nothing is sent when nobody is waiting.
import { coaEmail, coaSender } from './coa-delivery';
import { readCoaConfig, type CoaEnvironment } from './coa-outbox';
import { looksLikePitchText } from './request-issues';
const DAY = 86400000;
const pacificDay = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const pacificHour = (now: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(now)) % 24;
export type Waiting = { name: string; email: string; subject: string; since: number; count: number };
/** Customers (grouped by email) whose newest message is over a day old with no reply from the desk, Gmail or a phone note. */
export async function overdueCustomers(env: CoaEnvironment, now = Date.now()): Promise<Waiting[]> {
  const rows = (await env.DB.prepare("SELECT r.id,r.data,r.created,(SELECT issue FROM request_issues i WHERE i.request_id=r.id) issue FROM requests r WHERE r.kind IN ('contact','affiliate','stock') AND r.status IN ('new','in_progress','reviewed') AND r.created>? ORDER BY r.created").bind(now - 60 * DAY).all<{ id: string; data: string; created: number; issue: string | null }>()).results;
  const groups = new Map<string, Waiting & { ids: string[] }>();
  for (const r of rows) {
    let d: any = {}; try { d = JSON.parse(r.data); } catch { d = {}; }
    const email = coaEmail(d.email); if (!email) continue;
    if (r.issue === 'vendor' || (!r.issue && d.origin !== 'order' && looksLikePitchText(String(d.subject || ''), String(d.message || '')))) continue;
    const g = groups.get(email) || { name: String(d.name || '').slice(0, 80), email, subject: String(d.subject || 'Website message').slice(0, 120), since: r.created, count: 0, ids: [] };
    g.count++; g.ids.push(r.id); g.since = Math.min(g.since, r.created); groups.set(email, g);
  }
  const out: Waiting[] = [];
  for (const g of groups.values()) {
    const marks = g.ids.map(() => '?').join(',');
    const answered = await env.DB.prepare(`SELECT MAX(at) at FROM (SELECT created at FROM request_reply_messages WHERE direction='outgoing' AND (request_id IN (${marks}) OR lower(recipient)=?) UNION ALL SELECT sent_at at FROM request_external_replies WHERE request_id IN (${marks}))`).bind(...g.ids, g.email, ...g.ids).first<{ at: number | null }>();
    const newest = Math.max(...rows.filter(r => g.ids.includes(r.id)).map(r => r.created));
    if (answered?.at && answered.at >= newest) continue;
    if (now - newest <= DAY && now - g.since <= DAY) continue;
    out.push({ name: g.name, email: g.email, subject: g.subject, since: g.since, count: g.count });
  }
  return out.sort((a, b) => a.since - b.since);
}
// A digest problem never fails the shared 5-minute schedule (COA and recovery mail keep running).
export async function runOverdueDigest(env: CoaEnvironment, now = Date.now(), deps: { fetch?: typeof fetch } = {}) {
  try { return await digest(env, now, deps); } catch { return { sent: false, reason: 'failed' }; }
}
async function digest(env: CoaEnvironment, now: number, deps: { fetch?: typeof fetch }) {
  if (pacificHour(now) < 8) return { sent: false, reason: 'too_early' };
  const today = pacificDay(now);
  const state = await env.DB.prepare("SELECT value FROM settings WHERE key='reply_overdue_digest_v1'").first<{ value: string }>();
  if (state?.value === today) return { sent: false, reason: 'already_today' };
  const waiting = await overdueCustomers(env, now);
  // Record the day first so a slow provider can never produce two digests.
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES('reply_overdue_digest_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(today).run();
  if (!waiting.length) return { sent: false, reason: 'nobody_waiting' };
  const owners = (env.STORE_ADMIN_EMAILS || '').split(',').map(v => coaEmail(v)).filter(Boolean) as string[];
  const to = (await readCoaConfig(env)).notifyTo || owners[0];
  const from = coaSender(env.COA_EMAIL_FROM || env.ORDER_EMAIL_FROM || 'BIOMOD <no-reply@trybiomod.com>');
  if (!to || !from || !env.RESEND_API_KEY?.trim()) return { sent: false, reason: 'mail_unconfigured' };
  const days = (since: number) => Math.max(1, Math.floor((now - since) / DAY));
  const text = [`${waiting.length} ${waiting.length === 1 ? 'customer has' : 'customers have'} waited over a day for a reply:`, '',
    ...waiting.map(w => `- ${w.name || w.email} (${w.email}): ${w.subject}${w.count > 1 ? ` (+${w.count - 1} more)` : ''}, waiting ${days(w.since)} day${days(w.since) === 1 ? '' : 's'}`),
    '', 'Reply here: https://trybiomod.com/admin?tab=requests', 'Already answered by phone or text? Open it and press Mark as replied.'].join('\n');
  const response = await (deps.fetch || fetch)('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY!.trim(), 'Content-Type': 'application/json', 'Idempotency-Key': 'reply-overdue-' + today }, body: JSON.stringify({ from, to: [to], subject: `${waiting.length} ${waiting.length === 1 ? 'customer is' : 'customers are'} waiting for a reply`, text }), redirect: 'manual', signal: AbortSignal.timeout(10000) });
  return { sent: response.ok, reason: response.ok ? 'sent' : 'provider_rejected', count: waiting.length };
}
