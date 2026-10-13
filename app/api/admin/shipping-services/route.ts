import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth';
import { auditRun, recordChange, type AuditActor } from '@/lib/change-history';
import { config } from '@/lib/commerce';
import { easypostReady, liveShippingCheck, ShippingError, type ShipAddress, type ShipItem } from '@/lib/easypost';
import { normalizeShippingOptions, shippingServiceCatalog, type ShippingServiceSetting } from '@/lib/shipping-options';
import { database, runtime } from '@/lib/runtime';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

// Public landmark addresses used only to ask the carriers for prices. Nothing is shipped or bought.
const sampleDestinations: Record<string, ShipAddress & { title: string }> = {
    ny: { title: 'New York, NY 10118', name: 'Rate check', line1: '350 5th Ave', city: 'New York', state: 'NY', zip: '10118' },
    la: { title: 'Los Angeles, CA 90012', name: 'Rate check', line1: '200 N Spring St', city: 'Los Angeles', state: 'CA', zip: '90012' },
    chi: { title: 'Chicago, IL 60602', name: 'Rate check', line1: '121 N LaSalle St', city: 'Chicago', state: 'IL', zip: '60602' },
    mia: { title: 'Miami, FL 33133', name: 'Rate check', line1: '3500 Pan American Dr', city: 'Miami', state: 'FL', zip: '33133' },
    lv: { title: 'Las Vegas, NV 89101', name: 'Rate check', line1: '495 S Main St', city: 'Las Vegas', state: 'NV', zip: '89101' },
};
const vial = { categories: [{ slug: 'research-compounds' }] }, bottle = { categories: [{ slug: 'softgels' }] };
const samplePackages: Record<string, { title: string; items: ShipItem[] }> = {
    v1: { title: '1 vial', items: [{ quantity: 1, product: vial }] },
    v3: { title: '3 vials', items: [{ quantity: 3, product: vial }] },
    v10: { title: '10 vials', items: [{ quantity: 10, product: vial }] },
    b1: { title: '1 bottle', items: [{ quantity: 1, product: bottle }] },
    b3: { title: '3 bottles', items: [{ quantity: 3, product: bottle }] },
};
const sampleSchema = z.object({ destination: z.enum(Object.keys(sampleDestinations) as [string, ...string[]]).default('ny'), sample: z.enum(Object.keys(samplePackages) as [string, ...string[]]).default('v3') });
const serviceSchema = z.object({ key: z.string().regex(/^(USPS|UPS|FedEx):[A-Z0-9]{1,60}$/), enabled: z.boolean(), markupCents: z.number().int().min(0).max(100000), label: z.string().trim().min(1, 'Every offered service needs a customer name.').max(80), note: z.string().trim().max(160) }).strict();
const saveSchema = z.object({
    services: z.array(serviceSchema).max(60).refine(list => new Set(list.map(s => s.key)).size === list.length, 'A service is listed twice.'),
    freeStandardEnabled: z.boolean(), freeShippingAt: z.number().int().min(0).max(1000000), shippingCents: z.number().int().min(0).max(100000).nullable(),
}).strict();

async function runCheck(sample: z.infer<typeof sampleSchema>) {
    const env = runtime();
    if (!easypostReady(env)) return { ok: false, error: 'EasyPost is not connected, so live carrier prices cannot be checked.' };
    const settings = (await config()).shippingOptions;
    try {
        const result = await liveShippingCheck(env, sampleDestinations[sample.destination], samplePackages[sample.sample].items, settings);
        return { ok: true, destination: sampleDestinations[sample.destination].title, package: samplePackages[sample.sample].title, ...result };
    } catch (e) {
        return { ok: false, error: e instanceof ShippingError ? e.message : 'The carriers could not be reached. Try again in a minute.' };
    }
}
const dollars = (c: number) => '$' + (c / 100).toFixed(2);
function describe(before: ShippingServiceSetting[] | undefined, after: ShippingServiceSetting[]) {
    const lines: string[] = [];
    for (const s of after) {
        const old = before?.find(b => b.key === s.key);
        if (!old ? s.enabled : old.enabled !== s.enabled) lines.push((s.enabled ? 'Turned on ' : 'Turned off ') + s.label);
        if (s.enabled && old && old.markupCents !== s.markupCents) lines.push(s.label + ' extra ' + dollars(old.markupCents) + ' to ' + dollars(s.markupCents));
        if (s.enabled && old && (old.label !== s.label || old.note !== s.note)) lines.push(s.label + ' wording changed');
    }
    return lines.join('; ') || 'Shipping services saved without price or visibility changes';
}

export async function GET() {
    try { await requireStaff('store:write'); }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }
    const current = await config();
    return j({
        catalog: shippingServiceCatalog, settings: current.shippingOptions, freeShippingAt: current.freeShippingAt, shippingCents: current.shippingCents,
        connected: easypostReady(runtime()),
        destinations: Object.entries(sampleDestinations).map(([id, d]) => ({ id, title: d.title })),
        packages: Object.entries(samplePackages).map(([id, p]) => ({ id, title: p.title })),
    });
}

export async function POST(req: NextRequest) {
    if (req.headers.get('origin') !== req.nextUrl.origin) return j({ error: 'Please refresh the page and try again.' }, 403);
    let actor;
    try { actor = await requireStaff('store:write'); }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sample = sampleSchema.safeParse({ destination: body.destination, sample: body.sample });
    if (!sample.success) return j({ error: 'Choose a sample address and package.' }, 400);
    if (body.action === 'check') return j({ check: await runCheck(sample.data) });
    if (body.action !== 'save') return j({ error: 'Unknown request.' }, 400);
    const parsed = saveSchema.safeParse(body.settings);
    if (!parsed.success) return j({ error: parsed.error.issues[0]?.message || 'Check the shipping settings and try again.' }, 400);
    const next = parsed.data;
    const current = await config();
    const shippingOptions = { ...current.shippingOptions, freeStandardEnabled: next.freeStandardEnabled, services: next.services };
    const nextConfig = { ...current, freeShippingAt: next.freeShippingAt, shippingCents: next.shippingCents, shippingOptions };
    const auditActor: AuditActor = { source: 'admin', actor: actor.email, actorType: 'staff', action: 'admin-shipping-services' };
    await auditRun(database(), auditActor, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'store', JSON.stringify(nextConfig));
    try {
        await recordChange(database(), { source: 'admin', actor: actor.email, actorType: 'staff', action: 'shipping.services', entityType: 'setting', entityId: 'store.shipping', summary: describe(current.shippingOptions.services, next.services).slice(0, 1000), status: 'succeeded', changes: [] });
    } catch { /* The settings write is already audited; the summary is a convenience. */ }
    // Double check: read the saved settings back and compare them with what was submitted.
    const saved = await config();
    const expected = normalizeShippingOptions(shippingOptions);
    const savedMatches = JSON.stringify(saved.shippingOptions.services) === JSON.stringify(expected.services)
        && saved.freeShippingAt === next.freeShippingAt && saved.shippingCents === next.shippingCents && saved.shippingOptions.freeStandardEnabled === next.freeStandardEnabled;
    return j({ message: 'Shipping saved.', savedMatches, settings: saved.shippingOptions, freeShippingAt: saved.freeShippingAt, shippingCents: saved.shippingCents, check: await runCheck(sample.data) });
}
