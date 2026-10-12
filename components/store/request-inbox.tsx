'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoaAutomationReport } from './coa-automation';
import type { DeliveryStatus } from '@/lib/coa-outbox';
import styles from './request-inbox.module.css';

export type CustomerRequest = {
  id: string; kind: string; status: string; created: number;
  data: Record<string, unknown>;
};
export type ReplySummary = {
  id: string; requestId: string; revision: number;
  status: 'queued' | 'preparing' | 'ready' | 'needs_review' | 'sending' | 'sent' | 'cancelled';
  mode: 'ai' | 'staff'; sender: string; recipient: string; subject: string; body: string;
  preparedBy: string; updated: number; readyId?: string; model?: string; reason?: string;
  coa: { state: 'matched' | 'needs_review' | 'already_sent' | 'not_requested'; reason: string; productName?: string; strength?: string; lot?: string; reportId?: string; chemicalIdentity?: string; filename?: string };
  history: { id: string; direction: 'incoming' | 'outgoing'; body: string; created: number }[];
};
export type PrepareReplyInput = { id: string; mode: 'ai' | 'staff'; body?: string; instruction?: string; expectedRevision: number | null };
type Props = {
  requests: readonly CustomerRequest[];
  automation?: CoaAutomationReport | null;
  requestReplies?: Record<string, ReplySummary>;
  busy: boolean;
  dirty: boolean;
  refreshing: boolean;
  onStatus: (request: CustomerRequest, status: string) => void | Promise<void>;
  onPrepareReply: (input: PrepareReplyInput) => Promise<ReplySummary>;
};
type Draft = { body: string; instruction: string; revision: number | null; edited: boolean; error: string; message: string };
const noReplies: Record<string, ReplySummary> = {};
const sender = 'research@biomodpeptides.com';
const labels: Record<string, string> = { new: 'New', in_progress: 'In progress', reviewed: 'Reviewed', resolved: 'Resolved', spam: 'Spam' };
const replyStates: Record<ReplySummary['status'], string> = { queued: 'Queued for preparation', preparing: 'Preparing draft', ready: 'Ready for Ash’s review in Jarvis', needs_review: 'Needs review', sending: 'Sending approved reply from Jarvis', sent: 'Accepted by mail provider', cancelled: 'Draft cancelled' };
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function usableEmail(value: unknown) {
  const email = text(value);
  return email.length <= 254 && /^[^\s@<>,;?&#%]+@[^\s@<>,;?&#%]+\.[^\s@<>,;?&#%]+$/.test(email);
}
function newDraft(reply?: ReplySummary): Draft {
  return { body: reply?.body || '', instruction: '', revision: reply?.revision ?? null, edited: false, error: '', message: '' };
}
function newestReply(remote?: ReplySummary, local?: ReplySummary) {
  if (!remote) return local;
  if (!local) return remote;
  return remote.revision > local.revision || (remote.revision === local.revision && remote.updated >= local.updated) ? remote : local;
}
function timestamp(value: number) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Time unavailable'; }
function websiteLink(value: unknown) {
  try { const url = new URL(text(value)); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function coaSummary(coa: DeliveryStatus) {
  if (coa.status === 'accepted') return 'COA email accepted by the mail provider. Inbox delivery is not confirmed; do not resend.';
  if (coa.status === 'duplicate') return coa.relatedStatus === 'accepted'
    ? 'The same COA was already accepted for an earlier request from this customer. No resend is needed; inbox delivery is not confirmed.'
    : 'This COA has an earlier email record. Check the email activity below before taking action; do not send another copy.';
  if (coa.status === 'queued') return 'This earlier COA email is held for owner review. Prepare a reply for Ash to review in Jarvis.';
  if (coa.status === 'sending') return 'An earlier COA email has a sending record. Confirm its outcome before preparing another attachment; inbox delivery is not confirmed.';
  if (coa.status === 'ready' && coa.canProcess && coa.reportId) return 'An approved original was recorded for this request. Prepare a reply to recheck the match for Ash’s review.';
  return 'The COA needs a manual review. Check the exact product, strength, lot and original report before replying.';
}

export function RequestInbox({ requests, automation, requestReplies = noReplies, busy, dirty, refreshing, onStatus, onPrepareReply }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preparedReplies, setPreparedReplies] = useState<Record<string, ReplySummary>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const pendingIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const currentReplies = useRef(requestReplies);
  currentReplies.current = requestReplies;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setDrafts(previous => {
      let changed = false;
      const next = { ...previous };
      for (const [id, draft] of Object.entries(previous)) {
        const reply = newestReply(requestReplies[id], preparedReplies[id]);
        if (!draft.edited && reply && (draft.revision !== reply.revision || draft.body !== (reply.body || ''))) {
          next[id] = { ...newDraft(reply), message: draft.message }; changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [requestReplies, preparedReplies]);
  const [filter, setFilter] = useState('attention');
  const [query, setQuery] = useState('');
  const disabled = busy || dirty || refreshing;
  function openReply(id: string) {
    const reply = newestReply(requestReplies[id], preparedReplies[id]);
    setDrafts(previous => ({ ...previous, [id]: previous[id]?.edited ? previous[id] : newDraft(reply) }));
    setExpanded(current => current === id ? null : id);
  }
  function editDraft(id: string, field: 'body' | 'instruction', value: string) {
    if (disabled || pendingIds.current.has(id) || newestReply(requestReplies[id], preparedReplies[id])?.status === 'sending') return;
    setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] || newDraft()), [field]: value, edited: true, error: '', message: '' } }));
  }
  async function prepareReply(request: CustomerRequest, mode: 'ai' | 'staff') {
    const id = request.id, draft = drafts[id];
    if (disabled || pendingIds.current.has(id) || !draft || !usableEmail(request.data.email)) return;
    const latest = newestReply(requestReplies[id], preparedReplies[id]);
    if (latest?.status === 'sending' || (latest?.revision ?? null) !== draft.revision) return;
    if (mode === 'staff' && !draft.body.trim()) {
      setDrafts(previous => ({ ...previous, [id]: { ...previous[id], error: 'Write a reply before saving it for review.' } })); return;
    }
    pendingIds.current.add(id); setPending(previous => ({ ...previous, [id]: true }));
    setDrafts(previous => ({ ...previous, [id]: { ...previous[id], error: '', message: '' } }));
    try {
      const reply = await onPrepareReply({ id, mode, body: draft.body, instruction: draft.instruction, expectedRevision: draft.revision });
      if (!mounted.current) return;
      setPreparedReplies(previous => ({ ...previous, [id]: reply }));
      const newer = currentReplies.current[id];
      setDrafts(previous => ({ ...previous, [id]: newer && newer.revision > reply.revision
        ? { ...previous[id], edited: true, error: '', message: 'This reply was saved, but a newer revision is now available. Review it before making further changes.' }
        : { ...newDraft(reply), message: 'Reply saved for preparation and review. Saving a draft does not send email.' } }));
    } catch (error) {
      if (mounted.current) setDrafts(previous => ({ ...previous, [id]: { ...previous[id], error: error instanceof Error ? error.message : 'Could not prepare the reply. Your text is still here. Refresh administration and try again.' } }));
    } finally {
      pendingIds.current.delete(id);
      if (mounted.current) setPending(previous => ({ ...previous, [id]: false }));
    }
  }
  const attention = requests.filter(r => !['resolved', 'spam'].includes(r.status));
  const views = [ ['attention', 'Needs attention', attention.length], ['all', 'All', requests.length], ['resolved', 'Resolved', requests.filter(r => r.status === 'resolved').length], ['spam', 'Spam', requests.filter(r => r.status === 'spam').length] ] as const;
  const needle = query.trim().toLowerCase();
  const shown = requests.filter(request => (filter === 'all' || (filter === 'attention' ? !['resolved', 'spam'].includes(request.status) : request.status === filter)) && (!needle || [request.id, request.kind, ...Object.values(request.data).filter(value => typeof value === 'string')].join(' ').toLowerCase().includes(needle)));
  return <section className={styles.inbox} aria-labelledby="request-inbox-title" aria-busy={busy || refreshing}>
    <h2 id="request-inbox-title">Customer requests</h2>
    <p>Prepare an AI or staff-written reply here. Ash reviews and sends it from Jarvis Ready to Send. Status buttons organize this inbox; they do not send a reply, approve an affiliate or change an order.</p>
    <div className={styles.toolbar}>
      <div className={styles.filters} role="group" aria-label="Filter customer requests">{views.map(([value, label, count]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span>{count}</span></button>)}</div>
      <label className={styles.search}><span>Find a request</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, email, subject or reference"/></label>
    </div>
    <p className={styles.note}>{shown.length} shown from {requests.length} loaded requests. Refresh administration for current information.</p>
    {dirty && <p role="status">Save or discard your unsaved admin edits before changing a request.</p>}
    {!shown.length ? <p className={styles.empty}>{requests.length ? 'No requests match this view.' : 'No customer requests yet.'}</p> : <div className={styles.list}>{shown.map(request => {
      const email = text(request.data.email);
      const reply = newestReply(requestReplies[request.id], preparedReplies[request.id]);
      const draft = drafts[request.id];
      const editing = expanded === request.id && draft;
      const preparing = Boolean(pending[request.id]);
      const locked = disabled || preparing || reply?.status === 'sending';
      const conflict = Boolean(draft && draft.revision !== (reply?.revision ?? null));
      const canReply = usableEmail(request.data.email);
      const replyAction = reply?.status === 'sending' ? 'View sending status' : preparing || reply?.status === 'queued' || reply?.status === 'preparing' ? 'Preparing reply' : reply?.status === 'ready' ? 'Ready to send' : reply?.status === 'sent' ? 'View reply / follow up' : 'Prepare reply';
      const website = websiteLink(request.data.website);
      const delivery = automation?.requests?.[request.id];
      const coa = delivery?.coa;
      const category = request.kind === 'affiliate' ? 'Affiliate application' : request.kind === 'stock' ? 'Stock notification request' : coa ? 'COA request' : 'Customer message';
      const name = text(request.data.name) || email || 'Customer request';
      const subject = text(request.data.subject) || (request.kind === 'affiliate' ? 'Partner application' : request.kind === 'stock' ? 'Product availability' : 'Website message');
      const date = new Date(request.created);
      return <article className={styles.request} key={request.id} aria-label={name + ': ' + subject}>
        <div className={styles.heading}><div><p className={styles.category}>{category}</p><h3>{name}</h3><p className={styles.subject}>{subject}</p></div><div className={styles.headingActions}><strong className={styles.status}>{labels[request.status] || 'Needs review'}</strong><button type="button" className="button button-dark" aria-expanded={expanded === request.id} aria-controls={`request-reply-${request.id}`} disabled={!canReply} onClick={() => openReply(request.id)}>{replyAction}</button></div></div>
        <p className={styles.note}>{Number.isFinite(date.getTime()) && <><time dateTime={date.toISOString()}>{date.toLocaleString()}</time> · </>}Reference {request.id.slice(0, 8)}</p>
        {email && <p className={styles.email}>{email}</p>}
        {text(request.data.message) && <p className={styles.message}>{text(request.data.message)}</p>}
        {website && <p><a href={website} target="_blank" rel="noopener noreferrer">View applicant’s website or profile</a></p>}
        {coa && <div className={styles.coa}><h4>COA email</h4><p>{coaSummary(coa)}</p>{(coa.productName || coa.lot) && <p className={styles.note}>{coa.productName}{coa.lot ? ' · Lot ' + coa.lot : ''}</p>}</div>}
        {request.kind === 'affiliate' && <p className={styles.note}>Review the application before agreeing to terms or assigning a code. Approved codes are managed under Affiliate &amp; promo codes.</p>}
        {request.kind === 'stock' && <p className={styles.note}>Check current product availability before replying. Changing this status does not send a stock notification.</p>}
        {delivery?.alert?.status === 'accepted' && <p className={styles.note}>Your request notification was accepted by the mail provider. That alert is not a reply to the customer.</p>}
        <div className={styles.actions}>
          {!['resolved', 'spam'].includes(request.status) ? <>
            {request.status !== 'in_progress' && <button type="button" className={styles.action} disabled={disabled} onClick={() => { if (!disabled) void onStatus(request, 'in_progress'); }}>Start review</button>}
            <button type="button" className={styles.action} disabled={disabled} onClick={() => { if (!disabled) void onStatus(request, 'resolved'); }}>Mark resolved</button>
          </> : <button type="button" className={styles.action} disabled={disabled} onClick={() => { if (!disabled) void onStatus(request, 'new'); }}>Reopen request</button>}
          {request.status !== 'spam' && <button type="button" className={styles.quietAction} disabled={disabled} onClick={() => { if (!disabled) void onStatus(request, 'spam'); }}>Move to spam</button>}
        </div>
        <p className={styles.note}>{!canReply ? 'No usable email address is saved for this request.' : 'Replies are prepared here and sent only after Ash’s review in Jarvis.'} {request.status === 'spam' ? 'Spam is kept here and can be reopened.' : 'Mark resolved after replying or confirming no further action is needed.'}</p>
        {editing && <section className={styles.replyEditor} id={`request-reply-${request.id}`} aria-label={`Reply editor for ${name}`} aria-busy={preparing}>
          <div className={styles.editorHeading}><h4>Prepare a reply</h4><button type="button" className={styles.quietAction} onClick={() => setExpanded(null)}>Close editor</button></div>
          <p className={styles.note}>Nothing sends from this page. Review the final reply and any original COA in Jarvis Ready to Send.</p>
          <dl className={styles.addresses}><div><dt>From</dt><dd>{sender}</dd></div><div><dt>To</dt><dd>{reply?.recipient || email}</dd></div><div><dt>Subject</dt><dd>{reply?.subject || (/^re:/i.test(subject) ? subject : `Re: ${subject}`)}</dd></div></dl>
          {reply && <p className={styles.replyState}><strong>{replyStates[reply.status]}</strong> · Revision {reply.revision}{reply.preparedBy ? ` · Prepared by ${reply.preparedBy}` : ''} · {timestamp(reply.updated)}{reply.status === 'sent' && <span> Provider acceptance does not confirm inbox delivery.</span>}</p>}
          {reply?.reason && <p className={styles.note}>{reply.reason}</p>}
          <div className={styles.replyColumns}>
            <section className={styles.incoming}><h5>Original customer message</h5><strong>{subject}</strong><p className={styles.message}>{text(request.data.message) || 'No message text was included.'}</p>
              {reply?.history?.length ? <details className={styles.history}><summary>Conversation history ({reply.history.length})</summary>{reply.history.map(item => <article key={item.id}><strong>{item.direction === 'incoming' ? 'Customer message' : 'Outgoing message'}</strong><p className={styles.note}>{timestamp(item.created)}</p><p className={styles.message}>{item.body}</p></article>)}</details> : null}
            </section>
            <div className={styles.composer}>
              <label><span>Proposed reply</span><textarea name="replyBody" rows={10} maxLength={12000} value={draft.body} disabled={locked} onChange={event => editDraft(request.id, 'body', event.target.value)} placeholder="Write a reply, or ask AI to prepare one for review."/></label>
              <label><span>Instructions for AI (optional)</span><textarea name="replyInstruction" rows={3} maxLength={2000} value={draft.instruction} disabled={locked} onChange={event => editDraft(request.id, 'instruction', event.target.value)} placeholder="Add facts or guidance for the draft. Verify the proposed reply before sending."/></label>
            </div>
          </div>
          <div className={styles.coa}><h5>Original COA for this reply</h5>
            {!reply ? <p>The exact product, strength, lot and original report will be checked when the reply is prepared. No attachment is confirmed yet.</p> : <><p><strong>{reply.coa.state === 'matched' ? 'Exact original matched for review' : reply.coa.state === 'already_sent' ? 'Earlier COA delivery recorded' : reply.coa.state === 'needs_review' ? 'COA needs review' : 'No COA requested'}</strong></p><p>{reply.coa.reason}</p>{(reply.coa.productName || reply.coa.strength || reply.coa.lot || reply.coa.reportId) && <dl className={styles.coaFacts}>{[['Product', reply.coa.productName], ['Chemical identity', reply.coa.chemicalIdentity], ['Strength', reply.coa.strength], ['Lot', reply.coa.lot], ['Report', reply.coa.reportId], ['Original file', reply.coa.filename]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}{reply.coa.state === 'matched' && <p className={styles.note}>The original attachment is checked again before sending. A match is not proof that an email was sent.</p>}</>}
          </div>
          {conflict && <div className={styles.conflict} role="alert"><h5>A newer reply exists</h5><p>Your text is preserved. Review revision {reply?.revision} before replacing it.</p><p className={styles.message}>{reply?.body || 'The newer reply is still being prepared.'}</p><div className={styles.actions}><button type="button" className={styles.action} disabled={locked} onClick={() => { if (!locked) setDrafts(previous => ({ ...previous, [request.id]: newDraft(reply) })); }}>Replace my text with latest draft</button><button type="button" className={styles.action} disabled={locked} onClick={() => { if (!locked) setDrafts(previous => ({ ...previous, [request.id]: { ...previous[request.id], revision: reply?.revision ?? null, error: '', message: '' } })); }}>Keep my text for a new revision</button></div></div>}
          {draft.error && <p className={styles.error} role="alert">{draft.error} Your draft text has been kept.</p>}
          {draft.message && <p role="status">{draft.message}</p>}
          <div className={styles.actions}><button type="button" className={styles.action} disabled={locked || conflict} onClick={() => void prepareReply(request, 'ai')}>{preparing ? 'Preparing…' : 'Ask AI to draft'}</button><button type="button" className="button button-dark" disabled={locked || conflict} onClick={() => void prepareReply(request, 'staff')}>Save reply for Ash’s review</button></div>
          <p className={styles.note}>Saving a replacement creates a new revision and invalidates the earlier Jarvis draft. Request status stays separate.</p>
        </section>}
        <details className={styles.original}><summary>Saved request details</summary>{Object.entries(request.data).map(([key, value]) => <p key={key}><strong>{key}: </strong>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')}</p>)}</details>
      </article>;
    })}</div>}
  </section>;
}
