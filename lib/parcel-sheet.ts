// One page per parcel: the carrier's tracking history beside the shipping label, with copy,
// download and print, so a delivery problem can be sent to the customer or the carrier in one go
// (owner, Nov 8 2026: "when I press track, I want the label to also open side by side").
// Read-only. It shows what the carrier and the store recorded; it buys, sends and changes nothing.

import { labelFileName } from './label-filename';
export type TrackingEvent = { date: string; time: string; message: string; place: string; key: string };
export type ParcelHistory = { status: string; estimated: string; events: TrackingEvent[] };
export type ParcelEntry = {
    id: string; number: string; customer: string; place: string; service: string; tracking: string;
    protection: string; carrierPage: string | null; labelSrc: string | null; labelFile: string;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const clean = (v: unknown, max = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const https = (v: unknown) => typeof v === 'string' && /^https:\/\//i.test(v.trim()) ? v.trim() : null;

/**
 * Carriers report the local clock time at the scan, and their own pages show it as written. Read
 * the date and time straight from the string so this page says what the carrier page says.
 */
function clock(value: unknown): { date: string; time: string; key: string } | null {
    const m = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/) : null;
    if (!m) return null;
    const [, y, mo, d, h, mi] = m, hour = Number(h), month = MONTHS[Number(mo) - 1];
    if (!month || hour > 23) return null;
    return { date: month + ' ' + Number(d) + ', ' + y, time: ((hour % 12) || 12) + ':' + mi + (hour < 12 ? ' AM' : ' PM'), key: m[0] };
}

const STATUS: Record<string, string> = {
    unknown: 'Not scanned yet', pre_transit: 'Label created, not scanned yet', in_transit: 'In transit', out_for_delivery: 'Out for delivery',
    available_for_pickup: 'At the post office for pickup', delivered: 'Delivered', return_to_sender: 'Returning to sender',
    failure: 'Delivery failed', cancelled: 'Label cancelled', error: 'Carrier error',
};

/** EasyPost tracker → newest-first scan list. Unknown shapes give an empty list, never a guess. */
export function trackingHistory(tracker: unknown): ParcelHistory {
    const t = (tracker && typeof tracker === 'object' ? tracker : {}) as Record<string, any>;
    const details = Array.isArray(t.tracking_details) ? t.tracking_details.slice(0, 200) : [];
    const events = details.flatMap((d: any): TrackingEvent[] => {
        const at = clock(d?.datetime), message = clean(d?.message || STATUS[d?.status] || d?.status);
        if (!at || !message) return [];
        const loc = d?.tracking_location || {};
        return [{ ...at, message, place: [clean(loc.city, 60), clean(loc.state, 20)].filter(Boolean).join(', ') }];
    }).sort((a: TrackingEvent, b: TrackingEvent) => b.key.localeCompare(a.key));
    const estimated = clock(t.est_delivery_date);
    return { status: STATUS[t.status] || clean(t.status, 40) || 'No carrier status', estimated: estimated ? estimated.date : '', events };
}

/** Plain text for an email: the order line, then each scan, newest first, grouped by day. */
export function historyText(entry: ParcelEntry, history: ParcelHistory | null): string {
    const lines = ['Order ' + entry.number + ' · ' + [entry.service, entry.tracking ? 'Tracking ' + entry.tracking : ''].filter(Boolean).join(' · ')];
    if (!history) return lines.concat('', 'Carrier history unavailable.').join('\n');
    lines.push('Carrier status: ' + history.status);
    let day = '';
    for (const e of history.events) {
        if (e.date !== day) { day = e.date; lines.push('', day); }
        lines.push(e.time + '  ' + e.message + (e.place ? ' · ' + e.place : ''));
    }
    if (!history.events.length) lines.push('', 'The carrier has not reported any scans.');
    return lines.join('\n');
}

/** The saved label link, only when it is EasyPost's own https file host. */
export function labelSource(value: unknown): string | null {
    const url = https(value);
    if (!url) return null;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return /^easypost-files\.s3([.-][a-z0-9-]+)*\.amazonaws\.com$/.test(host) || host === 'easypost.com' || host.endsWith('.easypost.com') ? url : null;
    } catch { return null; }
}

export function parcelEntry(order: { id: string; data?: Record<string, any> }): ParcelEntry {
    const d = order.data || {}, s = d.shipment || {}, a = d.address || {}, number = '#' + order.id.slice(0, 8).toUpperCase();
    const cents = Number(s.insuredCents);
    return {
        id: order.id, number, customer: clean(a.name, 80), place: [clean(a.city, 60), clean(a.state, 20)].filter(Boolean).join(', '),
        service: clean(s.service || s.carrier, 60), tracking: clean(s.tracking, 60),
        protection: [cents > 0 ? 'Insured $' + (cents / 100).toFixed(2) : '', s.signature ? 'Signature required' : ''].filter(Boolean).join(' · '),
        carrierPage: https(s.trackingUrl), labelSrc: labelSource(s.labelUrl) ? '/api/admin/parcel?id=' + encodeURIComponent(order.id) + '&label=png' : null,
        labelFile: labelFileName(order.id, a.name, 'png'),
    };
}

