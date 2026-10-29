import { NextRequest, NextResponse } from 'next/server';
import { requireCustomer, requireStaff, rateLimit } from '@/lib/auth';
import { database, runtime } from '@/lib/runtime';
import { onboardingPortal, onboardingAdmin, saveTaxProfile, saveIdDocument, signOfferPacket, sendOffer, publishTalkingPoints, reviewTaxProfile, recordManualSale, recordPayout } from '@/lib/affiliate-onboarding';
import { invitedAffiliate } from '@/lib/affiliate-program';
import { recordContact } from '@/lib/contacts';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
// Two ID photos are sent one at a time; a signature and a W-9 are far smaller.
const MAX_BODY = 1400000;
export async function GET(req: NextRequest) {
 try {
  const db = database();
  if (req.nextUrl.searchParams.get('admin') === '1') { const staff = await requireStaff('store:write'); return json({ ...await onboardingAdmin(db), canOwn: staff.role === 'owner', vaultReady: Boolean(runtime().AFFILIATE_VAULT_KEY) }); }
  const user = await requireCustomer();
  if (!await db.prepare('SELECT 1 FROM affiliate_members WHERE owner=?').bind(user.id).first() && !await invitedAffiliate(db, user.email)) return json({ error: 'This program is invitation-only.' }, 403);
  return json({ ...await onboardingPortal(db, user.id), vaultReady: Boolean(runtime().AFFILIATE_VAULT_KEY) });
 } catch { return json({ error: 'Onboarding could not be loaded. Check your account access and try again.' }, 403); }
}
export async function POST(req: NextRequest) {
 if (req.headers.get('origin') !== req.nextUrl.origin) return json({ error: 'Refresh the page and try again.' }, 403);
 try {
  const reader = req.body?.getReader(); if (!reader) return json({ error: 'Missing request.' }, 400);
  let bytes = 0, raw = ''; const decoder = new TextDecoder();
  while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > MAX_BODY) { await reader.cancel(); return json({ error: 'That upload is too large. Retake the photo closer or choose a smaller image.' }, 413); } raw += decoder.decode(part.value, { stream: true }); }
  raw += decoder.decode(); const body = JSON.parse(raw);
  const user = await requireCustomer(), db = database(), vault = runtime().AFFILIATE_VAULT_KEY;
  if (['tax', 'id', 'sign'].includes(body.action)) {
   await rateLimit('affiliate-onboarding:' + user.id, 40);
   if (body.action === 'tax') { const r = await saveTaxProfile(db, vault, user.id, body.tax); await recordContact(db, { email: user.email, owner: user.id, name: body.tax?.legalName, phone: body.tax?.phone, source: 'affiliate' }); return json(r); }
   if (body.action === 'id') return json(await saveIdDocument(db, vault, user.id, body));
   return json(await signOfferPacket(db, user.id, body, { ip: req.headers.get('cf-connecting-ip') || '', userAgent: req.headers.get('user-agent') || '' }));
  }
  const staff = await requireStaff('store:write'), owner = staff.role === 'owner';
  if (body.action === 'offer') { if (!owner) return json({ error: 'Only an owner can set partner offers.' }, 403); return json(await sendOffer(db, staff.id, body)); }
  if (body.action === 'talkingPoints') { if (!owner) return json({ error: 'Only an owner can publish talking points.' }, 403); return json(await publishTalkingPoints(db, staff.id, body)); }
  if (body.action === 'payout') { if (!owner) return json({ error: 'Only an owner can record payouts.' }, 403); return json(await recordPayout(db, staff.id, body)); }
  if (body.action === 'taxReview') return json(await reviewTaxProfile(db, staff.id, body));
  if (body.action === 'manualSale') return json(await recordManualSale(db, staff.id, body));
  return json({ error: 'Unknown action.' }, 400);
 } catch (error) {
  const message = error instanceof Error ? error.message : '';
  const issue = (error as { issues?: { message: string; path: (string | number)[] }[] })?.issues?.[0];
  if (issue) return json({ error: (issue.path.length ? issue.path.join(' ') + ': ' : '') + issue.message }, 400);
  // Only our own plain-language errors reach the browser; never database or crypto diagnostics.
  return json({ error: /^(Secure storage|Submit your|Your partnership|That photo|Upload a|Finish these|This offer|The offer|Type your|Draw your|Another administrator|Explain what|No tax|The partner|Verify this|Publish |Select a|Codes are|There are already|Promo codes changed|Only an|Too many)/.test(message) || / already belongs to another partner| is a built-in store code/.test(message) ? message : 'Could not save. Reload the page and try again.' }, 400);
 }
}
