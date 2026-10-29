'use client';

import { vipSignal, type CustomerContext } from '@/lib/customer-context';
import { useEffect, useRef, useState } from 'react';
import { matchedCoaReplyProblem, preparedCoaReply, appendNextPurchaseOffer } from '@/lib/reply-composer';
import type { CoaAutomationReport } from './coa-automation';
import styles from './request-inbox.module.css';
import { issueTypes, resolutionTypes, issueLabel, resolutionLabel, looksLikePitchText, type RequestIssue } from '@/lib/request-issues';

export type CustomerRequest = {
  id: string; kind: string; status: string; created: number;
  data: Record<string, unknown>;
};
export type ReplySummary = {
  id: string; requestId: string; revision: number;
  status: 'queued' | 'preparing' | 'ready' | 'needs_review' | 'sending' | 'sent' | 'cancelled';
  mode: 'ai' | 'staff'; sender: string; recipient: string; subject: string; body: string;
  preparedBy: string; updated: number; readyId?: string; model?: string; reason?: string;
  instruction?: string; purpose?: 'checkout_recovery' | 'reply'; approvedAt?: number; approvedBy?: string; coaChoice?: string | null;
  coa: { state: 'matched' | 'needs_review' | 'already_sent' | 'not_requested'; reason: string; extras?: { productName?: string; strength?: string; lot?: string; sha256?: string; filename?: string }[]; productName?: string; strength?: string; lot?: string; reportId?: string; chemicalIdentity?: string; filename?: string; sha256?: string };
  history: { id: string; direction: 'incoming' | 'outgoing'; body: string; created: number; from?: string; to?: string; subject?: string; sentBy?: string; attachment?: string; source?: 'recovery' }[];
};
export type PrepareReplyInput = { id: string; mode: 'ai' | 'staff'; body?: string; instruction?: string; expectedRevision: number | null; coaSha256?: string | null; send?: boolean; purpose?: 'checkout_recovery' | 'reply' };
export type AttachmentCheckInput = { id: string; expectedRevision: number | null; coaSha256: string | null };
export type AttachmentCheck = { requestId: string; revision: number | null; coaChoice: string | null; coa: ReplySummary['coa']; checkedAt: number };
type AttachmentRead = { key: string; result?: AttachmentCheck; error?: string };
export type DeskCoa = { sha256: string; productName: string; strength: string; form: string; lot: string; reportId: string; current: boolean };
export type RequestForward = { id: string; to: string; by: string; note: string; status: 'sending' | 'unknown' | 'accepted' | 'failed'; created: number };
export type TeamMember = { email: string; name: string; role: string };
export type CaseEntry = { requestId: string; issue: string; resolutions: string[]; note: string; updated: number; updatedBy: string; name: string; subject: string };
export type DeskOptions = { team?: TeamMember[]; links?: { label: string; url: string }[]; coas: DeskCoa[]; codes: { code: string; percentOff: number }[]; rules: { id: string; rule: string; issue?: string | null }[]; learning: { recent: number; unchanged: number }; legacyDrafts?: number; bridgeSeen: number | null };
type Props = {
  requests: readonly CustomerRequest[];
  activeTab?: boolean;
  automation?: CoaAutomationReport | null;
  requestReplies?: Record<string, ReplySummary>;
  busy: boolean;
  dirty: boolean;
  refreshing: boolean;
  canSend?: boolean;
  onStatus: (request: CustomerRequest, status: string) => void | Promise<void>;
  onCheckAttachments?: (input: AttachmentCheckInput) => Promise<AttachmentCheck>;
  onPrepareReply: (input: PrepareReplyInput) => Promise<ReplySummary>;
  onRefreshReplies?: (ids: string[], focusId?: string | null) => Promise<{ requests?: CustomerRequest[]; replies: Record<string, ReplySummary>; forwards?: Record<string, RequestForward[]>; activity?: Record<string, { at: number; text: string }[]>; issues?: Record<string, RequestIssue>; external?: Record<string, ExternalReply[]>; customerContext?: { requestId: string; context: CustomerContext | null } }>;
  onMarkReplied?: (input: { id: string; note: string }) => Promise<ExternalReply>;
  onSaveIssue?: (input: { id: string; issue: string; resolutions: string[]; note: string }) => Promise<RequestIssue>;
  onLoadCases?: () => Promise<CaseEntry[]>;
  onLoadTemplates?: (requestId: string) => Promise<{ id: string; label: string; why: string; body: string }[]>;
  focusId?: string | null;
  onForward?: (input: { id: string; to: string; note: string }) => Promise<RequestForward>;
  onLoadOptions?: () => Promise<DeskOptions>;
  onRetireDrafts?: () => Promise<{ retired: number; changedSinceReview: number; remainingApproved: number; pendingOutcomes: number }>;
  onSaveRule?: (input: { rule?: string; removeId?: string; issue?: string | null }) => Promise<DeskOptions>;
};
// coa: undefined = keep what the saved reply uses; null = auto-match the request; '' = none; sha = chosen report.
type Draft = { purpose: 'checkout_recovery' | 'reply'; body: string; instruction: string; revision: number | null; edited: boolean; error: string; message: string; coa?: string | null; undo?: string; remember: boolean; sourceStatus?: ReplySummary['status'] };
type Stage = 'todo' | 'sending' | 'waiting' | 'followup' | 'done' | 'spam' | 'deleted' | 'pitch';
const noReplies: Record<string, ReplySummary> = {};
const sender = 'contact@trybiomod.com';
const DAY = 86400000;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
/** Only this server-created form origin has no customer-written message. Keep legacy notes intact. */
export function coaFormDetails(request: CustomerRequest) {
  if (request.data.origin !== 'coa-link') return null;
  const product = text(request.data.productName) || text(request.data.subject).match(/\((.+) page\)$/i)?.[1] || '';
  return { product, lot: text(request.data.labelLot) };
}
function usableEmail(value: unknown) {
  const email = text(value);
  return email.length <= 254 && /^[^\s@<>,;?&#%]+@[^\s@<>,;?&#%]+\.[^\s@<>,;?&#%]+$/.test(email);
}
/** The box starts empty once a reply has gone out, ready for the next message.
 * Leaving the sent text in an editable box with an active Send button read as
 * "not sent" (owner, Oct 15 2026: "if we replied, let me know"). */
function seedBody(reply?: ReplySummary): string {
  return reply?.status === 'sent' || reply?.status === 'cancelled' ? '' : (reply?.body || '');
}
function newDraft(reply?: ReplySummary): Draft {
  return { purpose: reply?.status === 'cancelled' || reply?.status === 'sent' ? 'reply' : reply?.purpose || 'reply', body: seedBody(reply), instruction: '', revision: reply?.revision ?? null, edited: false, error: '', message: '', remember: false, sourceStatus: reply?.status, ...(['sent', 'cancelled'].includes(reply?.status || '') ? { coa: '' } : {}) };
}
function newestReply(remote?: ReplySummary, local?: ReplySummary) {
  if (!remote) return local;
  if (!local) return remote;
  return remote.revision > local.revision || (remote.revision === local.revision && remote.updated >= local.updated) ? remote : local;
}
function when(value: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function websiteLink(value: unknown) {
  try { const url = new URL(text(value)); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
const working = (reply?: ReplySummary) => reply?.status === 'queued' || reply?.status === 'preparing';
const sendPending = (reply?: ReplySummary) => reply?.status === 'sending' || Boolean(reply?.approvedAt && reply.status !== 'sent' && reply.status !== 'needs_review');
export type ExternalReply = { verified?: boolean; at: number; source: 'mailbox' | 'manual'; account: string; body: string; preview: boolean };
const shortDate = (value: number) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
const mailbox = (account: string) => account.split('@')[0] + '@';
/** A staff email shown as the person's name when the team list knows it. */
export function personName(email: string | undefined, team: readonly TeamMember[] = []) {
  const value = text(email);
  if (!value) return '';
  const matches = team.filter(m => m.email.toLowerCase() === value.toLowerCase()), member = matches.find(m => m.name) || matches[0];
  return member?.name || value;
}
type Outgoing = { created: number; sentBy?: string };
const deskHow = (m: Outgoing, team: readonly TeamMember[]) => m.sentBy ? 'by ' + personName(m.sentBy, team) : 'from the reply desk';
const outsideHow = (e: ExternalReply, team: readonly TeamMember[]) => e.source === 'manual' ? 'by phone or text (logged by ' + personName(e.account, team) + ')' : 'in Gmail from ' + e.account;
export const looksLikePitch = (request: CustomerRequest) => request.data.origin !== 'order' && looksLikePitchText(text(request.data.subject), text(request.data.message));
type StageInfo = { stage: Stage; label: string; since: number; when: string; late: boolean };
function stageOf(request: CustomerRequest, reply: ReplySummary | undefined, external: ExternalReply[] = [], issue: string | null = null, activity: { at: number; text: string }[] = [], now = Date.now(), shared: { at: number; how: string }[] = [], team: readonly TeamMember[] = []): StageInfo {
  const history = reply?.history || [];
  const desk = history.filter(m => m.direction === 'outgoing' && m.source !== 'recovery').map(m => ({ at: m.created, how: deskHow(m, team) }));
  const outside = external.filter(e => e.verified !== false).map(e => ({ at: e.at, how: outsideHow(e, team) }));
  const replies = [...desk, ...outside, ...shared].sort((a, b) => a.at - b.at);
  const last = replies[replies.length - 1];
  const lastOut = last?.at || 0;
  const lastIn = Math.max(request.data.origin === 'order' ? 0 : request.created, ...history.filter(m => m.direction === 'incoming' && !(request.data.origin === 'order' && m.id.startsWith('original:'))).map(m => m.created));
  const answeredOutside = outside.some(message => message.at >= lastIn);
  const customerReplied = lastOut > 0 && (lastIn > lastOut || (request.status === 'in_progress' && !answeredOutside));
  // An order conversation is started by us, so the first email is not a "reply".
  const started = request.data.origin === 'order' && !history.some(m => m.direction === 'incoming' && !m.id.startsWith('original:'));
  const replied = last ? `${started ? 'You emailed them' : 'Replied'} ${when(last.at)} ${last.how}` : '';
  if (request.status === 'deleted') return { stage: 'deleted', label: 'Deleted', since: request.created, when: 'Received ' + shortDate(request.created), late: false };
  if (request.status === 'spam') return { stage: 'spam', label: 'Spam', since: request.created, when: 'Received ' + shortDate(request.created), late: false };
  if (sendPending(reply)) return { stage: 'sending', label: 'Sending…', since: reply!.approvedAt || reply!.updated, when: 'Received ' + shortDate(request.created), late: false };
  if (issue === 'vendor' || (!issue && looksLikePitch(request))) return { stage: 'pitch', label: issue === 'vendor' ? 'Sales pitch' : 'Looks like a sales pitch', since: request.created, when: 'Received ' + shortDate(request.created), late: false };
  if (issue === 'owner_review' && request.status !== 'resolved') return { stage: 'todo', label: 'Owner review required', since: request.created, when: 'Received ' + shortDate(request.created), late: false };
  if (lastOut && !customerReplied) return { stage: request.status === 'resolved' ? 'done' : 'waiting', label: (request.status === 'resolved' ? 'Done · ' : 'Waiting on them · ') + replied, since: lastOut, when: replied, late: false };
  if (request.status === 'resolved' && !customerReplied) {
    const closed = [...activity].reverse().find(a => a.text.startsWith('Archived'));
    return { stage: 'done', label: 'Closed without reply' + (closed ? ` · ${shortDate(closed.at)}${closed.text.includes(' by ') ? ' by ' + personName(closed.text.split(' by ').pop()!, team) : ''}` : ''), since: closed?.at || request.created, when: 'Received ' + shortDate(request.created), late: false };
  }
  if (started) return { stage: 'followup', label: 'Optional follow-up · no customer message', since: request.created, when: 'Opened ' + shortDate(request.created), late: false };
  // Plain answer to "did we reply?" first, then what is waiting.
  const base = customerReplied ? `Replied ${shortDate(lastOut)}, then they wrote again` : 'Not replied yet';
  const state = base + (working(reply) ? ' · AI is writing a draft' : reply?.status === 'ready' ? ' · draft ready for your approval' : reply?.status === 'needs_review' ? ' · draft needs a look' : '');
  const waited = now - lastIn;
  const days = Math.floor(waited / DAY);
  return { stage: 'todo', label: state, since: lastIn, when: (customerReplied ? 'Wrote ' : 'Received ') + shortDate(lastIn) + (days >= 1 ? ` · waiting ${days} day${days === 1 ? '' : 's'}` : ''), late: waited > DAY };
}
function friendlyReason(reason?: string) {
  if (reason === 'answered_elsewhere') return 'This conversation was already answered. Review before sending another reply.';
  if (reason === 'customer_replied') return 'The customer wrote again. Review their latest message before sending a new reply.';
  if (reason === 'retired_reply_policy_v2') return 'Old draft removed. Check the current history before writing a new message.';
  if (!reason) return '';
  if (reason === 'request_closed') return 'This draft was set aside because the request was closed (for example, a reply to this customer already answered it). Nothing was sent.';
  if (reason === 'send_blocked') return 'Jarvis stopped that send before anything went out (the request, recipient or report changed). Check the reply and press Send again.';
  if (reason === 'bridge_preparation_failed' || /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(reason)) return 'The AI could not finish this draft. Nothing was sent. Ask again or write the reply yourself.';
  return reason;
}
type Speech = { start(): void; stop(): void; abort(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((event: any) => void) | null; onend: (() => void) | null; onerror: ((event: any) => void) | null };
function speechRecognition(): (new () => Speech) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function RequestInbox({ requests: initialRequests, activeTab = true, automation, requestReplies = noReplies, busy, dirty, refreshing, canSend = false, onStatus, onPrepareReply, onCheckAttachments, onRefreshReplies, onLoadOptions, onSaveRule, onRetireDrafts, onForward, onSaveIssue, onLoadCases, onLoadTemplates, focusId, onMarkReplied }: Props) {
  const [snapshot, setSnapshot] = useState<{ base: readonly CustomerRequest[]; requests: readonly CustomerRequest[]; focus: string | null } | null>(null);
  const requests = snapshot?.base === initialRequests ? snapshot.requests : initialRequests;
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const consumedFocus = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preparedReplies, setPreparedReplies] = useState<Record<string, ReplySummary>>({});
  const [liveReplies, setLiveReplies] = useState<Record<string, ReplySummary>>({});
  const [forwards, setForwards] = useState<Record<string, RequestForward[]>>({});
  const [activity, setActivity] = useState<Record<string, { at: number; text: string }[]>>({});
  const [issues, setIssues] = useState<Record<string, RequestIssue>>({});
  const [issueDrafts, setIssueDrafts] = useState<Record<string, { note: string }>>({});
  const [cases, setCases] = useState<CaseEntry[] | null>(null);
  const [templates, setTemplates] = useState<Record<string, { id: string; label: string; why: string; body: string }[]>>({});
  const [ruleIssue, setRuleIssue] = useState<string>('');
  const [panel, setPanel] = useState<{ id: string; kind: 'forward' | 'delete'; to: string; note: string; busy: boolean; error: string } | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [attachmentRead, setAttachmentRead] = useState<AttachmentRead | null>(null);
  const [attachmentRetry, setAttachmentRetry] = useState(0);
  const [options, setOptions] = useState<DeskOptions | null>(null);
  const [filter, setFilterState] = useState<'todo' | 'waiting' | 'followup' | 'done' | 'spam' | 'deleted' | 'pitch' | 'all'>('todo');
  const [cleanup, setCleanup] = useState({ busy: false, message: '' });
  const [customerEvidence, setCustomerEvidence] = useState<Record<string, CustomerContext | null>>({});
  const [external, setExternal] = useState<Record<string, ExternalReply[]>>({});
  const [replyNote, setReplyNote] = useState<{ id: string; note: string; busy: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [listening, setListening] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [newRule, setNewRule] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const pendingIds = useRef(new Set<string>());
  const mounted = useRef(true);
  const speech = useRef<Speech | null>(null);
  const bodyField = useRef<HTMLTextAreaElement | null>(null);
  const replyOf = (id: string) => newestReply(newestReply(requestReplies[id], liveReplies[id]), preparedReplies[id]);
  const replyRef = useRef(replyOf);
  replyRef.current = replyOf;
  const selectedReply = selected ? replyOf(selected) : undefined;
  const selectedDraft = selected ? drafts[selected] : undefined;
  const selectedChoice = selectedDraft?.coa !== undefined ? selectedDraft.coa : selectedReply?.coaChoice ?? null;
  // Keep the complete outgoing text visible, including the offer and closing.
  useEffect(() => {
    const field = bodyField.current;
    if (!field || typeof window === 'undefined') return;
    const fit = () => { field.style.height = 'auto'; field.style.height = `${field.scrollHeight + 2}px`; };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [selected, selectedDraft?.body]);
  const selectedRevision = selectedReply?.revision ?? null;
  const selectedRequest = requests.find(r => r.id === selected);
  const selectedSource = selectedRequest ? JSON.stringify(selectedRequest.data) + selectedRequest.status : '';
  const attachmentKey = JSON.stringify([selected, selectedRevision, selectedChoice, selectedSource, attachmentRetry]);
  useEffect(() => {
    if (!activeTab || !selected || !selectedRequest || !onCheckAttachments || sendPending(selectedReply) || ['deleted', 'spam'].includes(selectedRequest.status)) return;
    let cancelled = false;
    setAttachmentRead({ key: attachmentKey });
    onCheckAttachments({ id: selected, expectedRevision: selectedRevision, coaSha256: selectedChoice }).then(result => {
      if (!cancelled && mounted.current) setAttachmentRead({ key: attachmentKey, result });
    }, () => {
      if (!cancelled && mounted.current) setAttachmentRead({ key: attachmentKey, error: 'The PDF check could not finish. Try again before sending a report.' });
    });
    return () => { cancelled = true; };
  }, [activeTab, attachmentKey, onCheckAttachments, selectedReply?.approvedAt, selectedReply?.status]);
  const requestIds = requests.map(r => r.id).join(',');
  const polling = useRef({ ids: [] as string[], focus: null as string | null });
  polling.current = { ids: requests.map(r => r.id), focus: focusId && consumedFocus.current !== focusId ? focusId.split('|')[0] : selected };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; speech.current?.abort(); }; }, []);
  const optionsFlight = useRef<Promise<DeskOptions> | null>(null);
  useEffect(() => {
    if (!onLoadOptions || !activeTab) return;
    let stopped = false, running = false, timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const tick = async () => {
      if (stopped || running) return;
      if (timer) clearTimeout(timer);
      running = true;
      try {
        // A tab/callback change can retire an effect while its read is pending.
        // Wait for that read instead of starting an overlapping options request.
        if (optionsFlight.current) await optionsFlight.current.catch(() => undefined);
        if (!stopped && visible()) {
          const flight = onLoadOptions(); optionsFlight.current = flight;
          try {
            const value = await flight;
            if (!stopped && mounted.current) { setOptions(value); setNow(Date.now()); }
          } finally { if (optionsFlight.current === flight) optionsFlight.current = null; }
        }
      } catch { /* Keep the last known options until the next read succeeds. */ }
      running = false;
      if (stopped) return;
      timer = setTimeout(tick, 30000); (timer as any)?.unref?.();
    };
    const resume = () => { if (visible()) void tick(); };
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', resume);
    if (typeof window !== 'undefined') window.addEventListener?.('focus', resume);
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', resume);
      if (typeof window !== 'undefined') window.removeEventListener?.('focus', resume);
    };
  }, [onLoadOptions, activeTab]);
  // Refresh only the inbox snapshot. Unsaved drafts and other admin forms stay intact.
  useEffect(() => {
    if (!onRefreshReplies || !activeTab) return;
    let stopped = false, running = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped || running) return;
      if (timer) clearTimeout(timer);
      running = true;
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        try {
          const { ids, focus } = polling.current;
          const fresh = await onRefreshReplies(ids.slice(0, 200), focus);
          if (!stopped && mounted.current) {
            if (fresh.requests) setSnapshot({ base: initialRequests, requests: fresh.requests, focus });
            setLiveReplies(fresh.replies || {});
            if (fresh.forwards) setForwards(fresh.forwards);
            if (fresh.activity) setActivity(fresh.activity);
            if (fresh.issues) setIssues(fresh.issues);
            if (fresh.external) setExternal(fresh.external);
            if (fresh.customerContext) setCustomerEvidence(previous => ({ ...previous, [fresh.customerContext!.requestId]: fresh.customerContext!.context }));
            setCheckedAt(Date.now()); setRefreshError('');
          }
        } catch { if (!stopped && mounted.current) setRefreshError('Could not refresh requests. Showing the last loaded information; retrying automatically.'); }
      }
      running = false;
      if (stopped) return;
      if (mounted.current) setNow(Date.now());
      const busyReply = polling.current.ids.some(id => { const reply = replyRef.current(id); return working(reply) || sendPending(reply); });
      timer = setTimeout(tick, busyReply ? 2500 : 30000);
      (timer as any)?.unref?.();
    };
    const resume = () => { if (document.visibilityState !== 'hidden') void tick(); };
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', resume);
    if (typeof window !== 'undefined') window.addEventListener?.('focus', resume);
    timer = setTimeout(tick, selected ? 0 : 2500);
    (timer as any)?.unref?.();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', resume);
      if (typeof window !== 'undefined') window.removeEventListener?.('focus', resume);
    };
  }, [onRefreshReplies, initialRequests, activeTab, focusId, selected]);
  // Exact links also reveal archived, supplier and deleted requests. Consume once so
  // subsequent refreshes never reset the person's chosen filter, search or draft.
  useEffect(() => {
    if (!focusId) { consumedFocus.current = null; return; }
    const id = focusId.split('|')[0];
    const request = requests.find(r => r.id === id);
    if (!id || !request || consumedFocus.current === focusId) return;
    consumedFocus.current = focusId!;
    setFilter(request.status === 'deleted' ? 'deleted' : 'all'); setQuery(''); setSelected(id);
    setDrafts(previous => previous[id] ? previous : { ...previous, [id]: newDraft(replyOf(id)) });
  }, [focusId, requestIds]);
  // Order conversations get the win-back templates on the side.
  useEffect(() => {
    if (!selected || !onLoadTemplates || templates[selected]) return;
    const request = requests.find(r => r.id === selected);
    if (request?.data.origin !== 'order') return;
    let alive = true;
    onLoadTemplates(selected).then(list => { if (alive && mounted.current) setTemplates(previous => ({ ...previous, [selected]: list })); }, () => undefined);
    return () => { alive = false; };
  }, [selected, onLoadTemplates]);
  // A clean draft follows the newest saved/AI version; an edited one is never overwritten.
  useEffect(() => {
    setDrafts(previous => {
      let changed = false;
      const next = { ...previous };
      for (const [id, draft] of Object.entries(previous)) {
        const reply = replyOf(id);
        if (!draft.edited && reply && !working(reply) && (draft.revision !== reply.revision || draft.body !== seedBody(reply) || (['sent', 'cancelled'].includes(reply.status) && draft.sourceStatus !== reply.status))) {
          next[id] = { ...newDraft(reply), message: draft.message, undo: draft.undo, coa: ['sent', 'cancelled'].includes(reply.status) ? '' : draft.coa }; changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [requestReplies, preparedReplies, liveReplies]);
  // A verified form request has enough evidence for a factual reply. No AI call or save is needed.
  // Only untouched blank/contradictory drafts are replaced; a customer's follow-up needs its own answer.
  useEffect(() => {
    const checked = attachmentRead?.key === attachmentKey ? attachmentRead.result?.coa : undefined;
    if (!selected || !selectedRequest || selectedRequest.data.origin !== 'coa-link' || checked?.state !== 'matched' || selectedChoice === '' || working(selectedReply) || sendPending(selectedReply) || issues[selected]?.issue === 'owner_review') return;
    if (selectedReply?.history.some(message => message.direction === 'incoming' && !message.id.startsWith('original:'))) return;
    setDrafts(previous => {
      const draft = previous[selected];
      if (!draft || draft.edited || (draft.body.trim() && !matchedCoaReplyProblem(draft.body))) return previous;
      let body = preparedCoaReply(checked);
      const offer = options?.codes.find(code => new RegExp(`\\b${code.code}\\b`, 'i').test(draft.body));
      if (offer) body = appendNextPurchaseOffer(body, offer);
      return { ...previous, [selected]: { ...draft, body, edited: true, error: '', message: 'Matched-report reply prepared. Not sent.' } };
    });
  }, [attachmentKey, attachmentRead, selected, selectedSource, selectedReply, issues, options]);
  const disabled = busy || dirty || refreshing;

  // Each request is its own conversation. An unrelated email must not clear this request.
  const emailKey = (request: CustomerRequest) => request.id;
  const family: Record<string, CustomerRequest[]> = {};
  for (const request of requests) (family[emailKey(request)] ||= []).push(request);
  const team = options?.team || [];
  const sharedReplies = (_request: CustomerRequest): { at: number; how: string }[] => [];
  const rows = requests.map(request => ({ request, reply: replyOf(request.id), ...stageOf(request, replyOf(request.id), external[request.id], issues[request.id]?.issue || null, activity[request.id], now, sharedReplies(request), team) }));
  const counts = { todo: 0, waiting: 0, followup: 0, done: 0, spam: 0, deleted: 0, pitch: 0, all: rows.filter(row => row.stage !== 'deleted').length };
  const counted = new Set<string>();
  for (const row of rows) { const bucket = row.stage === 'sending' || row.stage === 'todo' ? 'todo' : row.stage === 'waiting' ? 'done' : row.stage; const key = bucket + ':' + emailKey(row.request); if (counted.has(key)) continue; counted.add(key); counts[bucket]++; }
  counts.all = new Set(rows.filter(row => row.stage !== 'deleted').map(row => emailKey(row.request))).size;
  const inView = (stage: Stage, view: typeof filter) => view === 'all' ? stage !== 'deleted' : view === 'todo' ? stage === 'todo' || stage === 'sending' : view === 'done' ? stage === 'done' || stage === 'waiting' : stage === view;
  // Selection follows the tab: switching tabs never leaves another tab's conversation open.
  function setFilter(view: typeof filter) {
    setFilterState(view);
    setSelected(current => { const row = current ? rows.find(r => r.request.id === current) : null; return row && inView(row.stage, view) ? current : null; });
  }
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(row => inView(row.stage, filter)
    && (!needle || [row.request.id, row.request.kind, ...Object.values(row.request.data).filter(value => typeof value === 'string')].join(' ').toLowerCase().includes(needle)))
    // To reply: oldest first, so nothing waits behind newer mail. Everything else: newest first.
    .sort((a, b) => filter === 'todo' ? a.since - b.since : b.since - a.since);
  // Keep each request independently actionable, even when the customer has other cases.
  const grouped: (typeof shown[number] & { count: number; members: CustomerRequest[] })[] = [];
  for (const row of shown) {
    const existing = grouped.find(g => emailKey(g.request) === emailKey(row.request));
    if (!existing) { grouped.push({ ...row, count: 1, members: [row.request] }); continue; }
    existing.count++; existing.members.push(row.request);
    if (row.request.created > existing.request.created) Object.assign(existing, { request: row.request, reply: row.reply, label: row.label, stage: row.stage });
  }
  const views = [['todo', 'Needs reply'], ['followup', 'Optional follow-ups'], ['done', 'Replied & archive'], ['pitch', 'Sales pitches'], ['spam', 'Spam'], ['deleted', 'Deleted'], ['all', 'All']] as const;

  function open(id: string) {
    const reply = replyOf(id);
    setDrafts(previous => ({ ...previous, [id]: previous[id] || newDraft(reply) }));
    setSelected(current => current === id ? null : id);
  }
  function editDraft(id: string, field: 'body' | 'instruction', value: string) {
    if (disabled || pendingIds.current.has(id) || sendPending(replyOf(id)) || (field === 'body' && working(replyOf(id)))) return;
    setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] || newDraft()), [field]: value, ...(field === 'body' ? { edited: true } : {}), error: '', message: '' } }));
  }
  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] || newDraft(replyOf(id))), ...patch } }));
  }
  function insertAtCursor(id: string, snippet: string) {
    const draft = drafts[id]; if (!draft || disabled || working(replyOf(id))) return;
    const field = bodyField.current, at = field && typeof document !== "undefined" && document.activeElement === field ? field.selectionStart : draft.body.length;
    const before = draft.body.slice(0, at), after = draft.body.slice(at);
    const glue = before && !/\s$/.test(before) ? ' ' : '';
    editDraft(id, 'body', before + glue + snippet + after);
  }
  async function submit(request: CustomerRequest, mode: 'ai' | 'staff', send = false, instructionOverride?: string) {
    const id = request.id, current = drafts[id], draft = current && instructionOverride ? { ...current, instruction: instructionOverride, remember: false } : current;
    if (disabled || pendingIds.current.has(id) || !draft || !usableEmail(request.data.email)) return;
    const latest = replyOf(id);
    if (sendPending(latest) || (latest?.revision ?? null) !== draft.revision) return;
    if (mode === 'staff' && !draft.body.trim()) { setDraft(id, { error: send ? 'Write the reply before sending it.' : 'Write a reply before saving it.' }); return; }
    if (send && !canSend) return;
    pendingIds.current.add(id); setPending(previous => ({ ...previous, [id]: true }));
    setDraft(id, { error: '', message: '' });
    const instruction = draft.instruction.trim() || (mode === 'ai' ? 'Write a short, useful email from Kim C. based on the current purchases, latest customer request and previous correspondence. Do not repeat an answered question, old discount or payment request. Mention an attachment only if its original PDF and lot are verified.' : '');
    try {
      if (mode === 'ai' && draft.remember && instruction && onSaveRule) {
        try { const next = await onSaveRule({ rule: instruction }); if (mounted.current) setOptions(next); } catch { /* the draft request still goes ahead */ }
      }
      const reply = await onPrepareReply({ id, mode, purpose: draft.purpose, body: draft.body, instruction: mode === 'ai' ? instruction : '', expectedRevision: draft.revision, ...(draft.coa !== undefined ? { coaSha256: draft.coa } : {}), ...(send ? { send: true } : {}) });
      if (!mounted.current) return;
      setPreparedReplies(previous => ({ ...previous, [id]: reply }));
      setDrafts(previous => ({ ...previous, [id]: {
        ...newDraft(reply),
        body: mode === 'ai' ? (draft.body || '') : reply.body,
        undo: mode === 'ai' && draft.body.trim() ? draft.body : undefined,
        coa: draft.coa,
        message: send ? '' : mode === 'ai' ? '' : 'Draft saved. Nothing was sent.',
      } }));
    } catch (error) {
      if (mounted.current) setDraft(id, { error: (error instanceof Error ? error.message : 'That did not go through.') + ' Your text is still here.' });
    } finally {
      pendingIds.current.delete(id);
      if (mounted.current) setPending(previous => ({ ...previous, [id]: false }));
    }
  }
  function dictate(request: CustomerRequest) {
    const id = request.id;
    if (listening) { speech.current?.stop(); return; }
    const Recognition = speechRecognition();
    if (!Recognition) { setDraft(id, { error: 'This browser has no dictation. Use Chrome or Safari, or the Mac dictation key.' }); return; }
    const recognition = new Recognition();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US';
    const start = drafts[id]?.instruction ? drafts[id].instruction.trim() + ' ' : '';
    recognition.onresult = event => {
      let heard = '';
      for (let i = 0; i < event.results.length; i++) heard += event.results[i][0].transcript;
      setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] || newDraft(replyOf(id))), instruction: start + heard.trim(), error: '' } }));
    };
    recognition.onerror = event => { if (mounted.current) setDraft(id, { error: event?.error === 'not-allowed' ? 'Allow microphone access for this site to dictate.' : 'Dictation stopped. Try again.' }); };
    recognition.onend = () => { if (mounted.current) setListening(null); speech.current = null; };
    speech.current = recognition; setListening(id);
    try { recognition.start(); } catch { setListening(null); speech.current = null; }
  }
  async function forward(id: string) {
    if (!panel || panel.kind !== 'forward' || panel.busy || !onForward || !panel.to) return;
    setPanel({ ...panel, busy: true, error: '' });
    try {
      const sent = await onForward({ id, to: panel.to, note: panel.note.trim() });
      if (!mounted.current) return;
      setForwards(previous => ({ ...previous, [id]: [...(previous[id] || []), sent] }));
      setPanel(null);
    } catch (error) { if (mounted.current) setPanel(current => current && { ...current, busy: false, error: error instanceof Error ? error.message : 'Email status unconfirmed. Check the mail provider before retrying.' }); }
  }
  async function saveIssue(id: string, patch: Partial<{ issue: string; resolutions: string[]; note: string }>) {
    if (!onSaveIssue) return;
    const current = issues[id];
    const next = { issue: patch.issue ?? current?.issue ?? '', resolutions: patch.resolutions ?? current?.resolutions ?? [], note: patch.note ?? current?.note ?? '' };
    if (!next.issue) return;
    setIssues(previous => ({ ...previous, [id]: { ...(previous[id] || { updated: Date.now(), updatedBy: '' }), ...next } as RequestIssue }));
    try { const saved = await onSaveIssue({ id, ...next }); if (mounted.current) { setIssues(previous => ({ ...previous, [id]: saved })); setCases(null); } }
    catch (error) { if (mounted.current) { setIssues(previous => { const copy = { ...previous }; if (current) copy[id] = current; else delete copy[id]; return copy; }); setDraft(id, { error: error instanceof Error ? error.message : 'Could not save the case note. Try again.' }); } }
  }
  async function markRepliedNow(id: string) {
    if (!onMarkReplied || replyNote?.busy) return;
    const note = replyNote?.id === id ? replyNote.note : '';
    setReplyNote({ id, note, busy: true });
    try { const saved = await onMarkReplied({ id, note }); if (mounted.current) { setExternal(previous => ({ ...previous, [id]: [...(previous[id] || []), saved] })); setReplyNote(null); } }
    catch { if (mounted.current) setReplyNote({ id, note, busy: false }); }
  }
  async function openRules() {
    const next = !rulesOpen; setRulesOpen(next);
    if (next && onLoadCases) { try { const list = await onLoadCases(); if (mounted.current) setCases(list); } catch { if (mounted.current) setCases([]); } }
  }
  async function saveRule(input: { rule?: string; removeId?: string; issue?: string | null }) {
    if (!onSaveRule) return;
    try { const next = await onSaveRule(input); if (mounted.current) { setOptions(next); setNewRule(''); } } catch { /* the rules list stays as loaded */ }
  }

  const bridgeQuiet = options?.bridgeSeen != null && now - options.bridgeSeen > 3 * 60000;
  // Jarvis heals a stuck pass within minutes; 15 minutes of silence means it needs a person (Oct 14 2026).
  const bridgeStopped = options?.bridgeSeen != null && now - options.bridgeSeen > 15 * 60000;
  const active = rows.find(row => row.request.id === selected) || null;
  const siblings = active ? (family[emailKey(active.request)] || []).filter(r => r.id !== active.request.id && r.status !== 'deleted') : [];
  return <section className={styles.inbox} aria-labelledby="request-inbox-title" aria-busy={busy || refreshing}>
    <div className={styles.top}>
      <h2 id="request-inbox-title">Customer requests</h2>
      {options && <p className={styles.learning}>
        <button type="button" className={styles.link} aria-expanded={rulesOpen} onClick={() => void openRules()}>Issues &amp; rules ({options.rules.length} rules)</button>
      </p>}
    </div>
    {canSend && onRetireDrafts && Boolean(options?.legacyDrafts) && <div className={styles.note}>
      <button type="button" className={styles.action} disabled={disabled || cleanup.busy} onClick={async () => {
        setCleanup({busy:true,message:''});
        try { const result=await onRetireDrafts();setCleanup({busy:false,message:result.retired+' old unsent drafts removed. '+(result.pendingOutcomes ? result.pendingOutcomes+' send outcomes still need checking. ' : '')+(result.remainingApproved ? result.remainingApproved+' previously approved messages remain queued. ' : 'No messages queued to send.')});if(onLoadOptions)setOptions(await onLoadOptions()); }
        catch { setCleanup({busy:false,message:'Could not remove old drafts. Refresh and try again.'}); }
      }}>{cleanup.busy ? 'Removing…' : 'Remove old unsent drafts ('+options!.legacyDrafts+')'}</button>
      <span>Clears drafts from before this update. Sent messages and newer edits stay intact.</span>
    </div>}
    {cleanup.message && <p className={styles.note} role="status">{cleanup.message}</p>}
    {rulesOpen && options && <div className={styles.rules}>
      <p className={styles.note}>Every case you tag, and how you resolved it, collects here. Write the rule once you know how you want that kind of case handled; the AI follows the general rules on every draft and an issue's rules on that kind of case.</p>
      {[['', 'General (every reply)'] as const, ...issueTypes].map(([key, label]) => {
        const rules = options.rules.filter(rule => (rule.issue || '') === key);
        const list = key ? (cases || []).filter(c => c.issue === key) : [];
        if (key && !rules.length && !list.length) return null;
        const tally = resolutionTypes.map(([r, rl]) => [rl, list.filter(c => c.resolutions.includes(r)).length] as const).filter(([, n]) => n > 0);
        return <section key={key || 'general'} className={styles.ruleGroup}>
          <h3>{label}{key ? <span className={styles.note}> · {list.length} case{list.length === 1 ? '' : 's'}</span> : null}</h3>
          {tally.length > 0 && <p className={styles.note}>How you handled them: {tally.map(([rl, n]) => `${rl} ${n}`).join(' · ')}</p>}
          {list.length > 0 && <ul className={styles.caseList}>{list.slice(0, 6).map(c => <li key={c.requestId}><button type="button" className={styles.link} onClick={() => { setRulesOpen(false); open(c.requestId); }}>{c.name || 'Customer'}</button> <span className={styles.note}>{when(c.updated)}{c.resolutions.length ? ' · ' + c.resolutions.map(resolutionLabel).join(', ') : ''}{c.note ? ' · ' + c.note : ''}</span></li>)}</ul>}
          {rules.length ? <ol>{rules.map(rule => <li key={rule.id}><span>{rule.rule}</span><button type="button" className={styles.link} onClick={() => void saveRule({ removeId: rule.id })}>Remove</button></li>)}</ol> : <p className={styles.note}>No rule yet.</p>}
        </section>;
      })}
      {cases === null && onLoadCases && <p className={styles.note}>Loading cases…</p>}
      <form className={styles.ruleForm} onSubmit={event => { event.preventDefault(); if (newRule.trim()) void saveRule({ rule: newRule.trim(), issue: ruleIssue || null }); }}>
        <select value={ruleIssue} onChange={event => setRuleIssue(event.target.value)} aria-label="Rule applies to"><option value="">Every reply</option>{issueTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <input value={newRule} maxLength={500} onChange={event => setNewRule(event.target.value)} placeholder="e.g. Out of stock: offer wait, refund, store credit, or a substitute plus 30% off the next order." aria-label="New reply rule"/>
        <button type="submit" className={styles.action} disabled={!newRule.trim()}>Add rule</button>
      </form>
    </div>}
    {bridgeQuiet && (bridgeStopped
      ? <p className={styles.alarm} role="alert">Jarvis stopped checking in at {when(options!.bridgeSeen!)}. Until it is back, AI drafts, your sends and customers' email replies are on hold. Check that your Mac is awake and Jarvis is running.</p>
      : <p className={styles.warning} role="status">Jarvis last checked in at {when(options!.bridgeSeen!)}. AI drafts and sends wait until your Mac is awake and Jarvis is running.</p>)}
    {onRefreshReplies && <p className={styles.note} role="status">{refreshError || (checkedAt ? 'Updated ' + new Date(checkedAt).toLocaleString() : 'Checking for new requests…')}</p>}
    {focusId && snapshot?.base === initialRequests && snapshot.focus === focusId.split('|')[0] && !requests.some(request => request.id === snapshot.focus) && <p className={styles.warning} role="status">The linked request could not be found. You can search the loaded requests below.</p>}
    {dirty && <p role="status">Save or discard your unsaved admin edits before changing a request.</p>}
    <div className={styles.toolbar}>
      <div className={styles.filters} role="group" aria-label="Filter customer requests">{views.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span>{counts[value]}</span></button>)}</div>
      <label className={styles.search}><span className={styles.hidden}>Find a request</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, email or words"/></label>
    </div>
    <div className={styles.desk} data-open={active ? 'true' : 'false'}>
      <div className={styles.list} role="list" aria-label="Requests">
        {!grouped.length ? <p className={styles.empty}>{requests.length ? (filter === 'todo' ? 'Nothing waiting for a reply.' : filter === 'done' ? 'Nothing archived yet. Requests move here once a reply is sent or you archive them.' : 'No requests here.') : 'No customer requests yet.'}</p> : grouped.map(row => {
          const { request, reply } = row;
          const name = text(request.data.name) || text(request.data.email) || 'Customer';
          const form = coaFormDetails(request);
          const preview = form ? 'COA request form' + (form.lot ? ' · lot ' + form.lot : '') : text(request.data.message) || text(request.data.subject);
          // VIP (partner, business buyer, met at a show): owner, Oct 24 2026.
          const vip = vipSignal(text(request.data.email), text(request.data.subject) + ' ' + text(request.data.message));
          const late = row.late;
          return <article key={request.id} role="listitem" className={styles.row} data-selected={selected === request.id ? 'true' : 'false'}>
            <button type="button" className={styles.rowButton} aria-expanded={selected === request.id} aria-controls={`request-reply-${request.id}`} onClick={() => open(request.id)}>
              <span className={styles.rowTop}><strong>{vip.vip && <span title={'VIP: ' + vip.why} aria-label={'VIP: ' + vip.why}>⭐ </span>}{name}</strong>{row.count > 1 && <span className={styles.age}>{row.count} requests</span>}</span>
              <span className={styles.rowSubject}>{text(request.data.subject) || (request.kind === 'affiliate' ? 'Partner application' : request.kind === 'stock' ? 'Product availability' : 'Website message')}</span>
              <span className={styles.rowPreview}>{preview}</span>
              <span className={styles.rowState} data-stage={row.stage}>{row.label}{reply?.coa?.state === 'matched' && row.stage === 'todo' ? ' · COA' : ''}</span>
              {row.stage === 'todo' && <span className={late ? styles.late : styles.rowPreview}>{row.when}</span>}
            </button>
          </article>;
        })}
      </div>
      {/* A plain render function (no hooks), so the open conversation is part of this tree. */}
      {active ? conversation({ row: active, draft: drafts[active.request.id], automation, options, attachmentRead: attachmentRead?.key === attachmentKey ? attachmentRead : null, onRetryAttachments: () => setAttachmentRetry(v => v + 1), attachmentCheckingAvailable: Boolean(onCheckAttachments), canSend, disabled, listening: listening === active.request.id, preparing: Boolean(pending[active.request.id]), bodyField, now,
        onClose: () => setSelected(null),
        onEdit: (field, value) => editDraft(active.request.id, field, value),
        onDraft: patch => setDraft(active.request.id, patch),
        onInsert: snippet => insertAtCursor(active.request.id, snippet),
        onSubmit: (mode, send, instruction) => void submit(active.request, mode, send, instruction),
        onDictate: () => dictate(active.request),
        onStatus: status => { if (disabled) return; setPanel(null);
          // Archive, spam, delete or restore the customer's whole conversation, one request at a time.
          const targets = [active.request, ...siblings.filter(r => r.status !== status && (status === 'new' ? ['resolved', 'spam', 'deleted'].includes(r.status) : !['spam', 'deleted'].includes(r.status)))];
          void (async () => { for (const target of targets) await onStatus(target, status); })(); },
        siblings: siblings.map(r => ({ request: r, reply: replyOf(r.id), external: external[r.id] || [] })),
        templates: templates[active.request.id] || [], customerEvidence: customerEvidence[active.request.id],
        external: external[active.request.id] || [], canMarkReplied: Boolean(onMarkReplied),
        markNote: replyNote?.id === active.request.id ? replyNote.note : null,
        onMarkNote: note => setReplyNote(note === null ? null : { id: active.request.id, note, busy: false }),
        onMarkReplied: () => void markRepliedNow(active.request.id),
        issue: issues[active.request.id] || null, canTag: Boolean(onSaveIssue), onIssue: patch => void saveIssue(active.request.id, patch),
        issueNote: issueDrafts[active.request.id]?.note ?? issues[active.request.id]?.note ?? '', onIssueNote: note => setIssueDrafts(previous => ({ ...previous, [active.request.id]: { note } })),
        forwards: forwards[active.request.id] || [], activity: activity[active.request.id] || [], team: options?.team || [], canForward: Boolean(onForward),
        panel: panel?.id === active.request.id ? panel : null,
        onPanel: next => setPanel(next ? { id: active.request.id, to: '', note: '', busy: false, error: '', ...(panel?.id === active.request.id ? panel : {}), ...next } as any : null),
        onForward: () => void forward(active.request.id) })
        : <div className={styles.placeholder}><p>Pick a request on the left to see its history and create a reply.</p></div>}
    </div>
  </section>;
}

