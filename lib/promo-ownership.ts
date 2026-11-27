import { readPartners } from './restaurant-partners';

export type PromoOwner = { kind: 'business' | 'affiliate'; label: string; href: string };
/** Derived from actual owning records, including retired business codes and pending partner offers. */
export async function promoOwners(db: D1Database): Promise<Record<string, PromoOwner>> {
    const owners: Record<string, PromoOwner> = {};
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('affiliate_members','affiliate_invitations','affiliate_schedules','affiliate_schedule_state')").bind().all<{ name: string }>()).results;
    const has = (name: string) => tables.some(table => table.name === name);
    if (has('affiliate_members')) {
        for (const row of (await db.prepare('SELECT code,name FROM affiliate_members WHERE code IS NOT NULL').bind().all<{ code: string; name: string }>()).results)
            owners[row.code] = { kind: 'affiliate', label: row.name || 'Affiliate partner', href: '/admin?tab=affiliates' };
    }
    if (has('affiliate_invitations')) {
        for (const row of (await db.prepare('SELECT code,name FROM affiliate_invitations WHERE code IS NOT NULL').bind().all<{ code: string; name: string }>()).results)
            owners[row.code] ||= { kind: 'affiliate', label: row.name || 'Affiliate invitation', href: '/admin?tab=affiliates' };
    }
    if (has('affiliate_schedules') && has('affiliate_schedule_state')) {
        for (const row of (await db.prepare('SELECT f.code FROM affiliate_schedule_state s JOIN affiliate_schedules f ON f.id=s.schedule_id WHERE f.code IS NOT NULL').bind().all<{ code: string }>()).results)
            owners[row.code] ||= { kind: 'affiliate', label: 'Current affiliate offer', href: '/admin?tab=affiliates' };
    }
    for (const slot of (await readPartners(db)).rows) {
        for (const code of [slot.code, ...slot.previous].filter(Boolean))
            owners[code] = { kind: 'business', label: slot.name || `Business slot ${slot.slot}`, href: '/admin?tab=restaurants' };
    }
    return owners;
}
