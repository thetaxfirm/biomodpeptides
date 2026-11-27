import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { database, runtime } from '@/lib/runtime';
import { requestQueue } from '@/lib/admin-request-queue';
import { saveRequestWork, RequestWorkError } from '@/lib/admin-request-work';
import { can, isStaffRole } from '@/lib/staff';
import { teamMembers } from '@/lib/request-forward';
export const dynamic='force-dynamic';
const j=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:NextRequest){
 if(req.headers.get('origin')!==req.nextUrl.origin)return j({error:'Refresh and try again.'},403);
 let actor;try{actor=await requireStaff('requests:write');}catch{return j({error:'Customer request access required.'},403);}
 try{const b=await req.json() as Record<string,unknown>;if(!b||typeof b!=='object'||Array.isArray(b))return j({error:'Choose a request action.'},400);
  if(b.op==='queue')return j(await requestQueue(database(),b));
  if(b.op==='work')return j({work:await saveRequestWork(database(),actor,b,(await teamMembers(runtime())).filter(m=>isStaffRole(m.role)&&can(m.role,'requests:write')).map(m=>m.email))});
  return j({error:'Unknown request action.'},400);
 }catch(e){return j({error:e instanceof RequestWorkError?e.message:'The request queue could not refresh. Try again.'},e instanceof RequestWorkError?e.status:500);}
}