type ConversationProps = {
  row: { request: CustomerRequest; reply?: ReplySummary; stage: Stage; label: string; since: number; when: string; late: boolean };
  draft?: Draft; automation?: CoaAutomationReport | null; options: DeskOptions | null; canSend: boolean; disabled: boolean; listening: boolean; preparing: boolean; now: number;
  attachmentRead: AttachmentRead | null; onRetryAttachments: () => void; attachmentCheckingAvailable: boolean;
  bodyField: { current: HTMLTextAreaElement | null };
  onClose: () => void; onEdit: (field: 'body' | 'instruction', value: string) => void; onDraft: (patch: Partial<Draft>) => void; onInsert: (snippet: string) => void;
  onSubmit: (mode: 'ai' | 'staff', send?: boolean, instruction?: string) => void; onDictate: () => void; onStatus: (status: string) => void;
  forwards: RequestForward[]; team: TeamMember[]; canForward: boolean; activity: { at: number; text: string }[];
  siblings: { request: CustomerRequest; reply?: ReplySummary; external: ExternalReply[] }[];
  templates: { id: string; label: string; why: string; body: string }[];
  customerEvidence?: CustomerContext | null;
  external: ExternalReply[]; canMarkReplied: boolean; markNote: string | null; onMarkNote: (note: string | null) => void; onMarkReplied: () => void;
  issue: RequestIssue | null; canTag: boolean; onIssue: (patch: Partial<{ issue: string; resolutions: string[]; note: string }>) => void; issueNote: string; onIssueNote: (note: string) => void;
  panel: { kind: 'forward' | 'delete'; to: string; note: string; busy: boolean; error: string } | null;
  onPanel: (next: Partial<{ kind: 'forward' | 'delete'; to: string; note: string; busy: boolean; error: string }> | null) => void; onForward: () => void;
};
/** The catalog name may already contain its strength. Show it once. */
export function coaProductLabel(coa: { productName?: string; strength?: string }) {
  const name = coa.productName || 'COA', strength = coa.strength || '';
  const compact = (value: string) => value.toLowerCase().replace(/\s+/g, '');
  return !strength || compact(name).endsWith(compact(strength)) ? name : `${name} ${strength}`;
}
/** Only checkout follow-ups need a payment warning in the everyday reply flow. */
export function replyPurchaseNotice(request: CustomerRequest, evidence?: CustomerContext | null): string | null {
  if (request.data.origin !== 'order') return null;
  if (!evidence || evidence.purchaseHistory.state !== 'available') return 'Purchase history could not be confirmed. Check payment before asking the customer to pay.';
  const currentNumber = text(request.data.orderId).slice(0, 8).toUpperCase();
  const paid = evidence.orders.find(order => order.environment === 'live' && order.status.startsWith('payment recorded'));
  if (paid) return `${paid.number === currentNumber ? 'Payment is recorded for' : 'Another paid order is on file:'} #${paid.number}. Check that order before sending a payment reminder.`;
  const refunded = evidence.orders.find(order => order.number === currentNumber && order.status === 'refunded');
  if (refunded) return `Order #${refunded.number} was refunded. Check the refund before following up.`;
  const current = evidence.orders.find(order => order.number === currentNumber);
  if (current && /payment.*(?:not confirmed|pending|verification)/.test(current.status)) return `Payment is not confirmed for order #${current.number}. Check payment before asking the customer to pay.`;
  return null;
}
function conversation({ row, draft, automation, options, attachmentRead, onRetryAttachments, attachmentCheckingAvailable, canSend, disabled, listening, preparing, bodyField, now, onClose, onEdit, onDraft, onInsert, onSubmit, onDictate, onStatus, forwards, team, canForward, panel, onPanel, onForward, activity, siblings, templates, customerEvidence, external, canMarkReplied, markNote, onMarkNote, onMarkReplied, issue, canTag, onIssue, issueNote, onIssueNote }: ConversationProps) {
  const { request, reply } = row;
  const email = text(request.data.email), canReply = usableEmail(request.data.email);
  const name = text(request.data.name) || email || 'Customer';
  const subject = text(request.data.subject) || (request.kind === 'affiliate' ? 'Partner application' : request.kind === 'stock' ? 'Product availability' : 'Website message');
  const website = websiteLink(request.data.website);
  const previousCoa = automation?.requests?.[request.id]?.coa;
  const writing = working(reply), sending = sendPending(reply);
  const locked = disabled || preparing || sending;
  const conflict = Boolean(draft && draft.revision !== (reply?.revision ?? null));
  const fromOrder = request.data.origin === 'order';
  const allHistory = reply?.history?.length ? reply.history : [{ id: 'original:' + request.id, direction: 'incoming' as const, body: text(request.data.message), created: request.created }];
  // An order conversation starts with internal order notes, shown to staff only.
  const history = fromOrder ? allHistory.filter(m => !m.id.startsWith('original:')) : allHistory;
  const coaChoice = draft?.coa !== undefined ? draft.coa : (reply?.coaChoice ?? null);
  // Several reports can ride on one reply (comma-separated choice).
  const chosenList = coaChoice ? coaChoice.split(',').map(sha => options?.coas.find(c => c.sha256 === sha)).filter((c): c is DeskCoa => Boolean(c)) : [];
  const checkedCoa = attachmentRead?.result?.coa;
  const attachedNow = checkedCoa?.state === 'matched' && coaChoice !== '' ? checkedCoa : null;
  const checkingAttachments = attachmentCheckingAvailable && !attachmentRead?.result && !attachmentRead?.error;
  const attachmentsBlocked = coaChoice !== '' && (checkingAttachments || Boolean(attachmentRead?.error) || (Boolean(coaChoice) && !attachedNow));
  const draftProblem = attachedNow && draft?.body.trim() ? matchedCoaReplyProblem(draft.body) : null;
  const nextPurchaseOffer = options?.codes.find(code => code.code === 'BIOMOD15' && code.percentOff === 15);
  const selectedHashes = coaChoice ? coaChoice.split(',') : attachedNow ? [attachedNow, ...(attachedNow.extras || [])].map(c => c.sha256).filter((sha): sha is string => Boolean(sha)) : [];
  const setChoice = (list: string[]) => onDraft({ coa: list.join(','), edited: true });
  const isCoaRequest = /\bCOA\b|certificate of analysis/i.test(subject);
  const coaForm = coaFormDetails(request);
  const lastSent = history.filter(m => m.direction === 'outgoing' && m.source !== 'recovery').sort((a, b) => b.created - a.created)[0];
  // The newest reply by any channel: this desk, Gmail, or a logged call/text.
  const lastExternal = external.filter(e => e.verified !== false).sort((a, b) => b.at - a.at)[0];
  const lastReplied = lastSent && (!lastExternal || lastSent.created >= lastExternal.at)
    ? { at: lastSent.created, how: '' }
    : lastExternal ? { at: lastExternal.at, how: lastExternal.source === 'manual' ? 'by phone or text' : 'from Gmail' } : null;
  const firstName = name === email ? 'the customer' : name.split(/\s+/)[0] || 'the customer';
  // One list of every email in this conversation, each labelled in plain words: who wrote it, to whom, how, and who sent it.
  type Item = { id: string; direction: 'incoming' | 'outgoing' | 'request'; created: number; body: string; title: string; detail: string; by?: string; attachment?: string; source?: 'recovery' };
  const deskItem = (m: ReplySummary['history'][number]): Item => ({ id: m.id, direction: 'outgoing', created: m.created, body: m.body, ...(m.source ? { source: m.source } : {}), title: m.source === 'recovery' ? 'Automatic checkout reminder' : 'You emailed ' + firstName,
    by: m.source === 'recovery' ? 'accepted by email provider; delivery unconfirmed' : m.sentBy ? 'sent by ' + personName(m.sentBy, team) : 'sent from this reply desk',
    detail: m.source === 'recovery' ? 'Accepted by the email provider. Inbox delivery is not confirmed.' : ['From ' + (m.from || sender) + ' to ' + (m.to || email), m.sentBy ? 'Sent by ' + personName(m.sentBy, team) : 'Sent from this reply desk', m.subject ? 'Subject: ' + m.subject : ''].filter(Boolean).join(' · '),
    ...(m.attachment ? { attachment: m.attachment } : {}) });
  const outsideItems = (list: ExternalReply[], tag: string): Item[] => list.map((e, i) => e.source === 'manual'
    ? { id: 'ext-' + tag + i + '-' + e.at, direction: 'outgoing', created: e.at, body: e.body + (e.preview ? ' …' : ''), title: 'Answered outside email', by: 'by phone or text', detail: 'Logged as answered by phone or text by ' + personName(e.account, team) }
    : { id: 'ext-' + tag + i + '-' + e.at, direction: 'outgoing', created: e.at, body: e.body + (e.preview ? ' …' : ''), title: 'You emailed ' + firstName, by: 'sent in Gmail from ' + e.account, detail: 'Sent in Gmail from ' + e.account + ' to ' + email });
  const originalItem = (source: CustomerRequest): Item => {
    const form = coaFormDetails(source);
    return { id: 'original:' + source.id, direction: form ? 'request' : 'incoming', created: source.created,
      title: form ? 'COA request form' : 'Customer message',
      detail: form ? 'Submitted from the website. No written message was included.' : 'From ' + (text(source.data.email) || email),
      body: form ? [form.product ? 'COA requested: ' + form.product : 'Certificate of Analysis requested', form.lot ? 'Lot entered: ' + form.lot : 'Lot not recorded'].join('\n') : text(source.data.message) };
  };
  const thread: Item[] = (() => {
    const seen = new Set<string>();
    const sources = [request, ...siblings.map(sib => sib.request)];
    const all: Item[] = [
      ...history.flatMap(m => {
        if (m.direction === 'outgoing') return [deskItem(m)];
        const original = sources.find(source => m.id === 'original:' + source.id);
        if (original?.data.origin === 'order') return [];
        return [original ? originalItem(original) : { id: m.id, direction: 'incoming' as const, created: m.created, body: m.body, title: m.id.startsWith('original:') ? 'Website submission' : 'Customer message', detail: 'From ' + email }];
      }),
      ...outsideItems(external.filter(e => e.verified !== false), 'a'),
      ...siblings.flatMap(sib => [
        ...(sib.request.data.origin === 'order' ? [] : [originalItem(sib.request)]),
        ...(sib.reply?.history || []).filter(m => m.direction === 'outgoing').map(deskItem),
        ...outsideItems(sib.external.filter(e => e.verified !== false), sib.request.id),
      ]),
    ];
    return all.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; }).sort((a, b) => a.created - b.created);
  })();
  const outgoingContactCount = thread.filter(m => m.direction === 'outgoing').length;
  const sentCount = thread.filter(m => m.direction === 'outgoing' && m.source !== 'recovery').length;
  const lastOutItem = [...thread].reverse().find(m => m.direction === 'outgoing' && m.source !== 'recovery');
  const latestRequest = [...thread].reverse().find(m => m.direction !== 'outgoing');
  const earlierMessages = thread.filter(m => m.id !== latestRequest?.id);
  const attachmentEmail = (message: Item) => message.direction === 'incoming'
    ? message.body.match(/^Customer replied with an attachment\. Open original email to view\.\n(https:\/\/mail\.google\.com\/mail\/u\/\?authuser=(?:contact%40trybiomod\.com|research%40biomodpeptides\.com)#all\/[a-f0-9]{8,200})$/i)?.[1] : undefined;
  const renderMessage = (message: Item) => <li key={message.id} data-direction={message.direction}>
    <p className={styles.mailTitle}><strong>{message.title}</strong><span>{when(message.created)}</span></p>
    <p className={styles.meta}>{message.detail}</p>
    <p className={styles.message}>{attachmentEmail(message) ? 'Customer replied with an attachment.' : message.body || 'No message text was included.'}</p>
    {attachmentEmail(message) && <a href={attachmentEmail(message)} target="_blank" rel="noopener noreferrer">Open original email</a>}
    {message.attachment && <p className={styles.mailAttachment}>Attached: {message.attachment}</p>}
  </li>;
  // The first thing on the screen: is this done, or does it need me? (owner, Oct 16: "why is he still here... what am I to do?")
  const verdict = (() => {
    if (request.status === 'deleted') return { tone: 'done', text: 'Deleted.', hint: 'Restore it if you need to answer.' };
    if (request.status === 'spam') return { tone: 'done', text: 'Marked as spam.', hint: 'Nothing to do.' };
    if (sending) return { tone: 'done', text: 'Sending now.', hint: 'Nothing else to do.' };
    if (issue?.issue === 'owner_review' && request.status !== 'resolved') return { tone: 'todo', text: 'Owner review required.', hint: issue.note || 'An owner must review this case before sending.' };
    if (row.stage === 'pitch') return { tone: 'done', text: 'Sales pitch.', hint: 'No reply needed.' };
    if (fromOrder && !latestRequest) return { tone: 'done', text: 'Optional follow-up.', hint: outgoingContactCount ? 'Prior contact is recorded below. Check the purchase history before writing again.' : 'The customer has not written in. Check their history before contacting them.' };
    if (row.stage === 'todo') return { tone: 'todo', text: sentCount ? 'Needs your reply.' : fromOrder ? 'Needs your first email.' : 'Needs your reply.', hint: sentCount ? 'The customer wrote again.' : 'No reply sent yet.' };
    if (request.status === 'resolved') return { tone: 'done', text: 'Done. Nothing to do.', hint: `Archived. If ${firstName} writes back, it moves to Needs reply on its own.` };
    return { tone: 'done', text: `Waiting on ${firstName}.`, hint: `Nothing to do now. Archive it to clear it; if ${firstName} writes back, it moves to Needs reply on its own.` };
  })();
  let status = '';
  if (sending) status = reply?.status === 'sending' ? 'Sending from ' + sender + '…' : 'Queued to send automatically. No second Send is needed in Jarvis. Your Mac must be awake.';
  else if (preparing) status = 'Saving…';
  else if (writing) status = reply?.mode === 'ai' ? 'AI is writing. This usually takes under a minute.' : 'Saving the draft…';
  else if (draft?.edited) status = 'Not sent. Review your reply, then send when ready.';
  else if (reply?.status === 'ready' && reply.mode === 'ai' && !draft?.edited) status = 'Draft prepared. Not sent.';
  else if (reply?.status === 'ready') status = 'Draft saved. Not sent.';
  return <section key={request.id} className={styles.pane} id={`request-reply-${request.id}`} aria-label={`Reply to ${name}`} aria-busy={writing || sending}>
    <header className={styles.paneHead}>
      <button type="button" className={styles.back} onClick={onClose}>Back to list</button>
      <div className={styles.who}><h3>{name}</h3>{(name !== email || website) && <p>{email || 'No email address saved'}{website && <> · <a href={website} target="_blank" rel="noopener noreferrer">Website</a></>}</p>}</div>
      <div className={styles.paneActions}>
        {request.status === 'deleted'
          ? <button type="button" className={styles.action} disabled={disabled} onClick={() => onStatus('new')}>Restore</button>
          : request.status === 'spam' || request.status === 'resolved'
          ? <button type="button" className={styles.action} disabled={disabled} onClick={() => onStatus('new')}>Move to To reply</button>
          : <button type="button" className={styles.action} disabled={disabled} onClick={() => onStatus('resolved')}>Archive</button>}
        {request.status !== 'deleted' && <details className={styles.actionMenu}>
          <summary>More actions</summary>
          <div className={styles.menuItems}>
            {canForward && <button type="button" className={styles.link} disabled={disabled} onClick={() => onPanel(panel?.kind === 'forward' ? null : { kind: 'forward', error: '' })}>Forward</button>}
            {!['spam', 'resolved'].includes(request.status) && <button type="button" className={styles.link} disabled={disabled} onClick={() => onStatus('spam')}>Spam</button>}
            <button type="button" className={styles.link} disabled={disabled} onClick={() => onPanel(panel?.kind === 'delete' ? null : { kind: 'delete', error: '' })}>Delete</button>
          </div>
        </details>}
      </div>
    </header>
    {row.stage === 'pitch' && <p className={styles.warning}>{row.label === 'Sales pitch' ? 'Tagged as a sales pitch. It stays out of Needs reply.' : 'This reads like a supplier or vendor pitch, so it is kept out of Needs reply.'} <button type="button" className={styles.link} onClick={() => onIssue({ issue: 'other' })}>Not a sales pitch</button>{row.label !== 'Sales pitch' && <> · <button type="button" className={styles.link} onClick={() => onIssue({ issue: 'vendor' })}>Yes, a sales pitch</button></>}</p>}
    {panel?.kind === 'delete' && <div className={styles.confirm} role="alertdialog" aria-label="Delete this request">
      <p>Delete this request from the inbox? It moves to Deleted, where you can restore it. Nothing is sent to the customer.</p>
      <button type="button" className={styles.danger} disabled={disabled} onClick={() => onStatus('deleted')}>Delete</button>
      <button type="button" className={styles.link} onClick={() => onPanel(null)}>Cancel</button>
    </div>}
    {panel?.kind === 'forward' && <div className={styles.forward}>
      <label><span>Forward to</span><select value={panel.to} disabled={panel.busy} onChange={event => onPanel({ to: event.target.value, error: '' })}>
        <option value="">{team.length ? 'Choose a team member' : 'No team members yet (add them under Team)'}</option>
        {team.map(member => <option key={member.email} value={member.email}>{member.name ? member.name + ' · ' : ''}{member.email}{member.role === 'owner' ? ' (owner)' : ''}</option>)}
      </select></label>
      <label><span>Note (optional)</span><textarea name="forwardNote" rows={2} maxLength={2000} value={panel.note} disabled={panel.busy} onChange={event => onPanel({ note: event.target.value })} placeholder="e.g. Can you check this order and reply to the customer?"/></label>
      {panel.error && <p className={styles.error} role="alert">{panel.error}</p>}
      <div className={styles.sendRow}><button type="button" className={styles.send} disabled={panel.busy || !panel.to} onClick={onForward}>{panel.busy ? 'Forwarding…' : 'Forward'}</button><button type="button" className={styles.link} onClick={() => onPanel(null)}>Cancel</button><span className={styles.note}>The customer is not emailed. Replies to the forward come back to you.</span></div>
    </div>}
    <div className={styles.summary} data-waiting={verdict.tone === 'todo' ? 'true' : 'false'} role="status">
      <p className={styles.verdict}><strong>{verdict.text}</strong> {verdict.hint}</p>
    </div>
    {siblings.length > 0 && <p className={styles.note}>{siblings.length + 1} related records in this conversation.</p>}
    {!coaForm && <p className={styles.subjectLine}><strong>{subject}</strong></p>}
    {replyPurchaseNotice(request, customerEvidence) && <p className={styles.warning} role="status">{replyPurchaseNotice(request, customerEvidence)}</p>}
    {latestRequest && <section aria-label={latestRequest.direction === 'request' ? 'What they requested' : 'Customer message'}>
      <h4 className={styles.threadHead}>{latestRequest.direction === 'request' ? 'What they requested' : 'Customer message'}</h4>
      <ol className={styles.thread} aria-label="Latest customer request">{renderMessage(latestRequest)}</ol>
    </section>}
    {request.status === 'deleted' && <p className={styles.warning}>This request is deleted. Restore it to reply.</p>}
    {request.kind === 'affiliate' && <p className={styles.note}>Partner application. Agree terms and create the code under Affiliate &amp; promo codes before promising one.</p>}
    {request.kind === 'stock' && <p className={styles.note}>Check stock under Products before promising a date.</p>}
    {previousCoa?.status === 'accepted' && <p className={styles.note}>An earlier automatic COA email to this customer was accepted by the mail provider.</p>}
    {request.status === 'deleted' ? null : !canReply ? <p className={styles.warning}>No usable email address was saved, so there is no way to reply.</p> : !draft ? null : <div className={styles.composer}>
      <div className={styles.composeHead}><strong>Reply as Kim C.</strong><span>To {reply?.recipient || email}</span></div>
      {lastReplied && <p className={styles.replied} role="status">
        Last recorded reply: {when(lastReplied.at)}{lastReplied.how ? ' ' + lastReplied.how : ''}. {row.stage === 'todo' ? firstName + ' wrote back since. ' : ''}Anything you write here goes out as a new email.
      </p>}
      {coaForm && !attachedNow && !sending && <button type="button" className={styles.link} style={{ justifySelf: 'start' }} disabled={locked || writing || conflict} onClick={() => onDraft({ body: 'Hi, could you send a clear photo of your vial label showing the product name and lot number? I want to make sure I send you the correct lab report. Thank you.', coa: '', undo: draft.body || undefined, edited: true })}>Use a short request for a label photo</button>}
      {!draft.body.trim() && !writing && !attachedNow && <button type="button" className={styles.action} disabled={locked || conflict || (coaChoice !== '' && checkingAttachments)} onClick={() => onSubmit('ai')}>Create AI draft</button>}
      <label className={styles.draftLabel} htmlFor={`reply-body-${request.id}`}>Email to send <span>{writing ? 'AI is writing…' : draft.body.trim() ? 'Review and edit before sending' : 'Create a draft or write here'}</span></label>
      <textarea id={`reply-body-${request.id}`} ref={bodyField} name="replyBody" rows={7} maxLength={12000} value={draft.body} readOnly={writing} disabled={locked}
        onChange={event => onEdit('body', event.target.value)}
        placeholder={writing ? 'The AI is writing…' : lastReplied ? `Write a new message to ${firstName}…` : 'Your AI draft will appear here. You can also write your own.'} data-writing={writing ? 'true' : 'false'}/>
      <p className={styles.note}>Kim C. · BioMod Customer Care · {sender}</p>
      {(status || draft.undo) && <p className={styles.status} role="status">{status}{draft.undo && !writing && !sending && <> <button type="button" className={styles.link} onClick={() => onDraft({ body: draft.undo!, undo: undefined, edited: true })}>Undo change</button></>}</p>}
      {reply?.reason && reply.status !== 'sent' && !sending && !(attachedNow && matchedCoaReplyProblem(reply.reason)) && <p className={styles.warning}>{friendlyReason(reply.reason)}</p>}
      {nextPurchaseOffer && !new RegExp(`\\b${nextPurchaseOffer.code}\\b`, 'i').test(draft.body) && <button type="button" className={styles.link} disabled={locked || writing || conflict || !draft.body.trim()} onClick={() => onDraft({ body: appendNextPurchaseOffer(draft.body, nextPurchaseOffer), edited: true })}>Add 15% off the next purchase</button>}
      <section className={styles.coaPicker} aria-label="COA attachments" aria-busy={checkingAttachments}>
        <strong>{checkingAttachments && coaChoice !== '' ? 'Checking the original PDF…' : attachedNow ? `${1 + (attachedNow.extras?.length || 0)} PDF${attachedNow.extras?.length ? 's' : ''} attached to this draft` : 'No PDF attached'}</strong>
        {typeof request.data?.labelLot === 'string' && <p className={styles.note}>Requested lot: <strong>{request.data.labelLot}</strong></p>}
        {attachedNow && <ul className={styles.attachmentList}>{[attachedNow, ...(attachedNow.extras || [])].map((c, i) => <li key={c.sha256 || i}>
          <strong>{c.filename || 'Original COA.pdf'}</strong>{canSend && c.sha256 && <a href={`/api/store/admin-coa-original?ref=private:${c.sha256}`} target="_blank" rel="noopener noreferrer">View PDF</a>}<span>{coaProductLabel(c)} · lot {c.lot}</span>
          <span className={styles.note}>Lot matched. This PDF will be sent with the email above.</span>
        </li>)}</ul>}
        {coaChoice !== '' && !attachedNow && !checkingAttachments && <p className={styles.attachmentProblem} role="status">{attachmentRead?.error || (checkedCoa?.state === 'needs_review' || checkedCoa?.state === 'already_sent' ? checkedCoa.reason : chosenList.length ? 'This selection has not been verified. It is not attached yet.' : isCoaRequest ? 'Choose a report below, or ask for a clear photo of the vial label.' : 'You can send this email without an attachment.')}</p>}
        {chosenList.length > 0 && !attachedNow && <p className={styles.note}>Selected: {chosenList.map(coaProductLabel).join(', ')}{checkingAttachments ? '. Checking…' : '. Not attached.'}</p>}
        <div className={styles.attachmentActions}>
          <label className={styles.reportSelect}><span>{attachedNow ? 'Add another COA PDF' : 'Attach COA PDF'}</span><select aria-label="Attach COA PDF" value="" disabled={locked || writing || conflict || !options} onChange={event => { const v = event.target.value; if (v && !selectedHashes.includes(v)) setChoice([...selectedHashes, v]); }}>
            <option value="">{options ? 'Choose product and lot…' : 'Loading reports…'}</option>
            {options?.coas.filter(coa => !selectedHashes.includes(coa.sha256)).map(coa => <option key={coa.sha256} value={coa.sha256} disabled={selectedHashes.length >= 5}>{coaProductLabel(coa)} · lot {coa.lot}{coa.current ? ' (current)' : ''}</option>)}
          </select></label>
          {(attachedNow || chosenList.length > 0) && <button type="button" className={styles.link} disabled={locked || writing} onClick={() => onDraft({ coa: '', edited: true })}>Remove {attachedNow ? 'PDFs' : 'selection'}</button>}
          {isCoaRequest && coaChoice !== null && <button type="button" className={styles.link} disabled={locked || writing} onClick={() => onDraft({ coa: null, edited: true })}>Find matching report</button>}
          {coaChoice !== '' && !attachedNow && chosenList.length === 0 && (Boolean(attachmentRead?.error) || isCoaRequest) && <button type="button" className={styles.link} disabled={locked || writing || conflict} onClick={() => onDraft({ coa: '', edited: true })}>Reply without a PDF</button>}
          {attachmentRead?.error && <button type="button" className={styles.link} disabled={locked || writing} onClick={onRetryAttachments}>Retry PDF check</button>}
        </div>
      </section>
      {draftProblem && <div className={styles.warning} role="alert"><p>{draftProblem}</p><button type="button" className={styles.action} disabled={locked || writing || conflict} onClick={() => { if (attachedNow) { let body = preparedCoaReply(attachedNow); const offer = options?.codes.find(code => new RegExp(`\\b${code.code}\\b`, 'i').test(draft.body)); if (offer) body = appendNextPurchaseOffer(body, offer); onDraft({ body, edited: true, error: '', message: 'Matched-report reply prepared. Not sent.' }); } }}>Use the matched-report reply</button></div>}
      <div className={styles.sendRow}>
        {canSend
          ? <button type="button" className={styles.send} disabled={locked || conflict || writing || attachmentsBlocked || Boolean(draftProblem) || !draft.body.trim()} onClick={() => onSubmit('staff', true)}>{sending ? 'Sending…' : issue?.issue === 'owner_review' ? 'Approve and send' : attachedNow ? 'Send email + PDF' : 'Send email'}</button>
          : <p className={styles.note}>Your account can save drafts. An authorized sender can send from this screen.</p>}
        <button type="button" className={styles.link} disabled={locked || conflict || writing || !draft.body.trim()} onClick={() => onSubmit('staff')}>Save draft</button>
        {draft.purpose === 'checkout_recovery' && <button type="button" className={styles.link} disabled={locked || conflict || writing} onClick={() => onDraft({ purpose: 'reply', body: '', instruction: '', undo: undefined, edited: true, message: 'New message. Write about the customer’s current question.' })}>Start a new message</button>}
      </div>
      <details className={styles.more}><summary>Edit with AI (optional)</summary>
      <div className={styles.draftTools}>
        <button type="button" className={styles.action} disabled={locked || conflict || writing || (coaChoice !== '' && checkingAttachments)} onClick={() => onSubmit('ai')}>{writing ? 'Creating AI draft…' : draft.body.trim() ? 'Apply changes' : 'Create AI draft'}</button>
        <span className={styles.note}>Changes the email above. Nothing is sent.</span>
        <label className={styles.aiInstruction}><span>Anything to add or change? (optional)</span><textarea name="replyInstruction" rows={1} maxLength={2000} value={draft.instruction} disabled={locked || writing} onChange={event => onEdit('instruction', event.target.value)} placeholder="For example: make it shorter"/></label>
        <button type="button" className={styles.link} aria-pressed={listening} disabled={locked && !listening} onClick={onDictate}>{listening ? 'Stop dictation' : 'Dictate instructions'}</button>
      </div>
      </details>
      {issue?.issue === 'owner_review' && <p className={styles.note}>{canSend ? 'You are reviewing this as the owner. Approve and send records your approval and sends the reply as Kim C.' : 'Save a draft for the owner. This case requires their approval.'}</p>}
      {canTag && request.status !== 'resolved' && issue?.issue !== 'owner_review' && <details className={styles.ownerReview}>
        <summary>Needs an owner decision?</summary>
        <label><span>Reason for owner review</span><textarea name="ownerReviewReason" rows={2} maxLength={1000} value={issueNote} disabled={locked} onChange={event => onIssueNote(event.target.value)} placeholder="Explain the decision needed, such as a payment dispute, safety concern or legal request."/></label>
        <button type="button" className={styles.action} disabled={locked || !issueNote.trim()} onClick={() => onIssue({ issue: 'owner_review', note: (issue?.issue ? 'Previous issue: ' + issueLabel(issue.issue) + '. ' : '') + issueNote.trim() })}>Mark for owner review</button>
        <p className={styles.note}>Keeps the case in Needs reply and records the reason. Does not email the customer.</p>
      </details>}
      {canSend && <p className={styles.note}>{attachmentsBlocked ? 'Resolve the PDF check or remove the selection before sending.' : 'Send emails the text above and the listed PDFs. Replies to this email return here under Needs reply.'}</p>}
      <details className={styles.more}>
        <summary>Extra tools</summary>
        {templates.length > 0 && !sending && <div className={styles.templates}>
          <p className={styles.moreLabel}>Follow-up suggestions</p>
          <ul>{templates.map(t => <li key={t.id}><button type="button" className={styles.action} disabled={locked || writing} onClick={() => onDraft({ purpose: 'checkout_recovery', body: t.body, undo: undefined, edited: true })}>Use</button> <strong>{t.label}</strong><span className={styles.note}>{t.why}</span></li>)}</ul>
        </div>}
        <div className={styles.inserts}>
          <label><span>Insert code</span><select value="" disabled={locked || writing || !options?.codes.length} onChange={event => { const code = options?.codes.find(c => c.code === event.target.value); if (code) onInsert(`code ${code.code} (${code.percentOff}% off at checkout)`); }}>
            <option value="">Choose a code</option>{options?.codes.map(code => <option key={code.code} value={code.code}>{code.code} · {code.percentOff}% off</option>)}
          </select></label>
          {Boolean(options?.links?.length) && <label><span>Insert public COA link (not a PDF attachment)</span><select value="" disabled={locked || writing} onChange={event => { const link = options?.links?.find(l => l.url === event.target.value); if (link) onInsert(`COA for ${link.label}: ${link.url}`); }}>
            <option value="">Choose a product</option>{options?.links?.map(link => <option key={link.url} value={link.url}>{link.label}</option>)}
          </select></label>}
        </div>
      </details>
      {conflict && <div className={styles.conflict} role="alert"><p>Someone saved a newer version of this reply. Your text is kept.</p><button type="button" className={styles.action} disabled={locked} onClick={() => onDraft({ ...newDraft(reply), coa: ['sent', 'cancelled'].includes(reply?.status || '') ? '' : draft.coa })}>Use the newer version</button><button type="button" className={styles.action} disabled={locked} onClick={() => onDraft({ revision: reply?.revision ?? null, error: '', message: '' })}>Keep mine</button></div>}
      {draft.error && <p className={styles.error} role="alert">{draft.error}</p>}
      {draft.message && <p role="status" className={styles.note}>{draft.message}</p>}
    </div>}
    {earlierMessages.length > 0 && <details className={styles.earlier}>
      <summary>Earlier messages and replies ({earlierMessages.length})</summary>
      {lastOutItem && <p className={styles.note}>Last email: {when(lastOutItem.created)}, {lastOutItem.by}.</p>}
      <ol className={styles.thread} aria-label="Earlier messages and replies">{earlierMessages.map(renderMessage)}</ol>
    </details>}
    <details className={styles.internal}>
      <summary>Internal details &amp; actions</summary>
      {external.some(e => e.verified === false) && <details><summary>Other recorded contact</summary>{external.filter(e => e.verified === false).map((e, index) => <p key={index} className={styles.note}>{when(e.at)} · {e.account}<br/>{e.body}</p>)}</details>}
      {customerEvidence && <details className={styles.customerContext}>
        <summary>Purchase and contact records</summary>
        <p className={styles.note}>Store lookup: {customerEvidence.purchaseHistory.state}. Contact lookup: {customerEvidence.communicationHistory.state}. Checked {when(customerEvidence.purchaseHistory.checkedAt)}.</p>
        {customerEvidence.orders.length > 0 && <ul>{customerEvidence.orders.map(order => <li key={order.number}><strong>#{order.number}</strong> · {order.status} · {order.placed}{order.environment !== 'live' ? ' · ' + order.environment : ''}<br/>{order.items}</li>)}</ul>}
        {customerEvidence.communicationHistory.recent.length > 0 && <ul>{customerEvidence.communicationHistory.recent.map((event, i) => <li key={i}>{when(event.at)} · {event.source === 'recovery' ? 'Checkout reminder accepted by provider' : event.source === 'manual' ? 'Outside contact logged' : event.status === 'submitted_coa_form' ? 'COA request form' : event.source === 'customer_request' ? 'Website request' : event.direction === 'incoming' ? 'Incoming email' : 'Outgoing email'}</li>)}</ul>}
      </details>}
    {(row.stage === 'todo' || row.stage === 'pitch') && canMarkReplied && (markNote === null
      ? <p className={styles.note}>Already answered by phone, text or another app? <button type="button" className={styles.link} disabled={disabled} onClick={() => onMarkNote('')}>Mark as replied</button></p>
      : <div className={styles.confirm}><p>How did you reply? (optional)</p><input value={markNote} maxLength={1000} onChange={e => onMarkNote(e.target.value)} placeholder="e.g. Called him, he will wait for the restock"/><button type="button" className={styles.action} disabled={disabled} onClick={onMarkReplied}>Mark as replied</button><button type="button" className={styles.link} onClick={() => onMarkNote(null)}>Cancel</button></div>)}
      {fromOrder && <p className={styles.orderNote}><strong>Original order note (saved when opened; may be outdated):</strong> {text(request.data.message)}</p>}
      {siblings.length > 0 && <p className={styles.note}>{siblings.length + 1} related records in this conversation.</p>}
    {canTag && <details className={styles.caseBox}>
      <summary>Internal case notes <span className={styles.note}>(optional, not sent){issue?.issue ? ' · ' + issueLabel(issue.issue) + (issue.resolutions.length ? ' · ' + issue.resolutions.map(resolutionLabel).join(', ') : '') : ' · not filled in'}</span></summary>
      <div className={styles.case}>
      <label><span>What is this about?</span><select value={issue?.issue || ''} onChange={event => onIssue({ issue: event.target.value })}>
        <option value="" disabled>Choose an issue</option>{issueTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {issue?.issue && <fieldset><legend>How you handled it</legend>{resolutionTypes.map(([key, label]) => <label key={key} className={styles.check}><input type="checkbox" checked={issue.resolutions.includes(key)} onChange={event => onIssue({ resolutions: event.target.checked ? [...issue.resolutions, key] : issue.resolutions.filter(r => r !== key) })}/> {label}</label>)}</fieldset>}
      {issue?.issue && <label className={styles.caseNote}><span>Case note</span><input value={issueNote} maxLength={1000} onChange={event => onIssueNote(event.target.value)} onBlur={() => { if (issueNote !== (issue.note || '')) onIssue({ note: issueNote }); }} placeholder="e.g. Waiting on restock; offered 30% off next order"/></label>}
      {issue?.issue && <p className={styles.note}>The AI checks these notes against current records and your {issueLabel(issue.issue)} rules.</p>}
      </div>
    </details>}
    {(() => {
      // The full record of this request: received, replies (and PDFs) sent, forwards, archive/spam/delete/restore.
      const local = forwards.filter(f => !activity.some(a => a.at === f.created)).map(f => ({ at: f.created, text: `${f.status === 'failed' ? 'Forward failed to' : f.status === 'accepted' ? 'Forwarded to' : 'Forward status unconfirmed to'} ${f.to} by ${f.by}` }));
      const items = [{ at: request.created, text: fromOrder ? 'Conversation started from the order' + (request.data.startedBy ? ' by ' + text(request.data.startedBy) : '') : 'Received from the website' }, ...activity, ...local].sort((a, b) => a.at - b.at);
      return <details className={styles.activity} open={row.stage === 'done' || row.stage === 'waiting' || row.stage === 'deleted'}><summary>Activity ({items.length})</summary><ol>{items.map((item, index) => <li key={index}><span className={styles.meta}>{when(item.at)}</span> {item.text}</li>)}</ol></details>;
    })()}
      <p className={styles.note}>Request reference: {request.id.slice(0, 8)}</p>
      <details className={styles.original}><summary>Saved request details</summary>{Object.entries(request.data).map(([key, value]) => <p key={key}><strong>{key}: </strong>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')}</p>)}</details>
    </details>
  </section>;
}
