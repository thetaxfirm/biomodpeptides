'use client';

import type { FormEvent } from 'react';
import type { CoaAutomationStatus, DeliveryStatus } from '@/lib/coa-outbox';
import styles from './coa-automation.module.css';

export type CoaAutomationReport = CoaAutomationStatus;
type RequestContext = { id: string; kind?: string; created?: number; data?: { name?: unknown; email?: unknown; subject?: unknown } };
type Props = {
  report?: CoaAutomationReport | null;
  checkoutRecovery?: { enabled: boolean; mailConfigured?: boolean } | null;
  requests?: readonly RequestContext[];
  busy: boolean;
  dirty: boolean;
  refreshing: boolean;
  onDraft: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onProcess: (id: string) => void | Promise<void>;
};
const statusLabels: Record<DeliveryStatus['status'], string> = {
  ready: 'Prepare for review', queued: 'Held for owner review', sending: 'Sending', accepted: 'Accepted by mail provider',
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

export function CoaAutomation({ report, checkoutRecovery, requests = [], busy, dirty, refreshing, onDraft, onSave, onProcess }: Props) {
  if (!report || !report.config || !report.requests || typeof report.requests !== 'object') return <section className={styles.section} aria-labelledby="coa-automation-title">
    <h2 id="coa-automation-title">Email controls and delivery history</h2>
    <p role="status">Automation details are unavailable. Refresh administration to check the current configuration.</p>
  </section>;
  const savingDisabled = busy || refreshing;
  const entries = Object.entries(report.requests).filter(([, delivery]) => delivery?.coa || delivery?.alert);
  const requestById = new Map(requests.map(request => [request.id, request]));
  return <section className={styles.section} aria-labelledby="coa-automation-title">
    <h2 id="coa-automation-title">Email controls and delivery history</h2>
    <p><strong>AI and staff replies: owner approval required.</strong> Drafts use contact@trybiomod.com. An owner reviews the message and clicks Send in the website reply desk or Jarvis.</p>
    <p><strong>Customer-requested COA links: automatic.</strong> When a customer chooses Request by email, a private link is sent only after the lot printed on their vial matches an approved original report. An unmatched lot goes to the reply desk for review.</p>
    <p><strong>New-request alerts: {report.config.enabled ? 'enabled' : 'disabled'}.</strong> These notify staff about new contact and partner requests; they are not replies to customers.</p>
    <p><strong>Overdue-request reminders: automatic internal emails.</strong> A daily reminder goes to the notification address, or an owner if that address is blank, when a customer has waited over a day for a reply.</p>
    <p><strong>Unpaid-checkout reminders: {typeof checkoutRecovery?.enabled === 'boolean' ? checkoutRecovery.enabled ? 'enabled' : 'disabled' : 'status unavailable'}.</strong> When enabled, eligible unpaid checkouts receive one reminder after 24 hours without payment or payment-page activity, with an additional 7.5% off after existing discounts. Internal tests and payments under review are excluded.</p>
    {checkoutRecovery?.enabled && checkoutRecovery.mailConfigured === false && <p className="notice" role="status">Checkout reminders are enabled, but their sending service is not configured.</p>}
    <p className={styles.note}>Accepted means the mail provider accepted the message. It does not confirm inbox delivery. Request review status remains separate below.</p>
    <dl className={styles.configuration}>
      <div><dt>Request and COA sender</dt><dd>{report.sender || 'Not configured'}</dd></div>
      <div><dt>Replies to automatic emails</dt><dd>{report.config.replyTo || 'Not configured'}</dd></div>
      <div><dt>Notification destination</dt><dd>{report.config.notifyTo || 'Not configured'}</dd></div>
    </dl>
    {!report.mailConfigured && <p className="notice" role="status">Request-alert and COA email is not configured. Customer drafts use the connected research mailbox in Jarvis.</p>}
    <form className={'store-form ' + styles.form} onChangeCapture={onDraft} onSubmit={event => { event.preventDefault(); if (!savingDisabled) void onSave(event); }}>
      <label className={styles.checkbox}><input type="checkbox" name="enabled" defaultChecked={report.config.enabled} disabled={savingDisabled}/><span>Enable new-request alerts</span></label>
      <p className={styles.note}>This switch controls new-request alerts only. Customer-requested COA links, overdue reminders and checkout reminders operate separately.</p>
      <div className={styles.fields}>
        <label className="field"><span>Reply-to for automatic emails</span><input type="email" name="replyTo" defaultValue={report.config.replyTo} required disabled={savingDisabled} autoComplete="off"/></label>
        <label className="field"><span>Notification email (optional)</span><input type="email" name="notifyTo" defaultValue={report.config.notifyTo || ''} disabled={savingDisabled} autoComplete="off"/><small>For new contact and partner requests only; older requests do not trigger notifications. Leave blank to turn new-request alerts off. Overdue reminders then use an owner address.</small></label>
      </div>
      <button type="submit" className="button button-dark" disabled={savingDisabled}>Save alert settings</button>
    </form>
    <h3>Previous COA and alert activity</h3>
    <p className={styles.note}>This history shows the earlier COA outbox and staff alerts. Customer-requested COA links and AI drafts appear with their requests in the reply desk.</p>
    <p className={styles.note}>Use Refresh administration above to load the latest send states. Existing messages are not resent by refreshing.</p>
    {dirty && <p className="notice" role="status">Save or discard your alert settings before preparing replies.</p>}
    {!entries.length ? <p>No COA automation records are shown for the loaded requests.</p> : <div className={styles.outbox}>{entries.map(([id, delivery]) => {
      const coa = delivery.coa;
      const request = requestById.get(id);
      const requestName = displayText(request?.data?.name) || displayText(request?.data?.email) || 'Customer request';
      const subject = displayText(request?.data?.subject) || (request?.kind === 'affiliate' ? 'Partner application' : 'COA request');
      const created = acceptedTime(request?.created);
      return <article className={styles.request} key={id}>
        <h4>{requestName}</h4>
        <p>{subject}</p>
        <p className={styles.note}>{created && <><time dateTime={created.toISOString()}>{created.toLocaleString()}</time> · </>}Reference <span className={styles.requestId}>{id.slice(0, 8)}</span></p>
        {coa?.productName && <p>{coa.productName}{coa.strength ? ' · ' + coa.strength : ''}</p>}
        {(coa?.lot || coa?.reportId) && <dl className={styles.reportDetails}>
          {coa.lot && <div><dt>Lot</dt><dd>{coa.lot}</dd></div>}
          {coa.reportId && <div><dt>Report</dt><dd>{coa.reportId}</dd></div>}
        </dl>}
        <div className={styles.states}>{coa && <DeliveryState delivery={coa} label="Original COA" relatedName={coa?.duplicateOfRequestId ? displayText(requestById.get(coa.duplicateOfRequestId)?.data?.name) || displayText(requestById.get(coa.duplicateOfRequestId)?.data?.email) : undefined}/>} {delivery.alert && <DeliveryState delivery={delivery.alert} label="Request notification"/>}</div>

      </article>;
    })}</div>}
  </section>;
}
