'use client';

import { useState } from 'react';
import type { CoaAutomationReport } from './coa-automation';
import type { DeliveryStatus } from '@/lib/coa-outbox';
import styles from './request-inbox.module.css';

export type CustomerRequest = {
  id: string; kind: string; status: string; created: number;
  data: Record<string, unknown>;
};
type Props = {
  requests: readonly CustomerRequest[];
  automation?: CoaAutomationReport | null;
  busy: boolean;
  dirty: boolean;
  refreshing: boolean;
  onStatus: (request: CustomerRequest, status: string) => void | Promise<void>;
  onProcess: (id: string) => void | Promise<void>;
};
const labels: Record<string, string> = { new: 'New', in_progress: 'In progress', reviewed: 'Reviewed', resolved: 'Resolved', spam: 'Spam' };
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function replyLink(request: CustomerRequest) {
  const email = text(request.data.email);
  if (email.length > 254 || !/^[^\s@<>,;?&#%]+@[^\s@<>,;?&#%]+\.[^\s@<>,;?&#%]+$/.test(email)) return null;
  const subject = text(request.data.subject).replace(/[\r\n]/g, ' ').slice(0, 200) || (request.kind === 'affiliate' ? 'Your BIOMOD partner application' : 'Your BIOMOD request');
  return 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(/^re:/i.test(subject) ? subject : 'Re: ' + subject);
}
function websiteLink(value: unknown) {
  try { const url = new URL(text(value)); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function coaSummary(coa: DeliveryStatus) {
  if (coa.status === 'accepted') return 'COA email accepted by the mail provider. Inbox delivery is not confirmed; do not resend.';
  if (coa.status === 'duplicate') return coa.relatedStatus === 'accepted'
    ? 'The same COA was already accepted for an earlier request from this customer. No resend is needed; inbox delivery is not confirmed.'
    : 'This COA has an earlier email record. Check the email activity below before taking action; do not send another copy.';
  if (coa.status === 'queued' || coa.status === 'sending') return 'COA email processing is pending. Refresh administration to check its progress.';
  if (coa.status === 'ready' && coa.canProcess && coa.reportId) return 'An approved original matches this request. It is ready to send.';
  return 'The COA needs a manual review. Check the exact product, strength, lot and original report before replying.';
}

export function RequestInbox({ requests, automation, busy, dirty, refreshing, onStatus, onProcess }: Props) {
  const [filter, setFilter] = useState('attention');
  const [query, setQuery] = useState('');
  const disabled = busy || dirty || refreshing;
  const attention = requests.filter(r => !['resolved', 'spam'].includes(r.status));
  const views = [ ['attention', 'Needs attention', attention.length], ['all', 'All', requests.length], ['resolved', 'Resolved', requests.filter(r => r.status === 'resolved').length], ['spam', 'Spam', requests.filter(r => r.status === 'spam').length] ] as const;
  const needle = query.trim().toLowerCase();
  const shown = requests.filter(request => (filter === 'all' || (filter === 'attention' ? !['resolved', 'spam'].includes(request.status) : request.status === filter)) && (!needle || [request.id, request.kind, ...Object.values(request.data).filter(value => typeof value === 'string')].join(' ').toLowerCase().includes(needle)));
  return <section className={styles.inbox} aria-labelledby="request-inbox-title" aria-busy={busy || refreshing}>
    <h2 id="request-inbox-title">Customer requests</h2>
    <p>Open a reply in your email app, then mark the request resolved when it is handled. Status buttons organize this inbox; they do not send a reply, approve an affiliate or change an order.</p>
    <div className={styles.toolbar}>
      <div className={styles.filters} role="group" aria-label="Filter customer requests">{views.map(([value, label, count]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span>{count}</span></button>)}</div>
      <label className={styles.search}><span>Find a request</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, email, subject or reference"/></label>
    </div>
    <p className={styles.note}>{shown.length} shown from {requests.length} loaded requests. Refresh administration for current information.</p>
    {dirty && <p role="status">Save or discard your unsaved admin edits before changing a request.</p>}
    {!shown.length ? <p className={styles.empty}>{requests.length ? 'No requests match this view.' : 'No customer requests yet.'}</p> : <div className={styles.list}>{shown.map(request => {
      const email = text(request.data.email);
      const reply = replyLink(request);
      const website = websiteLink(request.data.website);
      const delivery = automation?.requests?.[request.id];
      const coa = delivery?.coa;
      const canSend = automation?.config.enabled && automation.mailConfigured && coa?.canProcess && ['ready', 'queued'].includes(coa.status) && Boolean(coa.reportId?.trim());
      const category = request.kind === 'affiliate' ? 'Affiliate application' : request.kind === 'stock' ? 'Stock notification request' : coa ? 'COA request' : 'Customer message';
      const name = text(request.data.name) || email || 'Customer request';
      const subject = text(request.data.subject) || (request.kind === 'affiliate' ? 'Partner application' : request.kind === 'stock' ? 'Product availability' : 'Website message');
      const date = new Date(request.created);
      return <article className={styles.request} key={request.id} aria-label={name + ': ' + subject}>
        <div className={styles.heading}><div><p className={styles.category}>{category}</p><h3>{name}</h3><p className={styles.subject}>{subject}</p></div><strong className={styles.status}>{labels[request.status] || 'Needs review'}</strong></div>
        <p className={styles.note}>{Number.isFinite(date.getTime()) && <><time dateTime={date.toISOString()}>{date.toLocaleString()}</time> · </>}Reference {request.id.slice(0, 8)}</p>
        {email && <p className={styles.email}>{email}</p>}
        {text(request.data.message) && <p className={styles.message}>{text(request.data.message)}</p>}
        {website && <p><a href={website} target="_blank" rel="noopener noreferrer">View applicant’s website or profile</a></p>}
        {coa && <div className={styles.coa}><h4>COA email</h4><p>{coaSummary(coa)}</p>{(coa.productName || coa.lot) && <p className={styles.note}>{coa.productName}{coa.lot ? ' · Lot ' + coa.lot : ''}</p>}{canSend && <button type="button" className="button button-dark" disabled={disabled} onClick={() => { if (!disabled) void onProcess(request.id); }}>Send matched original COA</button>}</div>}
        {request.kind === 'affiliate' && <p className={styles.note}>Review the application before agreeing to terms or assigning a code. Approved codes are managed under Affiliate &amp; promo codes.</p>}
        {request.kind === 'stock' && <p className={styles.note}>Check current product availability before replying. Changing this status does not send a stock notification.</p>}
        {delivery?.alert?.status === 'accepted' && <p className={styles.note}>Your request notification was accepted by the mail provider. That alert is not a reply to the customer.</p>}
        <div className={styles.actions}>
          {reply && <a className="button button-dark" href={reply}>Reply by email</a>}
          {!['resolved', 'spam'].includes(request.status) ? <>
            {request.status !== 'in_progress' && <button type="button" className={styles.action} disabled={disabled} onClick={() => { if (!disabled) void onStatus(request, 'in_progress'); }}>Start review</button>}
            <button type="button" className={styles.action} disabled={disabled} onClick={() => { if (!disabled) void onStatus(request, 'resolved'); }}>Mark resolved</button>
          </> : <button type="button" className={styles.action} disabled={disabled} onClick={() => { if (!disabled) void onStatus(request, 'new'); }}>Reopen request</button>}
          {request.status !== 'spam' && <button type="button" className={styles.quietAction} disabled={disabled} onClick={() => { if (!disabled) void onStatus(request, 'spam'); }}>Move to spam</button>}
        </div>
        <p className={styles.note}>{reply ? 'Reply by email opens your email app. You review and send the message there.' : 'No usable email address is saved for this request.'} {request.status === 'spam' ? 'Spam is kept here and can be reopened.' : 'Mark resolved after replying or confirming no further action is needed.'}</p>
        <details className={styles.original}><summary>Saved request details</summary>{Object.entries(request.data).map(([key, value]) => <p key={key}><strong>{key}: </strong>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')}</p>)}</details>
      </article>;
    })}</div>}
  </section>;
}
