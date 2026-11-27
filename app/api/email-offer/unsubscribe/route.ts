import { runtime } from '@/lib/runtime';
import { emailOfferUnsubscribe } from '@/lib/email-offer';
const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const page = (title: string, body: string) => `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BIOMOD email preferences</title><style>body{margin:0;font:16px/1.6 "Helvetica Neue",Arial,sans-serif;color:#2b1030;background:#fff}main{max-width:440px;margin:15vh auto;padding:0 20px}h1{font-size:24px;margin:0 0 8px}p{color:#5c5c5c;margin:0 0 20px}button{min-height:44px;padding:0 18px;border:0;border-radius:6px;background:#2b1030;color:#fbf1ea;font:650 14px "Helvetica Neue",Arial,sans-serif;cursor:pointer}button:hover{background:#220c2a}a{color:#2b1030}</style><main><img src="/brand/logo-navy-tm-v36.svg" alt="BIOMOD" width="150" height="49"><h1>${title}</h1>${body}</main></html>`;
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!/^[a-f0-9-]{36}$/.test(token)) return new Response(page('Link not recognized', '<p>Contact <a href="mailto:contact@trybiomod.com">contact@trybiomod.com</a> and we will remove you.</p>'), { status: 400, headers });
  // Viewing the link is read-only, so mail scanners that open links cannot unsubscribe anyone.
  return new Response(page('Stop sale emails', '<p>You will no longer hear about private sales and discounts. Order and shipping updates continue.</p><form method="post"><button type="submit">Unsubscribe</button></form>'), { headers });
}
export async function POST(request: Request) {
  const ok = await emailOfferUnsubscribe(runtime().DB, new URL(request.url).searchParams.get('token') || '', Date.now());
  return new Response(ok ? page('You are unsubscribed', '<p>We will not send you sale emails again. <a href="/">Back to the store</a></p>') : page('Link not recognized', '<p>Contact <a href="mailto:contact@trybiomod.com">contact@trybiomod.com</a> and we will remove you.</p>'), { status: ok ? 200 : 400, headers });
}
