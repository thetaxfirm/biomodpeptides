'use client';
import { useEffect, useState } from 'react';
import { api } from './provider';

type Scalar = string | number | boolean | null;
type ChangeEvent = {
    id: string; occurredAt: number; recordedAt: number; source: string; actor: string;
    actorType: 'staff' | 'system' | 'provider' | 'git' | 'unknown';
    action: string; entityType: string; entityId: string; summary: string;
    status: 'succeeded' | 'failed' | 'observed' | 'attempted';
    changes: { field: string; before: Scalar; after: Scalar }[];
    evidenceUrl?: string; evidenceRef?: string;
};
type Coverage = { source: string; label: string; state: 'active' | 'partial' | 'unavailable'; description: string; lastSyncedAt?: number };
type ChangeReport = { events: ChangeEvent[]; nextCursor: string | null; coverage: Coverage[]; timeZone: 'UTC' };
type Filters = { q: string; source: string; from: string; to: string };
const emptyFilters: Filters = { q: '', source: '', from: '', to: '' };
const sourceNames: Record<string, string> = { admin: 'Store administration', system: 'Automated store activity', github: 'GitHub', cloudflare: 'Cloudflare hosting' };
const actorNames = { staff: 'Staff account', system: 'Automated action', provider: 'Provider identity', git: 'Commit author', unknown: 'Actor not verified' };
const outcomeNames = { succeeded: 'Succeeded', failed: 'Failed', observed: 'Observed', attempted: 'Attempted' };
const coverageNames = { active: 'Active', partial: 'Partial coverage', unavailable: 'Unavailable' };

