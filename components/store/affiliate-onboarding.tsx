'use client';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Member } from '@/lib/affiliate-program';
import { Field } from './primitives';

type Tax = { legal_name: string; business_name: string; classification: string; tin_type: string; tin_last4: string; address: string; phone: string; status: string; review_note: string; updated: number };
type IdDoc = { id: string; owner?: string; side: string; bytes: number; created: number };
type Sale = { id: string; owner: string; sold_on: string; basis_cents: number; commission_bps: number; commission_cents: number; code: string; note: string };
type Payout = { id: string; owner: string; amount_cents: number; paid_on: string; method: string; reference: string; note: string };
type Packet = { ready: false; missing: string[]; signed: boolean } | { ready: true; missing: []; signed: boolean; needsAgreement: boolean; sha256: string; agreementBody: string; packet: { offer: { scheduleId: string; code: string; customerDiscountPercent: number; commissionPercent: number; holdDays: number; payoutMethods: string; channels: string[]; minimumPayoutCents: number; payoutSchedule: string }; agreement: { title: string; version: string; company: string }; talkingPoints: { title: string; version: string; body: string } | null; w9: { legalName: string; classification: string; tinType: string; tinLast4: string; certification: string }; consent: string } };
type Portal = { tax: Tax | null; ids: IdDoc[]; packet: Packet; signature: { id: string; signed: number } | null; manualSales: Sale[]; payouts: Payout[]; classifications: Record<string, string>; vaultReady: boolean };
type Report = { year: number; thresholdCents: number; rows: { owner: string; total: number; payments: number; name: string; email: string; legal_name: string | null; tin_type: string | null; tin_last4: string | null; reportable: boolean; warnings: string[] }[] };
type Admin = { canOwn: boolean; vaultReady: boolean; taxes: (Tax & { owner: string })[]; ids: IdDoc[]; signatures: { id: string; owner: string; schedule_id: string; typed_name: string; signed: number }[]; offers: { id: string; owner: string; code: string | null; discount_percent: number | null; commission_bps: number; hold_days: number; payout_methods: string; channels: string; created: number; accepted: number | null }[]; talkingPoints: { id: string; version: string; title: string; body: string; created: number } | null; defaultTalkingPoints: { version: string; title: string; body: string }; manualSales: Sale[]; payouts: Payout[]; report1099: Report; years: number[] };

