import type { Product } from './catalog';

/** Real end time only. A reload never restarts an offer. */
export function saleRemaining(ends: string, now: number) {
    const end = Date.parse(ends);
    if (!Number.isFinite(end) || !Number.isFinite(now)) return null;
    const seconds = Math.max(0, Math.ceil((end - now) / 1000));
    return { expired: seconds === 0, days: Math.floor(seconds / 86400), hours: Math.floor(seconds / 3600) % 24, minutes: Math.floor(seconds / 60) % 60, seconds: seconds % 60 };
}
export function nextSaleBoundary(products: Product[], now: number) {
    const times = products.flatMap(p => p.sale?.enabled && !p.preorder?.enabled ? [Date.parse(p.sale.starts), Date.parse(p.sale.ends)] : []).filter(t => Number.isFinite(t) && t > now);
    return times.length ? Math.min(...times) : null;
}
