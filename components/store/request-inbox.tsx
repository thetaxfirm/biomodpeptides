'use client';

import { useEffect, useRef, useState } from 'react';
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
  instruction?: string; approvedAt?: number; approvedBy?: string; coaChoice?: string | null;
  coa: { state: 'matched' | 'needs_review' | 'already_sent' | 'not_requested'; reason: string; extras?: { productName?: string; strength?: string; lot?: string; sha256?: string }[]; productName?: string; strength?: string; lot?: string; reportId?: string; chemicalIdentity?: string; filename?: string; sha256?: string };
  history: { id: string; direction: 'incoming' | 'outgoing'; body: string; created: number }[];
};
export type PrepareReplyInput = { id: string; mode: 'ai' | 'staff'; body?: string; instruction?: string; expectedRevision: number | null; coaSha256?: string | null; send?: boolean };
export type DeskCoa = { sha256: string; productName: string; strength: string; form: string; lot: string; reportId: string; current: boolean };
export type RequestForward = { id: string; to: string; by: string; note: string; status: 'sending' | 'unknown' | 'accepted' | 'failed'; created: number };
export type TeamMember = { email: string; name: string; role: string };
export type CaseEntry = { requestId: string; issue: string; resolutions: string[]; note: string; updated: number; updatedBy: string; name: string; subject: string };
export type DeskOptions = { team?: TeamMember[]; links?: { label: string; url: string }[]; coas: DeskCoa[]; codes: { code: string; percentOff: number }[]; rules: { id: string; rule: string; issue?: string | null }[]; learning: { recent: number; unchanged: number }; bridgeSeen: number | null };
type Props = {
  requests: readonly CustomerRequest[];
  automation?: CoaAutomationReport | null;
  requestReplies?: Record<string, ReplySummary>;
  busy: boolean;
  dirty: boolean;
  refreshing: boolean;
  canSend?: boolean;
  onStatus: (request: CustomerRequest, status: string) => void | Promise<void>;
  onPrepareReply: (input: PrepareReplyInput) => Promise<ReplySummary>;
  onRefreshReplies?: (ids: string[]) => Promise<{ replies: Record<string, ReplySummary>; forwards?: Record<string, RequestForward[]>; activity?: Record<string, { at: number; text: string }[]>; issues?: Record<string, RequestIssue>; external?: Record<string, ExternalReply[]> }>;
  onMarkReplied?: (input: { id: string; note: string }) => Promise<ExternalReply>;
  onSaveIssue?: (input: { id: string; issue: string; resolutions: string[]; note: string }) => Promise<RequestIssue>;
  onLoadCases?: () => Promise<CaseEntry[]>;
  onLoadTemplates?: (requestId: string) => Promise<{ id: string; label: string; why: string; body: string }[]>;
  focusId?: string | null;
  onForward?: (input: { id: string; to: string; note: string }) => Promise<RequestForward>;
  onLoadOptions?: () => Promise<DeskOptions>;
  onSaveRule?: (input: { rule?: string; removeId?: string; issue?: string | null }) => Promise<DeskOptions>;
};
// coa: undefined = keep what the saved reply uses; null = auto-match the request; '' = none; sha = chosen report.
type Draft = { body: string; instruction: string; revision: number | null; edited: boolean; error: string; message: string; coa?: string | null; undo?: string; remember: boolean };
type Stage = 'todo' | 'sending' | 'waiting' | 'done' | 'spam' | 'deleted' | 'pitch';
const noReplies: Record<string, ReplySummary> = {};
const sender = 'research@biomodpeptides.com';
const DAY = 86400000;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function usableEmail(value: unknown) {
  const email = text(value);
  return email.length <= 254 && /^[^\s@<>,;?&#%]+@[^\s@<>,;?&#%]+\.[^\s@<>,;?&#%]+$/.test(email);
}
function newDraft(reply?: ReplySummary): Draft {
  return { body: reply?.body || '', instruction: '', revision: reply?.revision ?? null, edited: false, error: '', message: '', remember: false };
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
export type ExternalReply = { at: number; source: 'mailbox' | 'manual'; account: string; body: string; preview: boolean };
const shortDate = (value: number) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
const mailbox = (account: string) => account.split('@')[0] + '@';
export const looksLikePitch = (request: CustomerRequest) => request.data.origin !== 'order' && looksLikePitchText(text(request.data.subject), text(request.data.message));
type StageInfo = { stage: Stage; label: string; since: number; when: string; late: boolean };
function stageOf(request: CustomerRequest, reply: ReplySummary | undefined, external: ExternalReply[] = [], issue: string | null = null, activity: { at: number; text: string }[] = [], now = Date.now(), shared: { at: number; how: string }[] = []): StageInfo {
  const history = reply?.history || [];
  const desk = history.filter(m => m.direction === 'outgoing').map(m => ({ at: m.created, how: 'from research@' }));
  const outside = external.map(e => ({ at: e.at, how: e.source === 'manual' ? 'by phone/text · ' + mailbox(e.account) : 'in Gmail from ' + mailbox(e.account) }));
  const replies = [...desk, ...outside, ...shared].sort((a, b) => a.at - b.at);
  const last = replies[replies.length - 1];
  const lastOut = last?.at || 0;
  const lastIn = Math.max(request.created, ...history.filter(m => m.direction === 'incoming').map(m => m.created));
  const customerReplied = lastOut > 0 && lastIn > lastOut;
  const replied = last ? `Replied ${when(last.at)} ${last.how}` : '';
  if (request.status === 'deleted') return { stage: 'deleted', label: 'Deleted', since: request.created, when: 'Received ' + shortDate(request.created), late: false };
  if (request.status === 'spam') return { stage: 'spam', label: 'Spam', since: request.created, when: 'Received ' + shortDate(request.created), late: false };
  if (sendPending(reply)) return { stage: 'sending', label: 'Sending…', since: reply!.approvedAt || reply!.updated, when: 'Received ' + shortDate(request.created), late: false };
  if (issue === 'vendor' || (!issue && looksLikePitch(request))) return { stage: 'pitch', label: issue === 'vendor' ? 'Sales pitch' : 'Looks like a sales pitch', since: request.created, when: 'Received ' + shortDate(request.created), late: false };
  if (lastOut && !customerReplied) return { stage: request.status === 'resolved' ? 'done' : 'waiting', label: replied, since: lastOut, when: replied, late: false };
  if (request.status === 'resolved' && !customerReplied) {
    const closed = [...activity].reverse().find(a => a.text.startsWith('Archived'));
    return { stage: 'done', label: 'Closed without reply' + (closed ? ` · ${shortDate(closed.at)}${closed.text.includes(' by ') ? ' by ' + mailbox(closed.text.split(' by ').pop()!) : ''}` : ''), since: closed?.at || request.created, when: 'Received ' + shortDate(request.created), late: false };
  }
  // Plain answer to "did we reply?" first, then what is waiting.
  const base = customerReplied ? `Replied ${shortDate(lastOut)}, then they wrote again` : 'Not replied yet';
  const state = base + (working(reply) ? ' · AI is writing a draft' : reply?.status === 'ready' ? ' · reply ready to send in Jarvis' : reply?.status === 'needs_review' ? ' · draft needs a look' : '');
  const waited = now - lastIn;
  const days = Math.floor(waited / DAY);
  return { stage: 'todo', label: state, since: lastIn, when: (customerReplied ? 'Wrote ' : 'Received ') + shortDate(lastIn) + (days >= 1 ? ` · waiting ${days} day${days === 1 ? '' : 's'}` : ''), late: waited > DAY };
}
function friendlyReason(reason?: string) {
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

export function RequestInbox({ requests, automation, requestReplies = noReplies, busy, dirty, refreshing, canSend = false, onStatus, onPrepareReply, onRefreshReplies, onLoadOptions, onSaveRule, onForward, onSaveIssue, onLoadCases, onLoadTemplates, focusId, onMarkReplied }: Props) {
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
  const [options, setOptions] = useState<DeskOptions | null>(null);
  const [filter, setFilterState] = useState<'todo' | 'waiting' | 'done' | 'spam' | 'deleted' | 'pitch' | 'all'>('todo');
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
  const requestIds = requests.map(r => r.id).join(',');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; speech.current?.abort(); }; }, []);
  useEffect(() => {
    if (!onLoadOptions) return;
    let alive = true;
    onLoadOptions().then(value => { if (alive && mounted.current) setOptions(value); }, () => undefined);
    return () => { alive = false; };
  }, [onLoadOptions]);
  // Live status: every few seconds while the AI writes or Jarvis sends, otherwise every 30 seconds.
  useEffect(() => {
    if (!onRefreshReplies) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      const ids = requestIds ? requestIds.split(',') : [];
      if (ids.length && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        try { const fresh = await onRefreshReplies(ids); if (!stopped && mounted.current) { setLiveReplies(fresh?.replies || {}); if (fresh?.forwards) setForwards(fresh.forwards); if (fresh?.activity) setActivity(fresh.activity); if (fresh?.issues) setIssues(fresh.issues); if (fresh?.external) setExternal(fresh.external); } } catch { /* keep the last loaded status */ }
      }
      if (stopped) return;
      if (mounted.current) setNow(Date.now());
      const active = ids.some(id => { const reply = replyRef.current(id); return working(reply) || sendPending(reply); });
      timer = setTimeout(tick, active ? 2500 : 30000);
      (timer as any)?.unref?.();
    };
    timer = setTimeout(tick, 2500);
    (timer as any)?.unref?.();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [onRefreshReplies, requestIds]);
  // Opened from an order: select that conversation once it is in the list.
  // focusId is "requestId|token" so asking for the same conversation again reopens it.
  useEffect(() => {
    const id = focusId?.split('|')[0];
    if (!id || !requests.some(r => r.id === id)) return;
    setFilter('all'); setSelected(id);
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
        if (!draft.edited && reply && !working(reply) && (draft.revision !== reply.revision || draft.body !== (reply.body || ''))) {
          next[id] = { ...newDraft(reply), message: draft.message, undo: draft.undo, coa: draft.coa }; changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [requestReplies, preparedReplies, liveReplies]);
  const disabled = busy || dirty || refreshing;

  // One customer, one conversation: requests from the same email (any letter case) are grouped, and a reply
  // to any of them counts as a reply to all their earlier ones.
  const emailKey = (request: CustomerRequest) => text(request.data.email).toLowerCase() || request.id;
  const family: Record<string, CustomerRequest[]> = {};
  for (const request of requests) (family[emailKey(request)] ||= []).push(request);
  const sharedReplies = (request: CustomerRequest) => (family[emailKey(request)] || []).filter(other => other.id !== request.id).flatMap(other => [
    ...(replyOf(other.id)?.history || []).filter(m => m.direction === 'outgoing').map(m => ({ at: m.created, how: 'from research@' })),
    ...(external[other.id] || []).map(e => ({ at: e.at, how: e.source === 'manual' ? 'by phone/text · ' + mailbox(e.account) : 'in Gmail from ' + mailbox(e.account) })),
  ]);
  const rows = requests.map(request => ({ request, reply: replyOf(request.id), ...stageOf(request, replyOf(request.id), external[request.id], issues[request.id]?.issue || null, activity[request.id], now, sharedReplies(request)) }));
  const counts = { todo: 0, waiting: 0, done: 0, spam: 0, deleted: 0, pitch: 0, all: rows.filter(row => row.stage !== 'deleted').length };
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
  // Collapse each customer's requests in this view into one row that opens their newest request.
  const grouped: (typeof shown[number] & { count: number; members: CustomerRequest[] })[] = [];
  for (const row of shown) {
    const existing = grouped.find(g => emailKey(g.request) === emailKey(row.request));
    if (!existing) { grouped.push({ ...row, count: 1, members: [row.request] }); continue; }
    existing.count++; existing.members.push(row.request);
    if (row.request.created > existing.request.created) Object.assign(existing, { request: row.request, reply: row.reply, label: row.label, stage: row.stage });
  }
  const views = [['todo', 'Needs reply'], ['done', 'Replied & archive'], ['pitch', 'Sales pitches'], ['spam', 'Spam'], ['deleted', 'Deleted'], ['all', 'All']] as const;

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
    if (mode === 'ai' && !draft.instruction.trim() && draft.body.trim()) { setDraft(id, { error: 'Tell the AI what to change, or edit the reply yourself.' }); return; }
    if (send && !canSend) return;
    pendingIds.current.add(id); setPending(previous => ({ ...previous, [id]: true }));
    setDraft(id, { error: '', message: '' });
    const instruction = draft.instruction.trim();
    try {
      if (mode === 'ai' && draft.remember && instruction && onSaveRule) {
        try { const next = await onSaveRule({ rule: instruction }); if (mounted.current) setOptions(next); } catch { /* the draft request still goes ahead */ }
      }
      const reply = await onPrepareReply({ id, mode, body: draft.body, instruction: mode === 'ai' ? instruction : '', expectedRevision: draft.revision, ...(draft.coa !== undefined ? { coaSha256: draft.coa } : {}), ...(send ? { send: true } : {}) });
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
    catch { if (mounted.current) setIssues(previous => { const copy = { ...previous }; if (current) copy[id] = current; else delete copy[id]; return copy; }); }
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
        {options.learning.recent ? <>AI drafts: <strong>{options.learning.unchanged} of the last {options.learning.recent}</strong> went out without edits.</> : <>The AI learns from every reply you send.</>}{' '}
        <button type="button" className={styles.link} aria-expanded={rulesOpen} onClick={() => void openRules()}>Issues &amp; rules ({options.rules.length} rules)</button>
      </p>}
    </div>
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
          const preview = text(request.data.message) || text(request.data.subject);
          const late = row.late;
          return <article key={request.id} role="listitem" className={styles.row} data-selected={selected === request.id ? 'true' : 'false'}>
            <button type="button" className={styles.rowButton} aria-expanded={selected === request.id} aria-controls={`request-reply-${request.id}`} onClick={() => open(request.id)}>
              <span className={styles.rowTop}><strong>{name}</strong>{row.count > 1 && <span className={styles.age}>{row.count} requests</span>}</span>
              <span className={styles.rowSubject}>{text(request.data.subject) || (request.kind === 'affiliate' ? 'Partner application' : request.kind === 'stock' ? 'Product availability' : 'Website message')}</span>
              <span className={styles.rowPreview}>{preview}</span>
              <span className={styles.rowState} data-stage={row.stage}>{row.label}{reply?.coa?.state === 'matched' && row.stage === 'todo' ? ' · COA' : ''}</span>
              {row.stage === 'todo' && <span className={late ? styles.late : styles.rowPreview}>{row.when}</span>}
            </button>
          </article>;
        })}
      </div>
      {/* A plain render function (no hooks), so the open conversation is part of this tree. */}
      {active ? conversation({ row: active, draft: drafts[active.request.id], automation, options, canSend, disabled, listening: listening === active.request.id, preparing: Boolean(pending[active.request.id]), bodyField, now,
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
        templates: templates[active.request.id] || [],
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
        : <div className={styles.placeholder}><p>Pick a request on the left. The AI has usually written a draft already.</p></div>}
    </div>
  </section>;
}

type ConversationProps = {
  row: { request: CustomerRequest; reply?: ReplySummary; stage: Stage; label: string; since: number; when: string; late: boolean };
  draft?: Draft; automation?: CoaAutomationReport | null; options: DeskOptions | null; canSend: boolean; disabled: boolean; listening: boolean; preparing: boolean; now: number;
  bodyField: { current: HTMLTextAreaElement | null };
  onClose: () => void; onEdit: (field: 'body' | 'instruction', value: string) => void; onDraft: (patch: Partial<Draft>) => void; onInsert: (snippet: string) => void;
  onSubmit: (mode: 'ai' | 'staff', send?: boolean, instruction?: string) => void; onDictate: () => void; onStatus: (status: string) => void;
  forwards: RequestForward[]; team: TeamMember[]; canForward: boolean; activity: { at: number; text: string }[];
  siblings: { request: CustomerRequest; reply?: ReplySummary; external: ExternalReply[] }[];
  templates: { id: string; label: string; why: string; body: string }[];
  external: ExternalReply[]; canMarkReplied: boolean; markNote: string | null; onMarkNote: (note: string | null) => void; onMarkReplied: () => void;
  issue: RequestIssue | null; canTag: boolean; onIssue: (patch: Partial<{ issue: string; resolutions: string[]; note: string }>) => void; issueNote: string; onIssueNote: (note: string) => void;
  panel: { kind: 'forward' | 'delete'; to: string; note: string; busy: boolean; error: string } | null;
  onPanel: (next: Partial<{ kind: 'forward' | 'delete'; to: string; note: string; busy: boolean; error: string }> | null) => void; onForward: () => void;
};
function conversation({ row, draft, automation, options, canSend, disabled, listening, preparing, bodyField, now, onClose, onEdit, onDraft, onInsert, onSubmit, onDictate, onStatus, forwards, team, canForward, panel, onPanel, onForward, activity, siblings, templates, external, canMarkReplied, markNote, onMarkNote, onMarkReplied, issue, canTag, onIssue, issueNote, onIssueNote }: ConversationProps) {
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
  const chosen = chosenList[0];
  const attachedNow = reply?.coa.state === 'matched' && (draft?.coa === undefined || draft.coa === reply.coaChoice) ? reply.coa : null;
  const setChoice = (list: string[]) => onDraft({ coa: list.length ? list.join(',') : null, edited: true });
  const isCoaRequest = /^coa request:/i.test(subject);
  const lastSent = [...history].reverse().find(m => m.direction === 'outgoing');
  let status = '';
  if (sending) status = reply?.status === 'sending' ? 'Sending from ' + sender + '…' : 'Queued to send. Jarvis sends it within seconds while your Mac is awake.';
  else if (preparing) status = 'Saving…';
  else if (writing) status = reply?.mode === 'ai' ? 'AI is writing. This usually takes under a minute.' : 'Saving the draft…';
  else if (reply?.status === 'sent') status = 'Sent ' + when(reply.updated) + '. Accepted by the mail provider.';
  else if (reply?.status === 'ready' && reply.mode === 'ai' && !draft?.edited) status = 'AI draft. Edit anything, or tell the AI what to change.';
  else if (reply?.status === 'ready') status = 'Draft saved. Not sent.';
  return <section key={request.id} className={styles.pane} id={`request-reply-${request.id}`} aria-label={`Reply to ${name}`} aria-busy={writing || sending}>
    <header className={styles.paneHead}>
      <button type="button" className={styles.back} onClick={onClose}>Back to list</button>
      <div className={styles.who}><h3>{name}</h3><p>{email || 'No email address saved'}{website && <> · <a href={website} target="_blank" rel="noopener noreferrer">Website</a></>}</p><p className={styles.stateLine} data-stage={row.stage}>{row.label}{row.stage === 'todo' ? ' · ' + row.when : ''}</p></div>
      <div className={styles.paneActions}>
        {canForward && request.status !== 'deleted' && <button type="button" className={styles.action} aria-expanded={panel?.kind === 'forward'} disabled={disabled} onClick={() => onPanel(panel?.kind === 'forward' ? null : { kind: 'forward', error: '' })}>Forward</button>}
        {request.status === 'deleted'
          ? <button type="button" className={styles.action} disabled={disabled} onClick={() => onStatus('new')}>Restore</button>
          : request.status === 'spam' || request.status === 'resolved'
          ? <button type="button" className={styles.action} disabled={disabled} onClick={() => onStatus('new')}>Move to To reply</button>
          : <><button type="button" className={styles.action} disabled={disabled} onClick={() => onStatus('resolved')}>Archive</button><button type="button" className={styles.link} disabled={disabled} onClick={() => onStatus('spam')}>Spam</button></>}
        {request.status !== 'deleted' && <button type="button" className={styles.link} disabled={disabled} onClick={() => onPanel(panel?.kind === 'delete' ? null : { kind: 'delete', error: '' })}>Delete</button>}
      </div>
    </header>
    {(row.stage === 'todo' || row.stage === 'pitch') && canMarkReplied && (markNote === null
      ? <p className={styles.note}>Already answered by phone, text or another app? <button type="button" className={styles.link} disabled={disabled} onClick={() => onMarkNote('')}>Mark as replied</button></p>
      : <div className={styles.confirm}><p>How did you reply? (optional)</p><input value={markNote} maxLength={1000} onChange={e => onMarkNote(e.target.value)} placeholder="e.g. Called him, he will wait for the restock"/><button type="button" className={styles.action} disabled={disabled} onClick={onMarkReplied}>Mark as replied</button><button type="button" className={styles.link} onClick={() => onMarkNote(null)}>Cancel</button></div>)}
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
    {siblings.length > 0 && <p className={styles.note}>{siblings.length + 1} requests from this customer, shown as one conversation. One reply answers all of them.</p>}
    <p className={styles.subjectLine}><strong>{subject}</strong> <span className={styles.note}>· Ref {request.id.slice(0, 8)}</span></p>{typeof request.data?.labelLot === 'string' && <p className={styles.vialLot}>Lot on the customer's vial: <strong>{request.data.labelLot}</strong>. Only the report for this lot can be attached.</p>}
    {fromOrder && <p className={styles.orderNote}><strong>Order details (only you see this):</strong> {text(request.data.message)}</p>}
    {canTag && <div className={styles.case}>
      <label><span>What is this about?</span><select value={issue?.issue || ''} onChange={event => onIssue({ issue: event.target.value })}>
        <option value="" disabled>Choose an issue</option>{issueTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {issue?.issue && <fieldset><legend>How you handled it</legend>{resolutionTypes.map(([key, label]) => <label key={key} className={styles.check}><input type="checkbox" checked={issue.resolutions.includes(key)} onChange={event => onIssue({ resolutions: event.target.checked ? [...issue.resolutions, key] : issue.resolutions.filter(r => r !== key) })}/> {label}</label>)}</fieldset>}
      {issue?.issue && <label className={styles.caseNote}><span>Case note</span><input value={issueNote} maxLength={1000} onChange={event => onIssueNote(event.target.value)} onBlur={() => { if (issueNote !== (issue.note || '')) onIssue({ note: issueNote }); }} placeholder="e.g. Waiting on restock; offered 30% off next order"/></label>}
      {issue?.issue && <p className={styles.note}>The AI drafts with this decision and with your {issueLabel(issue.issue)} rules.</p>}
    </div>}
    <ol className={styles.thread} aria-label="Conversation">
      {(() => {
        const seen = new Set<string>();
        const outside = (list: ExternalReply[], tag: string) => list.map((e, i) => ({ id: 'ext-' + tag + i + '-' + e.at, direction: 'outgoing' as const, created: e.at, body: e.body + (e.preview ? ' …' : ''), who: e.source === 'manual' ? 'Marked as replied by ' + e.account : 'You, from ' + e.account + ' (sent in Gmail)' }));
        const all = [
          ...history.map(m => ({ ...m, who: m.direction === 'incoming' ? name : 'You, from research@ (reply desk)' })),
          ...outside(external, 'a'),
          ...siblings.flatMap(sib => [
            { id: 'original:' + sib.request.id, direction: 'incoming' as const, created: sib.request.created, body: [text(sib.request.data.subject), text(sib.request.data.message)].filter(Boolean).join('\n'), who: (text(sib.request.data.name) || name) + ' (earlier request)' },
            ...(sib.reply?.history || []).filter(m => m.direction === 'outgoing').map(m => ({ ...m, who: 'You, from research@ (reply desk)' })),
            ...outside(sib.external, sib.request.id),
          ]),
        ];
        return all.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
      })()
        .sort((a, b) => a.created - b.created).map(message => <li key={message.id} data-direction={message.direction}>
        <p className={styles.meta}>{message.who} · {when(message.created)}</p>
        <p className={styles.message}>{message.body || 'No message text was included.'}</p>
      </li>)}
    </ol>
    {(() => {
      // The full record of this request: received, replies (and PDFs) sent, forwards, archive/spam/delete/restore.
      const local = forwards.filter(f => !activity.some(a => a.at === f.created)).map(f => ({ at: f.created, text: `${f.status === 'failed' ? 'Forward failed to' : f.status === 'accepted' ? 'Forwarded to' : 'Forward status unconfirmed to'} ${f.to} by ${f.by}` }));
      const items = [{ at: request.created, text: fromOrder ? 'Conversation started from the order' + (request.data.startedBy ? ' by ' + text(request.data.startedBy) : '') : 'Received from the website' }, ...activity, ...local].sort((a, b) => a.at - b.at);
      return <details className={styles.activity} open={row.stage === 'done' || row.stage === 'waiting' || row.stage === 'deleted'}><summary>Activity ({items.length})</summary><ol>{items.map((item, index) => <li key={index}><span className={styles.meta}>{when(item.at)}</span> {item.text}</li>)}</ol></details>;
    })()}
    {request.status === 'deleted' && <p className={styles.warning}>This request is deleted. Restore it to reply.</p>}
    {request.kind === 'affiliate' && <p className={styles.note}>Partner application. Agree terms and create the code under Affiliate &amp; promo codes before promising one.</p>}
    {request.kind === 'stock' && <p className={styles.note}>Check stock under Products before promising a date.</p>}
    {previousCoa?.status === 'accepted' && <p className={styles.note}>An earlier automatic COA email to this customer was accepted by the mail provider.</p>}
    {request.status === 'deleted' ? null : !canReply ? <p className={styles.warning}>No usable email address was saved, so there is no way to reply.</p> : !draft ? null : <div className={styles.composer}>
      <div className={styles.composeHead}><span>To {reply?.recipient || email}</span><span className={styles.note}>From {sender}</span></div>
      {templates.length > 0 && !sending && <details className={styles.templates} open={!draft.body.trim()}>
        <summary>Win-back emails ({templates.length})</summary>
        <ul>{templates.map(t => <li key={t.id}><button type="button" className={styles.action} disabled={locked || writing} onClick={() => onDraft({ body: t.body, undo: draft.body || undefined, edited: true })}>Use</button> <strong>{t.label}</strong><span className={styles.note}>{t.why}</span></li>)}</ul>
        <p className={styles.note}>Pick one, then press Tailor to have the AI fit it to this customer, or edit it yourself.</p>
      </details>}
      <label className={styles.hidden} htmlFor={`reply-body-${request.id}`}>Reply</label>
      <textarea id={`reply-body-${request.id}`} ref={bodyField} name="replyBody" rows={11} maxLength={12000} value={draft.body} readOnly={writing} disabled={locked}
        onChange={event => onEdit('body', event.target.value)} placeholder={writing ? 'The AI is writing…' : 'Write the reply, or tell the AI below what you want to say.'} data-writing={writing ? 'true' : 'false'}/>
      {status && <p className={styles.status} role="status">{status}{draft.undo && !writing && !sending && <> <button type="button" className={styles.link} onClick={() => onDraft({ body: draft.undo!, undo: undefined, edited: true })}>Undo AI change</button></>}</p>}
      {reply?.reason && reply.status !== 'sent' && !sending && <p className={styles.warning}>{friendlyReason(reply.reason)}</p>}
      <div className={styles.ask}>
        <label className={styles.hidden} htmlFor={`reply-ai-${request.id}`}>Tell the AI</label>
        <textarea id={`reply-ai-${request.id}`} name="replyInstruction" rows={2} maxLength={2000} value={draft.instruction} disabled={locked}
          onChange={event => onEdit('instruction', event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!locked && !conflict) onSubmit('ai'); } }}
          placeholder={listening ? 'Listening… say what the reply should say' : draft.body.trim() ? 'Tell the AI what to change: "shorter", "add the 10% code", "say the cart is fixed"' : 'Tell the AI what to write, or press the mic and say it'}/>
        <button type="button" className={styles.mic} aria-pressed={listening} disabled={locked && !listening} onClick={onDictate}>{listening ? 'Stop' : 'Dictate'}</button>
        <button type="button" className={styles.action} disabled={locked || conflict || writing} onClick={() => onSubmit('ai')}>{writing && reply?.mode === 'ai' ? 'Writing…' : draft.body.trim() ? 'Rewrite' : 'Write it'}</button>
        {templates.length > 0 && draft.body.trim() && <button type="button" className={styles.action} disabled={locked || conflict || writing} onClick={() => onSubmit('ai', false, 'Tailor this email to this customer and their order. Keep it short and personal, keep every code and link exactly, and do not add new offers.')}>Tailor</button>}
      </div>
      <label className={styles.remember}><input type="checkbox" checked={draft.remember} disabled={locked} onChange={event => onDraft({ remember: event.target.checked })}/> Remember this instruction for future replies</label>
      <div className={styles.inserts}>
        <label><span>Insert code</span><select value="" disabled={locked || writing || !options?.codes.length} onChange={event => { const code = options?.codes.find(c => c.code === event.target.value); if (code) onInsert(`code ${code.code} (${code.percentOff}% off at checkout)`); }}>
          <option value="">{options ? (options.codes.length ? 'Choose a code' : 'No active codes') : 'Loading…'}</option>
          {options?.codes.map(code => <option key={code.code} value={code.code}>{code.code} · {code.percentOff}% off</option>)}
        </select></label>
        <label><span>Insert COA link</span><select value="" disabled={locked || writing || !options?.links?.length} onChange={event => { const link = options?.links?.find(l => l.url === event.target.value); if (link) onInsert(`COA for ${link.label}: ${link.url}`); }}>
          <option value="">{options ? (options.links?.length ? 'Choose a product' : 'No public COAs') : 'Loading…'}</option>
          {options?.links?.map(link => <option key={link.url} value={link.url}>{link.label}</option>)}
        </select></label>
        <label><span>Attach COA PDF</span><select value="" disabled={locked || writing || !options || chosenList.length >= 5} onChange={event => { const v = event.target.value; if (v === 'none') onDraft({ coa: '', edited: true }); else if (v === 'auto') onDraft({ coa: null, edited: true }); else if (v && !chosenList.some(c => c.sha256 === v)) setChoice([...chosenList.map(c => c.sha256), v]); }}>
          <option value="">{chosenList.length ? 'Add another report' : isCoaRequest && coaChoice === null ? 'Matching the requested lot' : 'Add a report'}</option>
          {isCoaRequest && coaChoice !== null && <option value="auto">Match the requested lot</option>}
          {(chosenList.length > 0 || coaChoice === null) && <option value="none">No report</option>}
          {options?.coas.filter(coa => !chosenList.some(c => c.sha256 === coa.sha256)).map(coa => <option key={coa.sha256} value={coa.sha256}>{coa.productName} {coa.strength} · lot {coa.lot}{coa.current ? ' (current)' : ''}</option>)}
        </select></label>
      </div>
      {attachedNow && draft.coa === undefined && <p className={styles.attachment}>Attached: {[attachedNow, ...(attachedNow.extras || [])].map((c, i) => <span key={i}>{i ? ', ' : ''}<strong>{c.productName} {c.strength}</strong> lot {c.lot}</span>)}</p>}
      {draft.coa !== undefined && chosenList.length > 0 && <p className={styles.attachment}>Will attach when you save or send: {chosenList.map(c => <span key={c.sha256}><strong>{c.productName} {c.strength}</strong> lot {c.lot} <button type="button" className={styles.link} onClick={() => setChoice(chosenList.filter(o => o.sha256 !== c.sha256).map(o => o.sha256))}>Remove</button> </span>)}</p>}
      {reply && reply.coa.state !== 'matched' && reply.coa.state !== 'not_requested' && !chosen && <p className={styles.note}>{reply.coa.reason}</p>}
      {conflict && <div className={styles.conflict} role="alert"><p>Someone saved a newer version of this reply. Your text is kept.</p><button type="button" className={styles.action} disabled={locked} onClick={() => onDraft({ ...newDraft(reply), coa: draft.coa })}>Use the newer version</button><button type="button" className={styles.action} disabled={locked} onClick={() => onDraft({ revision: reply?.revision ?? null, error: '', message: '' })}>Keep mine</button></div>}
      {draft.error && <p className={styles.error} role="alert">{draft.error}</p>}
      {draft.message && <p role="status" className={styles.note}>{draft.message}</p>}
      <div className={styles.sendRow}>
        {canSend
          ? <button type="button" className={styles.send} disabled={locked || conflict || writing || !draft.body.trim()} onClick={() => onSubmit('staff', true)}>{sending ? 'Sending…' : 'Send'}</button>
          : <p className={styles.note}>Ash sends replies. Save the draft and it appears here for him.</p>}
        <button type="button" className={styles.action} disabled={locked || conflict || writing || !draft.body.trim()} onClick={() => onSubmit('staff')}>Save draft</button>
        {lastSent && <span className={styles.note}>Last reply sent {when(lastSent.created)}</span>}
      </div>
    </div>}
    <details className={styles.original}><summary>Everything the customer submitted</summary>{Object.entries(request.data).map(([key, value]) => <p key={key}><strong>{key}: </strong>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')}</p>)}</details>
  </section>;
}
