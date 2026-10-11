'use client';

import type { FormEvent } from 'react';
import type { CoaAutomationStatus, DeliveryStatus } from '@/lib/coa-outbox';
import styles from './coa-automation.module.css';

export type CoaAutomationReport = CoaAutomationStatus;
type RequestContext = { id: string; kind?: string; created?: number; data?: { name?: unknown; email?: unknown; subject?: unknown } };
type Props = {
  report?: CoaAutomationReport | null;
  requests?: readonly RequestContext[];
  busy: boolean;
  dirty: boolean;
  refreshing: boolean;
  onDraft: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onProcess: (id: string) => void | Promise<void>;
};
const statusLabels: Record<DeliveryStatus['status'], string> = {
  ready: 'Ready to send', queued: 'Queued', sending: 'Sending', accepted: 'Accepted by mail provider',
  manual_review: 'Review needed', duplicate: 'Duplicate request',
};
const reasonLabels: Record<string, string> = {
  ready: 'The original report is matched and ready.',
  sending: 'The message is being submitted to the mail provider.',
  invalid_recipient: 'The request needs a valid recipient email before it can be sent.',
  no_exact_original: 'No approved original matches this request. Review it before responding.',
  sender_unavailable: 'The sending address is not configured correctly.',
  same_original_already_queued_or_accepted: 'The same original report for this recipient is already queued or accepted. It will not be sent again.',
  same_original_already_queued_accepted_or_under_review: 'The same original report for this recipient is already queued, accepted or under review. It will not be sent again.',
  daily_limit: 'The daily sending limit was reached. Review this request.',
  retry_window_expired: 'The safe retry window expired. Review the mail status before any further action.',
  snapshot_integrity_failed: 'The prepared message could not be verified. It needs review.',
  original_unavailable: 'The matched original is unavailable. It needs review.',
  accepted_by_email_provider: 'The mail provider accepted this message.',
  provider_rejected: 'The mail provider rejected this message. It needs review.',
  original_integrity_failed: 'The original report could not be verified. It needs review.',
  retry_limit_or_unknown_outcome: 'The retry limit was reached or the outcome is unconfirmed. Review the mail status.',
  retry_pending_or_unknown_outcome: 'The outcome is unconfirmed. A safe retry may be pending; do not send another copy.',
};
const displayText = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function acceptedTime(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function DeliveryState({ delivery, label, relatedName }: { delivery: DeliveryStatus | null; label: string; relatedName?: string }) {
  const related = delivery?.status === 'duplicate' && delivery.duplicateOfRequestId && delivery.relatedStatus ? delivery : null;
  const accepted = delivery?.status === 'accepted' || related?.relatedStatus === 'accepted' ? acceptedTime(delivery?.acceptedAt) : null;
  return <div className={styles.delivery}>
    <h4>{label}</h4>
    <p><strong>{delivery ? statusLabels[delivery.status] || 'Status unavailable' : 'Not queued'}</strong></p>
    {delivery?.reason && <p>{reasonLabels[delivery.reason] || 'Review this request’s automation status before taking action.'}</p>}
    {related && <p>Earlier request: {relatedName || 'reference'} ({related.duplicateOfRequestId!.slice(0, 8)}). {statusLabels[related.relatedStatus!] || 'Status unavailable'}.</p>}
    {accepted && <p>{related ? 'Earlier message accepted ' : 'Accepted '}<time dateTime={accepted.toISOString()}>{accepted.toLocaleString()}</time>.</p>}
  </div>;
}

export function CoaAutomation({ report, requests = [], busy, dirty, refreshing, onDraft, onSave, onProcess }: Props) {
  if (!report || !report.config || !report.requests || typeof report.requests !== 'object') return <section className={styles.section} aria-labelledby="coa-automation-title">
    <h2 id="coa-automation-title">COA email automation</h2>
    <p role="status">Automation details are unavailable. Refresh administration to check the current configuration.</p>
  </section>;
  const savingDisabled = busy || refreshing;
  const processDisabled = savingDisabled || dirty;
  const entries = Object.entries(report.requests).filter(([, delivery]) => delivery?.coa || delivery?.alert);
  const requestById = new Map(requests.map(request => [request.id, request]));
  return <section className={styles.section} aria-labelledby="coa-automation-title">
    <h2 id="coa-automation-title">COA email automation</h2>
    <p>Automation is <strong>{report.config.enabled ? 'enabled' : 'disabled'}</strong>. Original reports are sent only after the request matches an eligible report.</p>
    <p className={styles.note}>Accepted means the mail provider accepted the message. It does not confirm inbox delivery. Request review status remains separate below.</p>
    <dl className={styles.configuration}>
      <div><dt>Sender</dt><dd>{report.sender || 'Not configured'}</dd></div>
      <div><dt>Reply-to address</dt><dd>{report.config.replyTo || 'Not configured'}</dd></div>
      <div><dt>Notification destination</dt><dd>{report.config.notifyTo || 'Not configured'}</dd></div>
    </dl>
    {!report.mailConfigured && <p className="notice" role="status">Email sending is not configured. Reports cannot be sent yet.</p>}
    <form className={'store-form ' + styles.form} onChangeCapture={onDraft} onSubmit={event => { event.preventDefault(); if (!savingDisabled) void onSave(event); }}>
      <label className={styles.checkbox}><input type="checkbox" name="enabled" defaultChecked={report.config.enabled} disabled={savingDisabled}/><span>Enable automatic COA replies</span></label>
      <div className={styles.fields}>
        <label className="field"><span>Reply-to email</span><input type="email" name="replyTo" defaultValue={report.config.replyTo} required disabled={savingDisabled} autoComplete="off"/></label>
        <label className="field"><span>Notification email (optional)</span><input type="email" name="notifyTo" defaultValue={report.config.notifyTo || ''} disabled={savingDisabled} autoComplete="off"/><small>For new contact and partner requests only; older requests do not trigger notifications. Leave blank to turn notifications off.</small></label>
      </div>
      <button type="submit" className="button button-dark" disabled={savingDisabled}>Save COA settings</button>
    </form>
    <h3>COA outbox</h3>
    <p className={styles.note}>Use Refresh administration above to load the latest send states. Existing messages are not resent by refreshing.</p>
    {dirty && <p className="notice" role="status">Save or discard unsaved edits before sending a report.</p>}
    {!entries.length ? <p>No COA automation records are shown for the loaded requests.</p> : <div className={styles.outbox}>{entries.map(([id, delivery]) => {
      const coa = delivery.coa;
      const request = requestById.get(id);
      const requestName = displayText(request?.data?.name) || displayText(request?.data?.email) || 'Customer request';
      const subject = displayText(request?.data?.subject) || (request?.kind === 'affiliate' ? 'Partner application' : 'COA request');
      const created = acceptedTime(request?.created);
      const eligible = report.config.enabled && report.mailConfigured && coa?.canProcess === true && ['ready', 'queued'].includes(coa.status) && Boolean(coa.reportId?.trim());
      return <article className={styles.request} key={id}>
        <h4>{requestName}</h4>
        <p>{subject}</p>
        <p className={styles.note}>{created && <><time dateTime={created.toISOString()}>{created.toLocaleString()}</time> · </>}Reference <span className={styles.requestId}>{id.slice(0, 8)}</span></p>
        {coa?.productName && <p>{coa.productName}{coa.strength ? ' · ' + coa.strength : ''}</p>}
        {(coa?.lot || coa?.reportId) && <dl className={styles.reportDetails}>
          {coa.lot && <div><dt>Lot</dt><dd>{coa.lot}</dd></div>}
          {coa.reportId && <div><dt>Report</dt><dd>{coa.reportId}</dd></div>}
        </dl>}
        <div className={styles.states}><DeliveryState delivery={coa} label="Original COA" relatedName={coa?.duplicateOfRequestId ? displayText(requestById.get(coa.duplicateOfRequestId)?.data?.name) || displayText(requestById.get(coa.duplicateOfRequestId)?.data?.email) : undefined}/>{delivery.alert && <DeliveryState delivery={delivery.alert} label="Request notification"/>}</div>
        {eligible && <button type="button" className="button button-dark" disabled={processDisabled} aria-label={'Send original COA for request ' + id} onClick={() => { if (!processDisabled && eligible) void onProcess(id); }}>Send original COA</button>}
      </article>;
    })}</div>}
  </section>;
}