function validDate(value: number) { const date = new Date(value); return Number.isFinite(value) && !Number.isNaN(date.getTime()) ? date : null; }
function utcTime(value: number) { return validDate(value)?.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') || 'Time unavailable'; }
function localTime(value: number) { return validDate(value)?.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) || 'Time unavailable'; }
function fieldName(field: string) { return field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').split('.').join(' › ').replace(/^./, letter => letter.toUpperCase()); }
function scalarValue(value: Scalar, field: string) {
    if (value === null) return 'Not set';
    if (value === '') return 'Empty';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return /(?:cents|\(cents\))\s*$/i.test(field) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100) : String(value);
    return value;
}
function safeEvidenceLink(value?: string) {
    if (!value) return undefined;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function EventTime({ value, local }: { value: number; local: boolean }) {
    return <time dateTime={validDate(value)?.toISOString()}>{local ? localTime(value) : utcTime(value)}</time>;
}

export function ChangeHistory() {
    const [draft, setDraft] = useState<Filters>(emptyFilters);
    const [request, setRequest] = useState({ filters: emptyFilters, before: '', append: false, revision: 0 });
    const [events, setEvents] = useState<ChangeEvent[]>([]);
    const [coverage, setCoverage] = useState<Coverage[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const [filterError, setFilterError] = useState('');
    const [localDates, setLocalDates] = useState(false);
    const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
    useEffect(() => {
        let active = true;
        const query = new URLSearchParams({ limit: '50' });
        for (const [key, value] of Object.entries(request.filters)) if (value) query.set(key, value);
        if (request.before) query.set('before', request.before);
        api('admin-changes?' + query.toString()).then((report: ChangeReport) => {
            if (!active) return;
            if (!Array.isArray(report.events) || !Array.isArray(report.coverage)) throw new Error('Invalid change history response');
            setEvents(previous => {
                const existing = request.append ? previous : [];
                const ids = new Set(existing.map(event => event.id));
                const incoming = report.events.filter(event => { if (ids.has(event.id)) return false; ids.add(event.id); return true; });
                return [...existing, ...incoming];
            });
            setCoverage(report.coverage);
            setNextCursor(report.nextCursor || null);
            setLoaded(true);
            setLastLoadedAt(Date.now());
        }).catch(() => {
            if (active) setError(request.append ? 'Older changes could not load. The entries already shown are unchanged. Retry to continue.' : 'Change history could not load. Please retry. This does not mean there were no changes.');
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [request]);

    function load(filters: Filters, before = '', append = false) {
        setError(''); setLoading(true);
        if (!append) { setEvents([]); setNextCursor(null); setLoaded(false); }
        setRequest(previous => ({ filters, before, append, revision: previous.revision + 1 }));
    }
    function applyFilters(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (draft.from && draft.to && draft.from > draft.to) { setFilterError('The start date must be on or before the end date.'); return; }
        setFilterError('');
        load({ ...draft, q: draft.q.trim() });
    }
    function clearFilters() { setDraft(emptyFilters); setFilterError(''); load(emptyFilters); }
    const filtered = Object.values(request.filters).some(Boolean);
    return <section className="change-history" aria-labelledby="change-history-heading">
        <div className="change-history-heading"><div><h2 id="change-history-heading">Changes</h2><p>A shared history of recorded storefront, pricing, function and hosting changes.</p></div><button type="button" className="button button-dark" disabled={loading} onClick={() => load(request.filters)}>{loading && !request.append ? 'Loading changes…' : 'Refresh changes'}</button></div>
        <p className="change-history-explanation">Each entry shows who made or reported the change, when it happened, and its recorded outcome. Coverage below explains the limits. An absent entry is not proof that nothing changed.</p>
        <details className="change-coverage">
            <summary>Source coverage{coverage.some(item => item.state !== 'active') ? ' · Some sources are incomplete' : ''}</summary>
            {coverage.length ? <ul>{coverage.map(item => <li key={item.source}><div className="change-coverage-label"><h3>{item.label}</h3><strong data-coverage={item.state}>{coverageNames[item.state]}</strong></div><p>{item.description}</p>{item.lastSyncedAt !== undefined && <p className="change-source-sync">Last source sync: <EventTime value={item.lastSyncedAt} local={localDates}/></p>}</li>)}</ul> : <p>{loading ? 'Loading coverage details…' : 'Coverage details are unavailable.'}</p>}
            <p className="change-coverage-footnote">GitHub records a commit author; that does not identify who deployed it. “Observed” records source evidence without independently proving that a change succeeded. Secrets and customer details are omitted.</p>
        </details>
        <form className="change-history-filters" onSubmit={applyFilters}>
            <label className="field change-search">Search changes<input type="search" value={draft.q} maxLength={120} placeholder="Product, setting, person or revision" onChange={event => setDraft(value => ({ ...value, q: event.target.value }))}/></label>
            <label className="field">Source<select value={draft.source} onChange={event => setDraft(value => ({ ...value, source: event.target.value }))}><option value="">All sources</option>{Object.entries(sourceNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="field">From (UTC)<input type="date" value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))}/></label>
            <label className="field">Through (UTC)<input type="date" value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))}/></label>
            <div className="change-filter-actions"><button className="button button-dark" type="submit">Apply filters</button><button type="button" className="text-button" onClick={clearFilters}>Clear filters</button></div>
            {filterError && <p role="alert" className="change-filter-error">{filterError}</p>}
        </form>
        <div className="change-history-toolbar"><p>{loaded ? <>{events.length} recorded {events.length === 1 ? 'entry' : 'entries'} loaded{filtered ? ' for the applied filters' : ''}. Newest first.</> : 'Recorded history'}</p><label>Display times<select value={localDates ? 'local' : 'utc'} onChange={event => setLocalDates(event.target.value === 'local')}><option value="utc">UTC</option><option value="local">My local time</option></select></label></div>
        <div className="change-history-results" aria-busy={loading}>
            {error && <div className="change-history-error" role="alert"><p>{error}</p><button className="text-button" type="button" onClick={() => load(request.filters, request.before, request.append)} disabled={loading}>Retry loading changes</button></div>}
            {loading && <p role="status">{request.append ? 'Loading older changes…' : 'Loading change history…'}</p>}
            {loaded && !events.length && !loading && !error && <div className="change-history-empty"><h3>No recorded changes match{filtered ? ' these filters' : ' this view'}.</h3><p>Try a wider date range or another source. Sources with partial or unavailable coverage may have changes that are not included here.</p></div>}
            <ol className="change-event-list">{events.map(event => {
                const link = safeEvidenceLink(event.evidenceUrl);
                return <li className="change-event" key={event.id}><article>
                    <div className="change-event-header"><h3>{event.summary || event.action}</h3><strong className="change-event-outcome" data-outcome={event.status}>{outcomeNames[event.status]}</strong></div>
                    <div className="change-event-byline"><strong>{event.actor || 'Unknown actor'}</strong><span>{actorNames[event.actorType]}</span><span>{sourceNames[event.source] || event.source}</span></div>
                    <div className="change-event-time"><span>Occurred <EventTime value={event.occurredAt} local={localDates}/></span>{localDates && <span className="change-utc-reference">{utcTime(event.occurredAt)}</span>}</div>
                    <details className="change-event-details"><summary>View change details{event.changes.length ? ` (${event.changes.length})` : ''}</summary>
                        <dl className="change-event-metadata"><div><dt>Action</dt><dd>{fieldName(event.action)}</dd></div><div><dt>Area</dt><dd>{fieldName(event.entityType)}</dd></div>{event.entityId && <div><dt>Record</dt><dd>{event.entityId}</dd></div>}<div><dt>Recorded</dt><dd><EventTime value={event.recordedAt} local={localDates}/></dd></div></dl>
                        {event.changes.length ? <div className="change-difference-table" role="table" aria-label={'Recorded changes: ' + (event.summary || event.action)}><div className="change-difference-heading" role="row"><span role="columnheader">Field</span><span role="columnheader">Before</span><span role="columnheader">After</span></div>{event.changes.map((change, index) => <div className="change-difference-row" role="row" key={change.field + ':' + index}><strong role="cell">{fieldName(change.field)}</strong><span role="cell"><span className="change-value-label">Before</span>{scalarValue(change.before, change.field)}</span><span role="cell"><span className="change-value-label">After</span>{scalarValue(change.after, change.field)}</span></div>)}</div> : <p className="change-missing-values">Before and after values were not supplied by this source.</p>}
                        {(event.evidenceRef || link) && <div className="change-event-evidence">{event.evidenceRef && <p>Evidence reference: <code>{event.evidenceRef}</code></p>}{link && <a href={link} target="_blank" rel="noopener noreferrer">View source evidence <span className="sr-only">(opens a new tab)</span></a>}</div>}
                    </details>
                </article></li>;
            })}</ol>
            {nextCursor && <button type="button" className="button button-dark change-load-more" disabled={loading} onClick={() => load(request.filters, nextCursor, true)}>{loading && request.append ? 'Loading older changes…' : 'Load older changes'}</button>}
        </div>
        {lastLoadedAt !== null && <p className="change-last-loaded">Last successful read: <EventTime value={lastLoadedAt} local={localDates}/>. Date filters use UTC calendar boundaries; the through date is inclusive.</p>}
    </section>;
}
