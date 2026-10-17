import { NextRequest, NextResponse } from 'next/server';
import { requireCustomer, requireStaff } from '@/lib/auth';
import { database } from '@/lib/runtime';
import { affiliatePortal, affiliateAdmin, publishAgreement, setAffiliateOpen, applyAffiliate, acceptAffiliateAgreement, reviewAffiliate, reviewCommission, offerAffiliateSchedule, acceptAffiliateSchedule } from '@/lib/affiliate-program';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest) {
 try {
  if(req.nextUrl.searchParams.get('admin')==='1') { const staff=await requireStaff('store:write'); return json({...await affiliateAdmin(database()),canPublish:staff.role==='owner'}); }
  const user=await requireCustomer(); return json(await affiliatePortal(database(),user.id));
 } catch { return json({error:'Affiliate information could not be loaded. Check your account access and try again.'},403); }
}
export async function POST(req:NextRequest) {
 if(req.headers.get('origin')!==req.nextUrl.origin) return json({error:'Refresh the page and try again.'},403);
 try {
  const reader=req.body?.getReader(); if(!reader) return json({error:'Missing request.'},400);
  let bytes=0,raw=''; const decoder=new TextDecoder();
  while(true) {const part=await reader.read(); if(part.done) break; bytes+=part.value.byteLength;if(bytes>30000){await reader.cancel();return json({error:'Request too large.'},413);}raw+=decoder.decode(part.value,{stream:true});}
  raw+=decoder.decode(); const body=JSON.parse(raw);
  const user=await requireCustomer(),db=database();
  if(body.action==='apply') return json(await applyAffiliate(db,user,body));
  if(body.action==='acceptSchedule') return json(await acceptAffiliateSchedule(db,user.id,body));
  if(body.action==='accept') return json(await acceptAffiliateAgreement(db,user.id,body));
  const staff=await requireStaff('store:write');
  if(body.action==='publish') {
   if(staff.role!=='owner') return json({error:'Only an owner can publish program terms.'},403);
   return json(await publishAgreement(db,staff.id,body));
  }
  if(body.action==='open') {
   if(staff.role!=='owner' || typeof body.open!=='boolean') return json({error:'An owner must change enrollment.'},403);
   return json(await setAffiliateOpen(db,staff.id,body.open));
  }
  if(body.action==='schedule') {
   if(staff.role!=='owner') return json({error:'Only an owner can set individual financial terms.'},403);
   return json(await offerAffiliateSchedule(db,staff.id,body));
  }
  if(body.action==='commission') return json(await reviewCommission(db,staff.id,body));
  if(body.action==='review') return json(await reviewAffiliate(db,staff.id,body));
  return json({error:'Unknown action.'},400);
 } catch(error) {
  const message=error instanceof Error?error.message:'';
  // Never return database diagnostics or provider responses.
  return json({error:/^(Publish |Enrollment |Your application|The agreement|The partner|Application changed|Another administrator|Select an existing|Submit an application)/.test(message)?message:'Could not save. Check the fields, agreement version, account access and whether the code is already assigned.'},400);
 }
}
