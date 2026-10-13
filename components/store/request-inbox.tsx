'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoaAutomationReport } from './coa-automation';
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
  instruction?: string; approvedAt?: number; approvedBy?: string; coaChoice?: string | null;
  coa: { state: 'matched' | 'needs_review' | 'already_sent' | 'not_requested'; reason: string; productName?: string; strength?: string; lot?: string; reportId?: string; chemicalIdentity?: string; filename?: string; sha256?: string };
  history: { id: string; direction: 'incoming' | 'outgoing'; body: string; created: number }[];
};
export type PrepareReplyInput = { id: string; mode: 'ai' | 'staff'; body?: string; instruction?: string; expectedRevision: number | null; coaSha256?: string | null; send?: boolean };
export type DeskCoa = { sha256: string; productName: string; strength: string; form: string; lot: string; reportId: string; current: boolean };
export type RequestForward = { id: string; to: string; by: string; note: string; status: 'sending' | 'unknown' | 'accepted' | 'failed'; created: number };
export type TeamMember = { email: string; name: string; role: string };
export type DeskOptions = { team?: TeamMember[]; links?: { label: string; url: string }[]; coas: DeskCoa[]; codes: { code: string; percentOff: number }[]; rules: { id: string; rule: string }[]; learning: { recent: number; unchanged: number }; bridgeSeen: number | null };
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
  onRefreshReplies?: (ids: string[]) => Promise<{ replies: Record<string, ReplySummary>; forwards?: Record<string, RequestForward[]>; activity?: Record<string, { at: number; text: string }[]> }>;
  onForward?: (input: { id: string; to: string; note: string }) => Promise<RequestForward>;
  onLoadOptions?: () => Promise<DeskOptions>;
  onSaveRule?: (input: { rule?: string; removeId?: string }) => Promise<DeskOptions>;
};
// coa: undefined = keep what the saved reply uses; null = auto-match the request; '' = none; sha = chosen report.
type Draft = { body: string; instruction: string; revision: number | null; edited: boolean; error: string; message: string; coa?: string | null; undo?: string; remember: boolean };
type Stage = 'todo' | 'sending' | 'waiting' | 'done' | 'spam' | 'deleted';
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
function age(value: number, now: number) {
  const minutes = Math.max(0, Math.round((now - value) / 60000));
  if (minutes < 60) return minutes + 'm';
  if (minutes < 1440) return Math.round(minutes / 60) + 'h';
  return Math.round(minutes / 1440) + 'd';
}
function websiteLink(value: unknown) {
  try { const url = new URL(text(value)); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
const working = (reply?: ReplySummary) => reply?.status === 'queued' || reply?.status === 'preparing';
const sendPending = (reply?: ReplySummary) => reply?.status === 'sending' || Boolean(reply?.approvedAt && reply.status !== 'sent' && reply.status !== 'needs_review');
function stageOf(request: CustomerRequest, reply?: ReplySummary): { stage: Stage; label: string; since: number } {
  const history = reply?.history || [];
  const outgoing = history.filter(m => m.direction === 'outgoing').map(m => m.created);
  const incoming = history.filter(m => m.direction === 'incoming').map(m => m.created);
  const lastOut = outgoing.length ? Math.max(...outgoing) : 0;
  const lastIn = Math.max(request.created, ...incoming);
  const customerReplied = lastOut > 0 && lastIn > lastOut;
  if (request.status === 'deleted') return { stage: 'deleted', label: 'Deleted', since: request.created };
  if (request.status === 'spam') return { stage: 'spam', label: 'Spam', since: request.created };
  if (sendPending(reply)) return { stage: 'sending', label: 'Sending', since: reply!.approvedAt || reply!.updated };
  if (request.status === 'resolved' && !customerReplied) return { stage: 'done', label: lastOut ? 'Replied' : 'Archived', since: lastOut || request.created };
  if (lastOut && !customerReplied) return { stage: 'waiting', label: 'Replied', since: lastOut };
  const label = customerReplied ? 'Customer replied' : working(reply) ? 'AI writing' : reply?.status === 'ready' ? 'Draft ready' : reply?.status === 'needs_review' ? 'Needs a look' : 'New';
  return { stage: 'todo', label, since: lastIn };
}
function friendlyReason(reason?: string) {
  if (!reason) return '';
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

export function RequestInbox({ requests, automation, requestReplies = noReplies, busy, dirty, refreshing, canSend = false, onStatus, onPrepareReply, onRefreshReplies, onLoadOptions, onSaveRule, onForward }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preparedReplies, setPreparedReplies] = useState<Record<string, ReplySummary>>({});
  const [liveReplies, setLiveReplies] = useState<Record<string, ReplySummary>>({});
  const [forwards, setForwards] = useState<Record<string, RequestForward[]>>({});
  const [activity, setActivity] = useState<Record<string, { at: number; text: string }[]>>({});
  const [panel, setPanel] = useState<{ id: string; kind: 'forward' | 'delete'; to: string; note: string; busy: boolean; error: string } | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [options, setOptions] = useState<DeskOptions | null>(null);
  const [filter, setFilter] = useState<'todo' | 'waiting' | 'done' | 'spam' | 'deleted' | 'all'>('todo');
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
        try { const fresh = await onRefreshReplies(ids); if (!stopped && mounted.current) { setLiveReplies(fresh?.replies || {}); if (fresh?.forwards) setForwards(fresh.forwards); if (fresh?.activity) setActivity(fresh.activity); } } catch { /* keep the last loaded status */ }
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

  const rows = requests.map(request => ({ request, reply: replyOf(request.id), ...stageOf(request, replyOf(request.id)) }));
  const counts = { todo: 0, waiting: 0, done: 0, spam: 0, deleted: 0, all: rows.filter(row => row.stage !== 'deleted').length };
  for (const row of rows) { if (row.stage === 'sending' || row.stage === 'todo') counts.todo++; else if (row.stage === 'waiting') counts.done++; else counts[row.stage]++; }
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(row => ((filter === 'all' && row.stage !== 'deleted') || (filter === 'todo' ? row.stage === 'todo' || row.stage === 'sending' : filter === 'done' ? row.stage === 'done' || row.stage === 'waiting' : row.stage === filter))
    && (!needle || [row.request.id, row.request.kind, ...Object.values(row.request.data).filter(value => typeof value === 'string')].join(' ').toLowerCase().includes(needle)))
    // To reply: oldest first, so nothing waits behind newer mail. Everything else: newest first.
    .sort((a, b) => filter === 'todo' ? a.since - b.since : b.since - a.since);
  const views = [['todo', 'To reply'], ['done', 'Archive'], ['spam', 'Spam'], ['deleted', 'Deleted'], ['all', 'All']] as const;

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
  async function submit(request: CustomerRequest, mode: 'ai' | 'staff', send = false) {
    const id = request.id, draft = drafts[id];
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
  async function saveRule(input: { rule?: string; removeId?: string }) {
    if (!onSaveRule) return;
    try { const next = await onSaveRule(input); if (mounted.current) { setOptions(next); setNewRule(''); } } catch { /* the rules list stays as loaded */ }
  }

  const bridgeQuiet = options?.bridgeSeen != null && now - options.bridgeSeen > 3 * 60000;
  const active = rows.find(row => row.request.id === selected) || null;
  return <section className={styles.inbox} aria-labelledby="request-inbox-title" aria-busy={busy || refreshing}>
    <div className={styles.top}>
      <h2 id="request-inbox-title">Customer requests</h2>
      {options && <p className={styles.learning}>
        {options.learning.recent ? <>AI drafts: <strong>{options.learning.unchanged} of the last {options.learning.recent}</strong> went out without edits.</> : <>The AI learns from every reply you send.</>}{' '}
        <button type="button" className={styles.link} aria-expanded={rulesOpen} onClick={() => setRulesOpen(v => !v)}>Reply rules ({options.rules.length})</button>
      </p>}
    </div>
    {rulesOpen && options && <div className={styles.rules}>
      <p className={styles.note}>The AI follows these on every draft, along with the edits you made to earlier drafts.</p>
      {options.rules.length ? <ol>{options.rules.map(rule => <li key={rule.id}><span>{rule.rule}</span><button type="button" className={styles.link} onClick={() => void saveRule({ removeId: rule.id })}>Remove</button></li>)}</ol> : <p className={styles.note}>No rules yet.</p>}
      <form className={styles.ruleForm} onSubmit={event => { event.preventDefault(); if (newRule.trim()) void saveRule({ rule: newRule.trim() }); }}>
        <input value={newRule} maxLength={500} onChange={event => setNewRule(event.target.value)} placeholder="e.g. We have no walk-in store. Orders ship from the website only." aria-label="New reply rule"/>
        <button type="submit" className={styles.action} disabled={!newRule.trim()}>Add rule</button>
      </form>
    </div>}
    {bridgeQuiet && <p className={styles.warning} role="status">Jarvis last checked in at {when(options!.bridgeSeen!)}. AI drafts and sends wait until your Mac is awake and Jarvis is running.</p>}
    {dirty && <p role="status">Save or discard your unsaved admin edits before changing a request.</p>}
    <div className={styles.toolbar}>
      <div className={styles.filters} role="group" aria-label="Filter customer requests">{views.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span>{counts[value]}</span></button>)}</div>
      <label className={styles.search}><span className={styles.hidden}>Find a request</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, email or words"/></label>
    </div>
    <div className={styles.desk} data-open={active ? 'true' : 'false'}>
      <div className={styles.list} role="list" aria-label="Requests">
        {!shown.length ? <p className={styles.empty}>{requests.length ? (filter === 'todo' ? 'Nothing waiting for a reply.' : filter === 'done' ? 'Nothing archived yet. Requests move here once a reply is sent or you archive them.' : 'No requests here.') : 'No customer requests yet.'}</p> : shown.map(row => {
          const { request, reply } = row;
          const name = text(request.data.name) || text(request.data.email) || 'Customer';
          const preview = text(request.data.message) || text(request.data.subject);
          const late = (row.stage === 'todo') && now - row.since > DAY;
          return <article key={request.id} role="listitem" className={styles.row} data-selected={selected === request.id ? 'true' : 'false'}>
            <button type="button" className={styles.rowButton} aria-expanded={selected === request.id} aria-controls={`request-reply-${request.id}`} onClick={() => open(request.id)}>
              <span className={styles.rowTop}><strong>{name}</strong><span className={late ? styles.late : styles.age}>{age(row.since, now)}</span></span>
              <span className={styles.rowSubject}>{text(request.data.subject) || (request.kind === 'affiliate' ? 'Partner application' : request.kind === 'stock' ? 'Product availability' : 'Website message')}</span>
              <span className={styles.rowPreview}>{preview}</span>
              <span className={styles.rowState} data-stage={row.stage}>{row.label}{reply?.coa?.state === 'matched' && row.stage !== 'done' ? ' · COA' : ''}</span>
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
        onSubmit: (mode, send) => void submit(active.request, mode, send),
        onDictate: () => dictate(active.request),
        onStatus: status => { if (!disabled) { setPanel(null); void onStatus(active.request, status); } },
        forwards: forwards[active.request.id] || [], activity: activity[active.request.id] || [], team: options?.team || [], canForward: Boolean(onForward),
        panel: panel?.id === active.request.id ? panel : null,
        onPanel: next => setPanel(next ? { id: active.request.id, to: '', note: '', busy: false, error: '', ...(panel?.id === active.request.id ? panel : {}), ...next } as any : null),
        onForward: () => void forward(active.request.id) })
        : <div className={styles.placeholder}><p>Pick a request on the left. The AI has usually written a draft already.</p></div>}
    </div>
  </section>;
}

type ConversationProps = {
  row: { request: CustomerRequest; reply?: ReplySummary; stage: Stage; label: string; since: number };
  draft?: Draft; automation?: CoaAutomationReport | null; options: DeskOptions | null; canSend: boolean; disabled: boolean; listening: boolean; preparing: boolean; now: number;
  bodyField: { current: HTMLTextAreaElement | null };
  onClose: () => void; onEdit: (field: 'body' | 'instruction', value: string) => void; onDraft: (patch: Partial<Draft>) => void; onInsert: (snippet: string) => void;
  onSubmit: (mode: 'ai' | 'staff', send?: boolean) => void; onDictate: () => void; onStatus: (status: string) => void;
  forwards: RequestForward[]; team: TeamMember[]; canForward: boolean; activity: { at: number; text: string }[];
  panel: { kind: 'forward' | 'delete'; to: string; note: string; busy: boolean; error: string } | null;
  onPanel: (next: Partial<{ kind: 'forward' | 'delete'; to: string; note: string; busy: boolean; error: string }> | null) => void; onForward: () => void;
};
function conversation({ row, draft, automation, options, canSend, disabled, listening, preparing, bodyField, now, onClose, onEdit, onDraft, onInsert, onSubmit, onDictate, onStatus, forwards, team, canForward, panel, onPanel, onForward, activity }: ConversationProps) {
  const { request, reply } = row;
  const email = text(request.data.email), canReply = usableEmail(request.data.email);
  const name = text(request.data.name) || email || 'Customer';
  const subject = text(request.data.subject) || (request.kind === 'affiliate' ? 'Partner application' : request.kind === 'stock' ? 'Product availability' : 'Website message');
  const website = websiteLink(request.data.website);
  const previousCoa = automation?.requests?.[request.id]?.coa;
  const writing = working(reply), sending = sendPending(reply);
  const locked = disabled || preparing || sending;
  const conflict = Boolean(draft && draft.revision !== (reply?.revision ?? null));
  const history = reply?.history?.length ? reply.history : [{ id: 'original:' + request.id, direction: 'incoming' as const, body: text(request.data.message), created: request.created }];
  const coaChoice = draft?.coa !== undefined ? draft.coa : (reply?.coaChoice ?? null);
  const chosen = coaChoice ? options?.coas.find(c => c.sha256 === coaChoice) : undefined;
  const attachedNow = reply?.coa.state === 'matched' && (draft?.coa === undefined || draft.coa === reply.coaChoice) ? reply.coa : null;
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
      <div className={styles.who}><h3>{name}</h3><p>{email || 'No email address saved'}{website && <> · <a href={website} target="_blank" rel="noopener noreferrer">Website</a></>}</p></div>
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
    <p className={styles.subjectLine}><strong>{subject}</strong> <span className={styles.note}>· Ref {request.id.slice(0, 8)}</span></p>
    <ol className={styles.thread} aria-label="Conversation">
      {history.map(message => <li key={message.id} data-direction={message.direction}>
        <p className={styles.meta}>{message.direction === 'incoming' ? name : 'You'} · {when(message.created)}</p>
        <p className={styles.message}>{message.body || 'No message text was included.'}</p>
      </li>)}
    </ol>
    {(() => {
      // The full record of this request: received, replies (and PDFs) sent, forwards, archive/spam/delete/restore.
      const local = forwards.filter(f => !activity.some(a => a.at === f.created)).map(f => ({ at: f.created, text: `${f.status === 'failed' ? 'Forward failed to' : f.status === 'accepted' ? 'Forwarded to' : 'Forward status unconfirmed to'} ${f.to} by ${f.by}` }));
      const items = [{ at: request.created, text: 'Received from the website' }, ...activity, ...local].sort((a, b) => a.at - b.at);
      return <details className={styles.activity} open={row.stage === 'done' || row.stage === 'waiting' || row.stage === 'deleted'}><summary>Activity ({items.length})</summary><ol>{items.map((item, index) => <li key={index}><span className={styles.meta}>{when(item.at)}</span> {item.text}</li>)}</ol></details>;
    })()}
    {request.status === 'deleted' && <p className={styles.warning}>This request is deleted. Restore it to reply.</p>}
    {request.kind === 'affiliate' && <p className={styles.note}>Partner application. Agree terms and create the code under Affiliate &amp; promo codes before promising one.</p>}
    {request.kind === 'stock' && <p className={styles.note}>Check stock under Products before promising a date.</p>}
    {previousCoa?.status === 'accepted' && <p className={styles.note}>An earlier automatic COA email to this customer was accepted by the mail provider.</p>}
    {request.status === 'deleted' ? null : !canReply ? <p className={styles.warning}>No usable email address was saved, so there is no way to reply.</p> : !draft ? null : <div className={styles.composer}>
      <div className={styles.composeHead}><span>To {reply?.recipient || email}</span><span className={styles.note}>From {sender}</span></div>
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
        <label><span>Attach COA PDF</span><select value={coaChoice === null ? 'auto' : coaChoice} disabled={locked || writing || !options} onChange={event => onDraft({ coa: event.target.value === 'auto' ? null : event.target.value, edited: true })}>
          <option value="auto">{isCoaRequest ? 'Match the requested lot' : 'No report'}</option>
          {isCoaRequest && <option value="">No report</option>}
          {options?.coas.map(coa => <option key={coa.sha256} value={coa.sha256}>{coa.productName} {coa.strength} · lot {coa.lot}{coa.current ? ' (current)' : ''}</option>)}
        </select></label>
      </div>
      {(attachedNow || chosen) && <p className={styles.attachment}>{attachedNow && (!chosen || chosen.sha256 === attachedNow.sha256)
        ? <>Attached: <strong>{attachedNow.filename || attachedNow.reportId}</strong> · {attachedNow.productName} {attachedNow.strength}, lot {attachedNow.lot}</>
        : <>Will attach when you save or send: <strong>{chosen!.productName} {chosen!.strength}, lot {chosen!.lot}</strong></>}</p>}
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
