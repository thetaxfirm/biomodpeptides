import { z } from 'zod';
export type PresaleCampaign = { id: string; title: string; starts: string; ends: string; ships: string; productIds: number[]; maxPerCustomer: number; active: boolean | number; archived?: boolean; version: string };
export function presaleStatus(c: Pick<PresaleCampaign, 'active' | 'archived' | 'starts' | 'ends'>, now = Date.now()) {
    if (c.archived) return 'Archived';
    if (!c.active) return 'Disabled';
    if (Date.parse(c.ends) <= now) return 'Ended';
    if (Date.parse(c.starts) > now) return 'Upcoming';
    return 'Open';
}
async function version(data: string, active: number) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([data, active])));
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
export async function listPresaleCampaigns(db: D1Database): Promise<PresaleCampaign[]> {
    const rows = (await db.prepare('SELECT id,data,active FROM campaigns').all<{ id: string; data: string; active: number }>()).results;
    return Promise.all(rows.map(async row => ({ ...JSON.parse(row.data), id: row.id, active: Boolean(row.active), version: await version(row.data, row.active) })));
}
export class CampaignConflict extends Error { readonly status = 409; constructor() { super('This campaign changed since you loaded it. Refresh administration and review the current dates and products.'); } }
/** db carries the staff audit context. Historic order snapshots are never changed. */
export async function savePresaleCampaign(db: D1Database, raw: unknown, productIds: number[]) {
    const input = z.object({ id: z.string().regex(/^[a-zA-Z0-9-]{1,60}$/).optional(), version: z.string().optional(), title: z.string().trim().min(2).max(100), starts: z.string().datetime(), ends: z.string().datetime(), ships: z.string().trim().min(2).max(100), productIds: z.array(z.number().int()).min(1), maxPerCustomer: z.number().int().min(1).max(100), active: z.boolean().optional(), archived: z.boolean().optional() }).parse(raw);
    if (!input.archived && !input.productIds.every(id => productIds.includes(id))) throw new Error('Choose products from the current catalog.');
    if (Date.parse(input.ends) <= Date.parse(input.starts)) throw new Error('Closing date must follow opening date.');
    const { id: suppliedId, version: expected, active, ...data } = input;
    const id = suppliedId || crypto.randomUUID();
    const before = suppliedId ? await db.prepare('SELECT data,active FROM campaigns WHERE id=?').bind(id).first<{ data: string; active: number }>() : null;
    if (suppliedId && (!before || expected !== await version(before.data, before.active))) throw new CampaignConflict();
    const next = JSON.stringify(data), enabled = active && !data.archived ? 1 : 0;
    const written = before
        ? await db.prepare('UPDATE campaigns SET data=?,active=? WHERE id=? AND data=? AND active=?').bind(next, enabled, id, before.data, before.active).run()
        : await db.prepare('INSERT INTO campaigns(id,data,active) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(id, next, enabled).run();
    if (!written.meta.changes) throw new CampaignConflict();
    return { id, message: data.archived ? 'Campaign archived. Existing orders keep their saved terms.' : 'Presale saved. Existing orders keep their saved terms.' };
}