const STYLE = `
:root{--ink:#2c1534;--muted:#655a68;--line:#e3dae6;--soft:#faf7fb;--accent:#43284f;--bad:#8a2f12;--good:#24603a}
*{box-sizing:border-box}
body{margin:0;padding:24px;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:var(--ink);background:#fff}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 18px;margin:0 0 6px}
h1{font-size:24px;margin:0}
.meta{color:var(--muted);font-size:14px;margin:0 0 16px}
.status{font-size:16px;margin:0 0 4px}
.status strong[data-problem]{color:var(--bad)}
.status strong[data-done]{color:var(--good)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,440px);gap:24px;align-items:start}
section{border:1px solid var(--line);border-radius:8px;padding:16px 18px;min-width:0}
h2{font-size:17px;margin:0 0 10px}
.tools{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}
button,.tool{font:inherit;font-size:14px;font-weight:600;padding:8px 14px;border-radius:6px;border:1px solid #cdbfd3;background:#fff;color:var(--accent);cursor:pointer;text-decoration:none}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button:focus-visible,.tool:focus-visible{outline:3px solid #765082;outline-offset:2px}
.day{margin:14px 0 4px;padding:6px 10px;background:var(--soft);border-radius:5px;font-weight:700}
.day:first-of-type{margin-top:0}
ol{list-style:none;margin:0;padding:0}
li{display:grid;grid-template-columns:5.5em 1fr;gap:12px;padding:7px 10px;border-bottom:1px solid #f1ecf3}
li:last-child{border-bottom:0}
.time{color:var(--muted);white-space:nowrap}
.place{display:block;color:var(--muted);font-size:13px}
.label{position:sticky;top:16px}
.label img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:4px;background:#fff}
.note{color:var(--muted);font-size:13px;margin:8px 0 0}
.empty{padding:14px;border:1px dashed #cdbfd3;border-radius:6px;color:var(--muted)}
[role=status]{min-height:1.4em;font-size:13px;color:var(--good);margin:0}
@media (max-width:860px){body{padding:16px}.grid{grid-template-columns:1fr}.label{position:static}}
@media print{body{padding:0}.label{position:static}.tools,[role=status],.noprint{display:none}.grid{grid-template-columns:1fr 1fr;gap:14px}section{border:0;padding:0}@page{margin:10mm}}
`;

const SCRIPT = `
const say=(m)=>{document.getElementById('said').textContent=m;};
document.getElementById('copyHistory')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.getElementById('historyText').value);say('Tracking history copied. Paste it into your email.');}catch{say('Copy was blocked by the browser. Select the history and copy it by hand.');}});
document.getElementById('copyLabel')?.addEventListener('click',async()=>{const src=document.getElementById('labelImage')?.getAttribute('src');try{await navigator.clipboard.write([new ClipboardItem({'image/png':fetch(src,{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error();return r.blob();})})]);say('Label image copied. Paste it into your email.');}catch{say('This browser would not copy the image. Use Download label and attach the file.');}});
document.getElementById('printBoth')?.addEventListener('click',()=>window.print());
`;

export function renderParcelSheet(entry: ParcelEntry, history: ParcelHistory | null, problem = ''): string {
    const status = history?.status || '';
    const flag = /failed|returning|error|cancelled/i.test(status) ? ' data-problem' : status === 'Delivered' ? ' data-done' : '';
    let day = '', scans = '';
    for (const e of history?.events || []) {
        if (e.date !== day) { scans += (day ? '</ol>' : '') + '<p class="day">' + esc(e.date) + '</p><ol>'; day = e.date; }
        scans += '<li><span class="time">' + esc(e.time) + '</span><span>' + esc(e.message) + (e.place ? '<span class="place">' + esc(e.place) + '</span>' : '') + '</span></li>';
    }
    if (day) scans += '</ol>';
    const historyBlock = history
        ? (scans || '<p class="empty">The carrier has not reported any scans for this parcel yet.</p>')
        : '<p class="empty">' + esc(problem || 'The carrier history is unavailable.') + '</p>';
    const label = entry.labelSrc
        ? '<img id="labelImage" src="' + esc(entry.labelSrc) + '" alt="' + esc('Shipping label for order ' + entry.number) + '">'
        : '<p class="empty">' + esc(problem && !history ? problem : 'No label file is saved for this order.') + '</p>';
    const title = 'Track ' + entry.number;
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta name="robots" content="noindex"><title>' + esc(title) + ' · TryBiomod</title><style>' + STYLE + '</style></head><body>'
        + '<header><h1>Order ' + esc(entry.number) + '</h1><span>' + esc([entry.customer, entry.place].filter(Boolean).join(' · ')) + '</span></header>'
        + '<p class="meta">' + esc([entry.service, entry.tracking ? 'Tracking ' + entry.tracking : '', entry.protection].filter(Boolean).join(' · ')) + '</p>'
        + (history ? '<p class="status">Carrier status: <strong' + flag + '>' + esc(status) + '</strong>' + (history.estimated ? ' <span class="meta">· estimated delivery ' + esc(history.estimated) + '</span>' : '') + '</p>' : '')
        + '<p id="said" role="status" aria-live="polite"></p>'
        + '<div class="grid">'
        + '<section aria-labelledby="historyHead"><h2 id="historyHead">Tracking history</h2><div class="tools">'
        + (history ? '<button type="button" class="primary" id="copyHistory">Copy tracking history</button>' : '')
        + (entry.carrierPage ? '<a class="tool" href="' + esc(entry.carrierPage) + '" target="_blank" rel="noopener noreferrer">Open carrier page</a>' : '')
        + '<button type="button" id="printBoth">Print or save as PDF</button></div>'
        + historyBlock
        + '<textarea id="historyText" hidden readonly>' + esc(historyText(entry, history)) + '</textarea></section>'
        + '<section class="label" aria-labelledby="labelHead"><h2 id="labelHead">Shipping label</h2><div class="tools">'
        + (entry.labelSrc ? '<button type="button" class="primary" id="copyLabel">Copy label image</button><a class="tool" href="' + esc(entry.labelSrc) + '&amp;download=1" download="' + esc(entry.labelFile) + '">Download label</a>' : '')
        + '</div>' + label + '<p class="note">Viewing or copying this label does not buy another one.</p></section>'
        + '</div><script>' + SCRIPT + '</script></body></html>';
}
