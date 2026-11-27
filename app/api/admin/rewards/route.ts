import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { database } from '@/lib/runtime';
import { rewardCustomers, rewardLedger, addRewardAdjustment, RewardError } from '@/lib/admin-rewards';
export const dynamic='force-dynamic';
const j=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:NextRequest) {
 if(req.headers.get('origin')!==req.nextUrl.origin) return j({error:'Refresh and try again.'},403);
 let actor;try{actor=await requireStaff('store:write');}catch{return j({error:'Store administrator access required.'},403);}
 try {
  const b=await req.json() as Record<string,unknown>; if(!b||Array.isArray(b)||typeof b!=='object')return j({error:'A JSON object is required.'},400);
  if(b.op==='lookup')return j({customers:await rewardCustomers(database(),b.query)});
  if(b.op==='ledger')return j(await rewardLedger(database(),b.owner,b.before));
  if(b.op==='adjust')return j(await addRewardAdjustment(database(),actor,b));
  return j({error:'Unknown reward action.'},400);
 }catch(e){return j({error:e instanceof RewardError?e.message:'The reward ledger could not be updated. Refresh and try again.'},e instanceof RewardError?e.status:500);}
}
