import { NextRequest, NextResponse } from 'next/server';
import { requireCustomer, staffRole } from '@/lib/auth';
import { can } from '@/lib/staff';
import { database, runtime } from '@/lib/runtime';
import { revealTin, readIdDocument, export1099, report1099, signatureRecord, sha256 } from '@/lib/affiliate-onboarding';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Sensitive reads: each is permission-checked and written to the affiliate activity log. */
export async function GET(req: NextRequest) {
 const p = req.nextUrl.searchParams;
 try {
  const user = await requireCustomer(), role = await staffRole(user.email), db = database(), vault = runtime().AFFILIATE_VAULT_KEY;
  const owner = role === 'owner', staff = Boolean(role && can(role, 'store:write'));
  if (p.has('packet')) {
   const record = await signatureRecord(db, p.get('packet') || '');
   if (!record || (!staff && record.owner !== user.id)) return json({ error: 'Not found.' }, 404);
   const packet = JSON.parse(record.packet), agreement = await db.prepare('SELECT body FROM affiliate_agreements WHERE id=?').bind(packet.agreement.id).first<{ body: string }>();
   const intact = await sha256(record.packet) === record.packet_sha256 && agreement && await sha256(agreement.body) === packet.agreement.bodySha256;
   const o = packet.offer, w = packet.w9, a = w.address;
   const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Signed affiliate packet ${esc(record.id.slice(0, 8))}</title>
<style>:root{color-scheme:light}body{font:15px/1.5 system-ui,-apple-system,sans-serif;color:#1b1d1c;background:#fff;max-width:760px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;padding-top:12px;border-top:1px solid #ddd}pre{white-space:pre-wrap;font:inherit}table{border-collapse:collapse;width:100%}td{padding:4px 8px 4px 0;vertical-align:top}td:first-child{color:#555;width:42%}.sig{border:1px solid #bbb;padding:8px;max-width:420px}.sig img{max-width:100%;height:auto}.ok{color:#1d5c2c}.bad{color:#9a1c1c}.page{page-break-before:always}@media print{button{display:none}}</style></head><body>
<button onclick="print()">Print or save as PDF</button>
<h1>Affiliate offer packet: signed</h1><p>${esc(packet.agreement.company)} · ${esc(packet.affiliate.email)}</p>
<p class="${intact ? 'ok' : 'bad'}">${intact ? 'Integrity check passed: the stored packet and agreement match their SHA-256 fingerprints.' : 'Integrity check failed: the stored record does not match its fingerprint.'}</p>
<h2>Offer</h2><table><tr><td>Partner code</td><td><strong>${esc(o.code)}</strong></td></tr><tr><td>Customer discount</td><td>${esc(o.customerDiscountPercent)}% off</td></tr><tr><td>Partner commission</td><td>${esc(o.commissionPercent)}% of the product sale after discount</td></tr><tr><td>Where the code works</td><td>${o.channels.map((c: string) => c === 'in_person' ? 'in person' : 'online').join(' and ').replace(/^./, (x: string) => x.toUpperCase())}</td></tr><tr><td>Hold after payment</td><td>${esc(o.holdDays)} days</td></tr><tr><td>Payment</td><td>${esc(o.payoutSchedule)}, minimum $${(o.minimumPayoutCents / 100).toFixed(2)}, by ${esc(o.payoutMethods)}</td></tr><tr><td>Agreement</td><td>${esc(packet.agreement.title)}, version ${esc(packet.agreement.version)}</td></tr></table>
<h2>Form W-9 information</h2><table><tr><td>Legal name</td><td>${esc(w.legalName)}</td></tr>${w.businessName ? `<tr><td>Business name</td><td>${esc(w.businessName)}</td></tr>` : ''}<tr><td>Federal tax classification</td><td>${esc(w.classification)}</td></tr><tr><td>${esc(w.tinType)}</td><td>•••-••-${esc(w.tinLast4)} (full number held encrypted)</td></tr><tr><td>Address</td><td>${esc(a.line1)} ${esc(a.line2)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</td></tr></table><p>${esc(w.certification)}</p>
<h2>Electronic signature</h2><p>${esc(record.consent)}</p><div class="sig"><img alt="Drawn signature of ${esc(record.typed_name)}" src="${esc(record.signature_png)}"></div><table><tr><td>Typed name</td><td>${esc(record.typed_name)}</td></tr><tr><td>Signed</td><td>${new Date(record.signed).toISOString()}</td></tr><tr><td>IP address</td><td>${esc(record.ip || 'not recorded')}</td></tr><tr><td>Device</td><td>${esc(record.user_agent)}</td></tr><tr><td>Packet SHA-256</td><td style="word-break:break-all">${esc(record.packet_sha256)}</td></tr><tr><td>Signature ID</td><td>${esc(record.id)}</td></tr></table>
${packet.talkingPoints ? `<h2 class="page">${esc(packet.talkingPoints.title)} (version ${esc(packet.talkingPoints.version)})</h2><pre>${esc(packet.talkingPoints.body)}</pre>` : ''}
<h2 class="page">${esc(packet.agreement.title)}</h2><pre>${esc(agreement?.body || 'Agreement text unavailable.')}</pre></body></html>`;
   if (staff && record.owner !== user.id) await db.prepare('INSERT INTO affiliate_events(id,owner,actor,action,detail,created) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), record.owner, user.id, 'packet.viewed', JSON.stringify({ id: record.id }), Date.now()).run();
   return new NextResponse(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } });
  }
  if (p.has('report1099')) { if (!staff) return json({ error: 'Not found.' }, 404); return json(await report1099(db, Number(p.get('report1099')) || new Date().getUTCFullYear())); }
  if (!owner) return json({ error: 'Only an owner can open tax identifiers and ID photos.' }, 403);
  if (p.has('tin')) return json(await revealTin(db, vault, user.id, p.get('tin') || ''));
  if (p.has('id')) { const doc = await readIdDocument(db, vault, user.id, p.get('id') || ''); return new NextResponse(doc.bytes as unknown as BodyInit, { headers: { ...headers, 'Content-Type': doc.mime, 'Content-Disposition': 'inline' } }); }
  if (p.has('export1099')) {
   const year = Number(p.get('export1099'));
   if (!Number.isInteger(year) || year < 2020 || year > 2100) return json({ error: 'Choose a tax year.' }, 400);
   return new NextResponse(await export1099(db, vault, user.id, year), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Biomod affiliate 1099-NEC ${year} v1.csv"` } });
  }
  return json({ error: 'Unknown request.' }, 400);
 } catch (error) {
  const message = error instanceof Error ? error.message : '';
  return json({ error: /^(Secure storage|No tax|Document not found)/.test(message) ? message : 'Could not open this record.' }, 400);
 }
}
