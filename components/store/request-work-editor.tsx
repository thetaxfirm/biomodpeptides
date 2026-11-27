'use client';
import { useEffect, useState } from 'react';
import type { RequestWork } from '@/lib/admin-request-queue';
import type { TeamMember } from './request-inbox';
import styles from './request-inbox.module.css';
export type RequestWorkInput = Omit<RequestWork, 'version' | 'updated' | 'updatedBy'> & { id: string; expectedVersion: number };
const empty: RequestWork = { assignee: null, nextAction: '', dueAt: null, resolution: '', triage: 'unreviewed', version: 0, updated: null, updatedBy: null };
function localDate(value: number | null) {
  if (value === null) return '';
  const d = new Date(value); return new Date(value - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function RequestWorkEditor({ id, work, team, suggestedVendor, disabled, onSave, initialDraft, onDraft }: { id: string; work?: RequestWork; initialDraft?: RequestWork; onDraft: (draft: RequestWork | null) => void; team: TeamMember[]; suggestedVendor: boolean; disabled: boolean; onSave: (input: RequestWorkInput) => Promise<RequestWork> }) {
  const saved = work || empty;
  const [draft, setDraft] = useState(initialDraft || saved), [edited, setEdited] = useState(Boolean(initialDraft)), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => { if (!edited) setDraft(saved); }, [work, edited]);
  useEffect(() => {
    if (!edited) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [edited]);
  const change = (patch: Partial<RequestWork>) => { setDraft(v => { const next = { ...v, ...patch }; onDraft(next); return next; }); setEdited(true); setNotice(''); };
  const save = async () => {
    setBusy(true); setNotice('');
    try { const next = await onSave({ id, expectedVersion: draft.version, assignee: draft.assignee, nextAction: draft.nextAction, dueAt: draft.dueAt, resolution: draft.resolution, triage: draft.triage }); setDraft(next); setEdited(false); onDraft(null); setNotice('Work details saved.'); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Could not save work details. Your edits are still here.'); }
    finally { setBusy(false); }
  };
  return <details className={styles.workDetails} open={edited || undefined}><summary>Assignment & next action{saved.assignee ? ' · ' + (team.find(m => m.email === saved.assignee)?.name || saved.assignee) : ' · Unassigned'}{saved.dueAt ? ' · due ' + new Date(saved.dueAt).toLocaleDateString() : ''}</summary>
    {suggestedVendor && draft.triage === 'unreviewed' && <p className={styles.note}>Possible vendor pitch. It stays in Needs reply until someone confirms its classification.</p>}
    <div className={styles.workFields}>
      <label>Assigned to<select value={draft.assignee || ''} disabled={disabled || busy} onChange={e => change({ assignee: e.target.value || null })}><option value="">Unassigned</option>{draft.assignee && !team.some(m => m.email === draft.assignee) && <option value={draft.assignee}>{draft.assignee} (inactive)</option>}{team.map(m => <option key={m.email} value={m.email}>{m.name || m.email}</option>)}</select></label>
      <label>Due date<input type="datetime-local" value={localDate(draft.dueAt)} disabled={disabled || busy} onChange={e => change({ dueAt: e.target.value ? new Date(e.target.value).getTime() : null })}/></label>
      <label>Classification<select value={draft.triage} disabled={disabled || busy} onChange={e => change({ triage: e.target.value as RequestWork['triage'] })}><option value="unreviewed">Unreviewed</option><option value="customer">Customer request</option><option value="vendor">Confirmed vendor pitch</option></select></label>
      <label>Next action<input value={draft.nextAction} maxLength={300} disabled={disabled || busy} onChange={e => change({ nextAction: e.target.value })}/></label>
      <label className={styles.workResolution}>Resolution note<textarea rows={2} value={draft.resolution} maxLength={1000} disabled={disabled || busy} onChange={e => change({ resolution: e.target.value })}/></label>
    </div>
    {edited && saved.version !== draft.version && <p className={styles.warning}>A teammate changed these details. Discard your edits to review their version before saving.</p>}
    <div className={styles.sendRow}><button type="button" className={styles.action} disabled={!edited || busy || disabled} onClick={() => void save()}>{busy ? 'Saving…' : 'Save work details'}</button>{edited && <button type="button" className={styles.link} disabled={busy} onClick={() => { setDraft(saved); setEdited(false); onDraft(null); setNotice(''); }}>Discard edits</button>}<span className={styles.note}>Internal notes. Saving does not send a message or close the request.</span></div>
    {notice && <p className={styles.note} role="status">{notice}</p>}
  </details>;
}
