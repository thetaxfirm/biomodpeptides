import { runtime } from '@/lib/runtime';
import { suppressRecovery } from '@/lib/checkout-recovery';
const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
export async function GET(request:Request) {
 const token=new URL(request.url).searchParams.get('token')||'';
 if(!/^[a-f0-9-]{36}$/.test(token))return new Response('Invalid link.',{status:400,headers});
 // Viewing the link is read-only: mail scanners cannot unsubscribe the customer.
 return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BIOMOD email preferences</title><main><h1>Stop checkout reminders</h1><p>This stops promotional checkout reminders. Order and shipping updates will continue.</p><form method="post"><button type="submit">Unsubscribe from checkout reminders</button></form></main></html>',{headers});
}
export async function POST(request:Request) {
 const ok=await suppressRecovery(runtime(),new URL(request.url).searchParams.get('token')||'');
 return new Response(ok?'You have been unsubscribed from checkout reminders. Order and shipping updates are unchanged.':'This unsubscribe link was not recognized.',{status:ok?200:400,headers});
}
