import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { database } from '@/lib/runtime';
import { customerWorkspace, CustomerReadError } from '@/lib/admin-customers';
export const dynamic='force-dynamic';
const j=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:NextRequest) {
 if(req.headers.get('origin')!==req.nextUrl.origin)return j({error:'Refresh and try again.'},403);
 try{await requireStaff('reports:read');}catch{return j({error:'Customer reporting access required.'},403);}
 try{const body=await req.json() as Record<string,unknown>;if(!body||typeof body!=='object'||Array.isArray(body))return j({error:'Choose a customer.'},400);return j(await customerWorkspace(database(),body));}
 catch(e){return j({error:e instanceof CustomerReadError?e.message:'Customer history could not load completely. Try again.'},e instanceof CustomerReadError?e.status:500);}
}
