import { NextRequest, NextResponse } from 'next/server';
import { verifyEasypostWebhook } from '@/lib/easypost';
import { run, runtime, timestamp } from '@/lib/runtime';
export const dynamic = 'force-dynamic';
// EasyPost webhook receiver. Register https://trybiomod.com/api/shipping/easypost in EasyPost (Settings -> Webhooks)
// with a webhook secret, and save that secret in Cloudflare as EASYPOST_WEBHOOK_SECRET.
const reply = (status: number) => new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(req: NextRequest) {
    const secret = (runtime().EASYPOST_WEBHOOK_SECRET || '').trim();
    if (!secret)
        return reply(404);
    const raw = await req.text();
    if (raw.length > 200000)
        return reply(413);
    if (!verifyEasypostWebhook(raw, req.headers.get('x-hmac-signature'), secret))
        return reply(401);
    let event: { description?: unknown; result?: { object?: unknown; tracking_code?: unknown; status?: unknown; public_url?: unknown } };
    try {
        event = JSON.parse(raw);
    }
    catch {
        return reply(400);
    }
    const t = event.result;
    if (event.description !== 'tracker.updated' || t?.object !== 'Tracker' || typeof t.tracking_code !== 'string' || typeof t.status !== 'string')
        return reply(200);
    const code = t.tracking_code.slice(0, 60);
    const status = t.status.replace(/[^a-z_]/g, '').slice(0, 30);
    try {
        // Record the latest carrier status on the order, and mark it delivered when the carrier says so.
        await run("UPDATE orders SET data=json_set(data,'$.shipment.status',?),status=CASE WHEN ?='delivered' AND status='shipped' THEN 'delivered' ELSE status END,updated=? WHERE json_extract(data,'$.shipment.tracking')=?", status, status, timestamp(), code);
        return reply(200);
    }
    catch {
        return reply(500);
    }
}
