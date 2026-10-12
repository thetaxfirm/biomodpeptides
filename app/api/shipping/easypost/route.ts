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
    let event: { description?: unknown; created_at?: unknown; result?: { object?: unknown; tracking_code?: unknown; status?: unknown; mode?: unknown; shipment_id?: unknown; public_url?: unknown } };
    try {
        event = JSON.parse(raw);
    }
    catch {
        return reply(400);
    }
    const t = event.result;
    if (event.description !== 'tracker.updated' || t?.object !== 'Tracker' || t.mode !== 'production' || typeof t.tracking_code !== 'string' || typeof t.status !== 'string')
        return reply(200);
    const observed = typeof event.created_at === 'string' ? Date.parse(event.created_at) : NaN;
    if (!Number.isFinite(observed) || observed > Date.now() + 300000) return reply(200);
    const code = t.tracking_code.slice(0, 60);
    const status = t.status;
    if (!['unknown','pre_transit','in_transit','out_for_delivery','available_for_pickup','delivered','return_to_sender','failure','cancelled','error'].includes(status) || typeof t.shipment_id !== 'string') return reply(200);
    try {
        // Record the latest carrier status on the order, and mark it delivered when the carrier says so.
        await run("UPDATE orders SET data=json_set(data,'$.shipment.status',?,'$.shipment.checkedAt',?),status=CASE WHEN ?='delivered' AND status IN ('paid','shipped') THEN 'delivered' WHEN ? IN ('in_transit','out_for_delivery','available_for_pickup') AND status='paid' THEN 'shipped' ELSE status END,updated=? WHERE json_extract(data,'$.shipment.tracking')=? AND json_extract(data,'$.shipment.shipmentId')=? AND coalesce(json_extract(data,'$.shipment.checkedAt'),0)<=?", status, observed, status, status, timestamp(), code, t.shipment_id, observed);
        return reply(200);
    }
    catch {
        return reply(500);
    }
}
