import { NextRequest, NextResponse } from 'next/server';
import { database } from '@/lib/runtime';
import { PROMO_COOKIE, promotion } from '@/lib/promotions';
import { storedPromotions } from '@/lib/promo-codes';
import { livePartnerCodes, partnerCodeForSlug, partnerSlots } from '@/lib/restaurant-partners';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{code:string}>}) {
 const response=NextResponse.redirect(new URL('/shop',req.url),302);
 response.headers.set('Cache-Control','no-store');
 try {
  // A restaurant slot's own link first: trybiomod.com/mariospizza15 arrives here as
  // /r/mariospizza15, which is that slot's code in lower case. /r/MARIOSPIZZA15 keeps working too,
  // so a link already handed out is unaffected whichever way it was written (owner, Nov 13 2026).
  const asked=(await params).code.trim();
  const slots=await partnerSlots(database());
  const code=(partnerCodeForSlug(slots,asked) || asked).toUpperCase();
  if(!/^[A-Z0-9]{1,40}$/.test(code)) return response;
  // A restaurant slot's own code applies on arrival: the link the owner hands a restaurant IS the
  // discount, so a customer who follows it must not have to type it again. These are the store's
  // own codes rather than affiliate members, and the order trigger that pays commission matches
  // approved members only, so arriving this way credits nobody (owner, Nov 13 2026).
  const restaurant=livePartnerCodes(slots).some(entry=>entry.code===code);
  const partner=restaurant || await database().prepare(`SELECT m.code FROM affiliate_members m JOIN affiliate_program_state s ON s.id=1 AND s.agreement_id=m.agreement_id JOIN affiliate_schedule_state ss ON ss.owner=m.owner JOIN affiliate_schedules f ON f.id=ss.schedule_id AND f.agreement_id=m.agreement_id JOIN affiliate_schedule_acceptances fa ON fa.schedule_id=f.id AND fa.owner=m.owner WHERE m.code=? AND m.status='approved'`).bind(code).first();
  if(partner && promotion(code, await storedPromotions(database()))) response.cookies.set(PROMO_COOKIE,code,{httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax',path:'/',maxAge:2592000});
 } catch { /* An unavailable affiliate service must not break the storefront. */ }
 return response;
}
