import { NextRequest, NextResponse } from 'next/server';
import { database } from '@/lib/runtime';
import { PROMO_COOKIE, promotion } from '@/lib/promotions';
import { storedPromotions } from '@/lib/promo-codes';
import { partnerCodeForSlug, partnerSlots } from '@/lib/restaurant-partners';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{code:string}>}) {
 const response=NextResponse.redirect(new URL('/shop',req.url),302);
 response.headers.set('Cache-Control','no-store');
 try {
  // A vanity link first: /r/marios-pizza is a restaurant slot's own link, and resolves to that
  // slot's code. /r/MARIOSPIZZA keeps working, so links already handed out are unaffected. The
  // approved-affiliate check below is unchanged either way: a link never grants credit on its own
  // (owner, Nov 13 2026).
  const asked=(await params).code.trim();
  const code=(partnerCodeForSlug(await partnerSlots(database()),asked) || asked).toUpperCase();
  if(!/^[A-Z0-9]{1,40}$/.test(code)) return response;
  const partner=await database().prepare(`SELECT m.code FROM affiliate_members m JOIN affiliate_program_state s ON s.id=1 AND s.agreement_id=m.agreement_id JOIN affiliate_schedule_state ss ON ss.owner=m.owner JOIN affiliate_schedules f ON f.id=ss.schedule_id AND f.agreement_id=m.agreement_id JOIN affiliate_schedule_acceptances fa ON fa.schedule_id=f.id AND fa.owner=m.owner WHERE m.code=? AND m.status='approved'`).bind(code).first();
  if(partner && promotion(code, await storedPromotions(database()))) response.cookies.set(PROMO_COOKIE,code,{httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax',path:'/',maxAge:2592000});
 } catch { /* An unavailable affiliate service must not break the storefront. */ }
 return response;
}