const money = (cents: number) => (cents < 0 ? '-$' : '$') + (Math.abs(cents) / 100).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);
async function call<T>(admin: boolean, body?: unknown): Promise<T & { message?: string }> {
 const response = await fetch('/api/affiliates/onboarding' + (admin ? '?admin=1' : ''), { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
 const data = await response.json().catch(() => ({ error: 'The server did not respond. Try again.' })) as T & { message?: string; error?: string };
 if (!response.ok) throw Error(data.error || 'Unable to save.');
 return data;
}
/** Phone photos are often 4–12 MB. Resize in the browser so the upload is a few hundred KB. */
async function photoDataUrl(file: File) {
 if (!/^image\//.test(file.type) && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) throw Error('Choose a photo of your license.');
 const bitmap = await createImageBitmap(file).catch(() => { throw Error('This photo format could not be read. Take the photo with your camera or save it as JPEG.'); });
 const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
 canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
 canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
 for (const quality of [0.82, 0.7, 0.55]) { const url = canvas.toDataURL('image/jpeg', quality); if (url.length < 1150000) return url; }
 throw Error('That photo is too large. Retake it a little farther away.');
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
 const ref = useRef<HTMLCanvasElement>(null), drawing = useRef(false), strokes = useRef(0);
 useEffect(() => { const c = ref.current!; const ratio = window.devicePixelRatio || 1; c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio; const g = c.getContext('2d')!; g.scale(ratio, ratio); g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111'; }, []);
 const point = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
 const done = () => { if (!drawing.current) return; drawing.current = false; strokes.current++; onChange(strokes.current ? ref.current!.toDataURL('image/png') : ''); };
 return <div><canvas ref={ref} aria-label="Signature box. Draw your signature with your finger or mouse." role="img" style={{ width: '100%', maxWidth: 480, height: 160, border: '1px solid currentColor', borderRadius: 6, touchAction: 'none', background: '#fff', display: 'block' }}
  onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const g = e.currentTarget.getContext('2d')!; const [x, y] = point(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke(); }}
  onPointerMove={e => { if (!drawing.current) return; const g = e.currentTarget.getContext('2d')!; const [x, y] = point(e); g.lineTo(x, y); g.stroke(); }}
  onPointerUp={done} onPointerCancel={done} onPointerLeave={done}/>
  <button type="button" className="text-button" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); strokes.current = 0; onChange(''); }}>Clear signature</button></div>;
}

/** The partner's steps after applying: W-9, license photo, then sign the offer. */
export function AffiliateOnboarding() {
 const [data, setData] = useState<Portal | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [generation, setGeneration] = useState(0);
 const [editingTax, setEditingTax] = useState(false), [tinType, setTinType] = useState('ssn'), [signature, setSignature] = useState('');
 useEffect(() => { let live = true; call<Portal>(false).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [generation]);
 async function save(body: unknown, after?: () => void) { setBusy(true); setError(''); setMessage(''); try { const r = await call<{ message: string }>(false, body); setMessage(r.message || 'Saved.'); after?.(); setGeneration(g => g + 1); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.'); } finally { setBusy(false); } }
 async function upload(side: 'front' | 'back', file: File | undefined) { if (!file) return; setBusy(true); setError(''); try { const dataUrl = await photoDataUrl(file); setBusy(false); await save({ action: 'id', side, dataUrl }); } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); setBusy(false); } }
 function submitTax(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; void save({ action: 'tax', tax: { legalName: v.legalName, businessName: v.businessName, classification: v.classification, tinType: v.tinType, tin: v.tin, phone: v.phone, address: { line1: v.line1, line2: v.line2, city: v.city, state: v.state, zip: v.zip } } }, () => setEditingTax(false)); }
 if (!data) return <section className="affiliate-onboarding">{error ? <p role="alert">{error}</p> : <p role="status">Loading onboarding…</p>}</section>;
 const address = data.tax ? JSON.parse(data.tax.address) : null, front = data.ids.find(d => d.side === 'front'), back = data.ids.find(d => d.side === 'back');
 const p = data.packet, step = (n: number, title: string, complete: boolean) => <h3>{complete ? '✓ ' : n + '. '}{title}</h3>;
 return <section className="affiliate-onboarding" aria-label="Partner onboarding"><h2>Finish your partner setup</h2>
  <p>Three steps: your tax details, a photo of your driver’s license, then sign your offer. Your Social Security or EIN number and license photo are encrypted; Biomod staff see only the last four digits.</p>
  {!data.vaultReady && <p role="alert">Secure storage is being set up. You can review your offer now; tax details can be submitted shortly.</p>}
  {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  {step(1, 'Tax details (Form W-9)', Boolean(data.tax))}
  {data.tax && !editingTax ? <div className="account-record"><p>{data.tax.legal_name}{data.tax.business_name ? ' · ' + data.tax.business_name : ''} · {data.classifications[data.tax.classification]}</p><p>{data.tax.tin_type.toUpperCase()} ending {data.tax.tin_last4} · {address.line1}{address.line2 ? ' ' + address.line2 : ''}, {address.city}, {address.state} {address.zip} · {data.tax.phone}</p><p>Status: <strong>{data.tax.status === 'verified' ? 'Verified' : data.tax.status === 'rejected' ? 'Needs a correction' : 'Waiting for Biomod review'}</strong>{data.tax.review_note ? ' · ' + data.tax.review_note : ''}</p><button type="button" className="text-button" onClick={() => { setTinType(data.tax!.tin_type); setEditingTax(true); }}>Update tax details</button></div>
   : <form className="store-form" onSubmit={submitTax} autoComplete="on">
    <Field label="Legal name (as shown on your tax return)" name="legalName" defaultValue={data.tax?.legal_name}/>
    <Field label="Business name, if different (optional)" name="businessName" required={false} defaultValue={data.tax?.business_name}/>
    <label className="field">Federal tax classification<select name="classification" defaultValue={data.tax?.classification || 'individual'}>{Object.entries(data.classifications).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <fieldset className="field"><legend>Taxpayer ID</legend><label><input type="radio" name="tinType" value="ssn" checked={tinType === 'ssn'} onChange={() => setTinType('ssn')}/> Social Security number</label> <label><input type="radio" name="tinType" value="ein" checked={tinType === 'ein'} onChange={() => setTinType('ein')}/> EIN (business)</label></fieldset>
    <label className="field">{tinType === 'ssn' ? 'Social Security number' : 'Employer identification number'}<input name="tin" required inputMode="numeric" autoComplete="off" placeholder={tinType === 'ssn' ? '123-45-6789' : '12-3456789'} pattern="[0-9\- ]{9,11}" maxLength={11}/></label>
    <Field label="Street address" name="line1" defaultValue={address?.line1}/><Field label="Apartment, suite (optional)" name="line2" required={false} defaultValue={address?.line2}/>
    <Field label="City" name="city" defaultValue={address?.city}/><div className="form-row"><Field label="State" name="state" placeholder="NV" defaultValue={address?.state}/><Field label="ZIP code" name="zip" defaultValue={address?.zip}/></div>
    <Field label="Mobile phone" name="phone" type="tel" defaultValue={data.tax?.phone}/>
    <button className="button button-dark" disabled={busy || !data.vaultReady}>Save tax details securely</button>{editingTax && <button type="button" className="text-button" onClick={() => setEditingTax(false)}>Cancel</button>}</form>}
  {step(2, 'Driver’s license photo', Boolean(front))}
  <p>Take a clear photo of the front of your license, with all four corners visible. The back is optional.</p>
  <div className="form-row">{(['front', 'back'] as const).map(side => { const doc = side === 'front' ? front : back; return <label key={side} className="field">{side === 'front' ? 'Front of license' : 'Back of license (optional)'}{doc ? <span> · Saved {new Date(doc.created).toLocaleDateString()}</span> : null}<input type="file" accept="image/*" capture="environment" disabled={busy || !data.vaultReady} onChange={e => { void upload(side, e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}/></label>; })}</div>
  {step(3, 'Review and sign your offer', p.signed)}
  {data.signature ? <p>Signed {new Date(data.signature.signed).toLocaleString()}. <a href={'/api/affiliates/vault?packet=' + data.signature.id} target="_blank" rel="noopener">Open your signed packet</a> to print or save it.</p> : null}
  {!p.ready ? <p>{p.missing.includes('an offer from Biomod') ? 'Biomod is preparing your offer. ' : ''}Still needed: {p.missing.join(', ')}.</p> : !p.signed && <form className="store-form" onSubmit={e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; void save({ action: 'sign', scheduleId: p.packet.offer.scheduleId, packetSha256: p.sha256, typedName: v.typedName, signature, consent: v.consent === 'on', certify: v.certify === 'on' }); }}>
   <div className="account-record"><h4>Your offer</h4><p>Your code <strong>{p.packet.offer.code}</strong> gives customers <strong>{p.packet.offer.customerDiscountPercent}% off</strong>, {p.packet.offer.channels.map(c => c === 'in_person' ? 'in person' : 'online').join(' and ')}.</p><p>You earn <strong>{p.packet.offer.commissionPercent}%</strong> of each sale after the discount (not shipping or tax). Paid {p.packet.offer.payoutSchedule.toLowerCase()} by {p.packet.offer.payoutMethods} once you reach {money(p.packet.offer.minimumPayoutCents)}, after a {p.packet.offer.holdDays}-day hold.</p></div>
   {p.packet.talkingPoints && <details open><summary>{p.packet.talkingPoints.title}: what you can and cannot say</summary><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '1rem 0' }}>{p.packet.talkingPoints.body}</div></details>}
   <details><summary>{p.packet.agreement.title} (version {p.packet.agreement.version}){p.needsAgreement ? ': new version' : ''}</summary><div tabIndex={0} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 420, overflowY: 'auto', padding: '1rem 0' }}>{p.agreementBody}</div></details>
   <div className="account-record"><h4>Form W-9 certification</h4><p>{p.packet.w9.legalName} · {p.packet.w9.classification} · {p.packet.w9.tinType} ending {p.packet.w9.tinLast4}</p><p>{p.packet.w9.certification}</p></div>
   <label><input type="checkbox" name="certify" required/> I certify the W-9 statements above are true.</label>
   <label><input type="checkbox" name="consent" required/> {p.packet.consent}</label>
   <p>Draw your signature:</p><SignaturePad onChange={setSignature}/>
   <Field label={'Type your full legal name: ' + p.packet.w9.legalName} name="typedName"/>
   <button className="button button-dark" disabled={busy || !signature}>Sign offer packet</button>{!signature && <p>Draw your signature to enable signing.</p>}</form>}
  {(data.manualSales.length > 0 || data.payouts.length > 0) && <><h3>In-person sales and payments</h3>
   {data.manualSales.map(s => <p key={s.id}>{s.sold_on} · In-person sale {money(s.basis_cents)} · Commission {money(s.commission_cents)}</p>)}
   {data.payouts.map(x => <p key={x.id}>{x.paid_on} · {x.amount_cents < 0 ? 'Correction' : 'Paid'} {money(x.amount_cents)} by {x.method}</p>)}</>}
 </section>;
}

/** Owner and manager tools: talking points, offers, W-9/ID review, in-person sales, payouts and the 1099. */
export function AffiliateOnboardingAdmin({ members, reloadProgram }: { members: Member[]; reloadProgram: () => void }) {
 const [data, setData] = useState<Admin | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [generation, setGeneration] = useState(0);
 const [report, setReport] = useState<Report | null>(null), [revealed, setRevealed] = useState<Record<string, string>>({});
 useEffect(() => { let live = true; call<Admin>(true).then(d => { if (live) { setData(d); setReport(d.report1099); } }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [generation]);
 async function save(body: unknown, form?: HTMLFormElement) { setBusy(true); setError(''); setMessage(''); try { const r = await call<{ message: string }>(true, body); setMessage(r.message || 'Saved.'); form?.reset(); setGeneration(g => g + 1); reloadProgram(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.'); } finally { setBusy(false); } }
 async function loadYear(year: number) { setError(''); try { const r = await fetch('/api/affiliates/vault?report1099=' + year, { cache: 'no-store' }); const d = await r.json() as Report & { error?: string }; if (!r.ok) throw Error(d.error); setReport(d); } catch (e) { setError(e instanceof Error ? e.message : 'Report unavailable.'); } }
 async function reveal(owner: string) { setError(''); try { const r = await fetch('/api/affiliates/vault?tin=' + encodeURIComponent(owner), { cache: 'no-store' }); const d = await r.json() as { tin: string; error?: string }; if (!r.ok) throw Error(d.error); setRevealed(v => ({ ...v, [owner]: d.tin })); setTimeout(() => setRevealed(v => { const n = { ...v }; delete n[owner]; return n; }), 30000); } catch (e) { setError(e instanceof Error ? e.message : 'Could not open.'); } }
 const form = (action: string, build: (v: Record<string, string>, f: HTMLFormElement) => Record<string, unknown>) => (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = e.currentTarget, v = Object.fromEntries(new FormData(f)) as Record<string, string>; void save({ action, ...build(v, f) }, f); };
 if (!data) return <section>{error ? <p role="alert">{error}</p> : <p role="status">Loading onboarding…</p>}</section>;
 const points = data.talkingPoints || data.defaultTalkingPoints, years = [...new Set([new Date().getUTCFullYear(), ...data.years])].sort((a, b) => b - a);
 return <section className="affiliate-onboarding-admin" aria-label="Partner onboarding and payments"><h3>Partner offers, W-9s and payments</h3>
  {!data.vaultReady && <p role="alert">Secure storage key AFFILIATE_VAULT_KEY is not set on the server. Partners cannot submit SSNs or license photos until it is.</p>}
  {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  <p>Send each invited partner <strong>https://trybiomod.com/account/affiliate</strong>. They sign in with the invited email, apply, add their W-9 and license photo, then sign the offer you set below.</p>
  <details><summary>One-page talking points{data.talkingPoints ? ' · version ' + data.talkingPoints.version + ' published' : ' · not published yet'}</summary>
   {data.canOwn ? <form className="store-form" onSubmit={form('talkingPoints', v => ({ version: v.version, title: v.title, body: v.body, confirmed: v.confirmed === 'on' }))}><p>{'{CODE}'} and {'{DISCOUNT}'} are filled in with each partner’s code and percent. Each version is kept; signed packets keep the version that was signed.</p>
    <Field label="Version (new and unique)" name="version" defaultValue={data.talkingPoints ? '' : points.version}/><Field label="Title" name="title" defaultValue={points.title}/>
    <label className="field">Talking points<textarea name="body" required minLength={200} maxLength={8000} rows={18} defaultValue={points.body}/></label>
    <label><input type="checkbox" name="confirmed" required/> These talking points are approved for partners.</label><button className="button button-dark" disabled={busy}>Publish talking points</button></form>
    : <div style={{ whiteSpace: 'pre-wrap' }}>{points.body}</div>}</details>
  {!members.length && <p>No partner applications yet.</p>}
  {members.map(m => { const offer = data.offers.find(o => o.owner === m.owner), tax = data.taxes.find(t => t.owner === m.owner), ids = data.ids.filter(d => d.owner === m.owner), sig = data.signatures.find(s => s.owner === m.owner && s.schedule_id === offer?.id), sales = data.manualSales.filter(s => s.owner === m.owner), paid = data.payouts.filter(x => x.owner === m.owner);
   const owed = sales.reduce((t, s) => t + s.commission_cents, 0); const address = tax ? JSON.parse(tax.address) : null;
   return <article className="account-record" key={m.owner}><h4>{m.name} · {m.email}</h4>
    <p>Offer: {offer?.code ? <>code <strong>{offer.code}</strong> · {offer.discount_percent}% off for customers · {offer.commission_bps / 100}% commission · {offer.hold_days}-day hold · {offer.channels.replace('in_person', 'in person').replace(',', ' and ')} · {offer.accepted ? 'Signed' : 'Waiting for signature'}</> : offer ? 'Older terms without a code; send an offer below.' : 'None yet.'}</p>
    {sig && <p>Signed by {sig.typed_name} on {new Date(sig.signed).toLocaleString()} · <a href={'/api/affiliates/vault?packet=' + sig.id} target="_blank" rel="noopener">Open signed packet</a></p>}
    {data.canOwn && <details><summary>{offer ? 'Send a new offer' : 'Send offer'}</summary><form className="store-form" onSubmit={form('offer', v => ({ owner: m.owner, code: v.code, discountPercent: Number(v.discount), commissionBps: Math.round(Number(v.commission) * 100), holdDays: Number(v.hold), payoutMethods: v.methods, channels: [v.online === 'on' && 'online', v.inPerson === 'on' && 'in_person'].filter(Boolean) }))}>
     <Field label="Partner code (letters and digits, e.g. DRMATT10)" name="code" defaultValue={offer?.code || ''}/>
     <div className="form-row"><label className="field">Customer discount %<input name="discount" type="number" required min={1} max={90} step={1} defaultValue={offer?.discount_percent ?? 10}/></label><label className="field">Partner commission %<input name="commission" type="number" required min={0} max={100} step={0.01} defaultValue={offer ? offer.commission_bps / 100 : 20}/></label><label className="field">Hold after payment (days)<input name="hold" type="number" required min={0} max={365} step={1} defaultValue={offer?.hold_days ?? 30}/></label></div>
     <Field label="Payout method (no bank details here)" name="methods" defaultValue={offer?.payout_methods || 'Check or ACH'}/>
     <fieldset className="field"><legend>Code works</legend><label><input type="checkbox" name="online" defaultChecked/> Online</label> <label><input type="checkbox" name="inPerson" defaultChecked/> In person</label></fieldset>
     <p>Saving creates or updates the store promo code at this discount. The partner must sign before new orders earn commission. Nothing is emailed.</p><button className="button button-dark" disabled={busy}>Save offer</button></form></details>}
    <p>W-9: {tax ? <>{tax.legal_name}{tax.business_name ? ' (' + tax.business_name + ')' : ''} · {tax.tin_type.toUpperCase()} {revealed[m.owner] || '•••-••-' + tax.tin_last4} {data.canOwn && !revealed[m.owner] && <button type="button" className="text-button" onClick={() => void reveal(m.owner)}>Show full number</button>} · {address.line1}, {address.city}, {address.state} {address.zip} · {tax.phone} · <strong>{tax.status}</strong></> : 'Not submitted.'}</p>
    <p>License: {ids.length ? ids.map(d => data.canOwn ? <a key={d.id} href={'/api/affiliates/vault?id=' + d.id} target="_blank" rel="noopener">{d.side} ({Math.round(d.bytes / 1024)} KB) </a> : <span key={d.id}>{d.side} on file </span>) : 'No photo yet.'}</p>
    {tax && <form className="store-form" onSubmit={form('taxReview', v => ({ owner: m.owner, status: v.status, note: v.note || '' }))}><div className="form-row"><label className="field">W-9 and license<select name="status" defaultValue="verified"><option value="verified">Verified: name, number and license match</option><option value="rejected">Needs a correction</option></select></label><Field label="Note to partner (required for a correction)" name="note" required={false}/></div><button className="button button-dark" disabled={busy}>Save W-9 review</button></form>}
    {m.status === 'approved' && <details><summary>Record an in-person sale</summary><form className="store-form" onSubmit={form('manualSale', v => ({ owner: m.owner, soldOn: v.soldOn, basisCents: Math.round(Number(v.amount) * 100), note: v.note }))}><div className="form-row"><Field label="Date" name="soldOn" type="date" defaultValue={today()}/><label className="field">Product sale after discount (USD, no tax or shipping)<input name="amount" type="number" required min={0.01} step={0.01}/></label></div><Field label="What was sold / receipt number" name="note"/><button className="button button-dark" disabled={busy}>Credit sale</button></form></details>}
    {sales.length > 0 && <p>In-person credits: {sales.length} sales · {money(owed)} commission</p>}
    {paid.map(x => <p key={x.id}>{x.paid_on} · {x.amount_cents < 0 ? 'Correction' : 'Paid'} {money(x.amount_cents)} · {x.method}{x.reference ? ' · ' + x.reference : ''}</p>)}
    {data.canOwn && <details><summary>Record a payout</summary><form className="store-form" onSubmit={form('payout', v => ({ owner: m.owner, amountCents: Math.round(Number(v.amount) * 100), paidOn: v.paidOn, method: v.method, reference: v.reference || '', note: v.note || '' }))}><p>Record money you already sent. Use a negative amount to correct an earlier entry. Payouts feed the 1099 report.</p><div className="form-row"><label className="field">Amount paid (USD)<input name="amount" type="number" required step={0.01}/></label><Field label="Date paid" name="paidOn" type="date" defaultValue={today()}/></div><div className="form-row"><Field label="Method" name="method" defaultValue={offer?.payout_methods || ''}/><Field label="Check number or transfer reference" name="reference" required={false}/></div><Field label="Note" name="note" required={false}/><button className="button button-dark" disabled={busy}>Record payout</button></form></details>}
   </article>; })}
  <h3>1099-NEC report</h3>
  <label className="field">Tax year<select value={report?.year} onChange={e => void loadYear(Number(e.target.value))}>{years.map(y => <option key={y}>{y}</option>)}</select></label>
  {report && <><p>Payments recorded in {report.year}. Filing threshold {money(report.thresholdCents)} ({report.year >= 2026 ? 'raised from $600 for 2026 payments' : 'before the 2026 change'}); confirm with your accountant. Due to recipients and the IRS by January 31.</p>
   {!report.rows.length ? <p>No payouts recorded for {report.year}.</p> : <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Partner</th><th>Legal name</th><th>TIN</th><th>Paid in {report.year}</th><th>File 1099?</th><th>Check</th></tr></thead><tbody>{report.rows.map(r => <tr key={r.owner}><td>{r.name}<br/>{r.email}</td><td>{r.legal_name || '—'}</td><td>{r.tin_type ? r.tin_type.toUpperCase() + ' …' + r.tin_last4 : '—'}</td><td>{money(r.total)} ({r.payments})</td><td>{r.reportable ? 'Yes' : 'No'}</td><td>{r.warnings.join('; ') || 'OK'}</td></tr>)}</tbody></table></div>}
   {data.canOwn && report.rows.length > 0 && <p><a className="button button-dark" href={'/api/affiliates/vault?export1099=' + report.year}>Download {report.year} 1099 CSV for your accountant</a> (includes full tax numbers; keep it private)</p>}</>}
 </section>;
}
