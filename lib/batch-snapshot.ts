import type { Product } from './catalog';
export type SoldBatch = { lot: string | null; reportId: string | null; certificateLot: string | null; coaAvailable: boolean };
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]/.test(v) ? v : null;
export function savedBatch(value: unknown): SoldBatch | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.coaAvailable !== 'boolean') return null;
    return { lot: text(v.lot, 100), reportId: text(v.reportId, 150), certificateLot: text(v.certificateLot, 100), coaAvailable: v.coaAvailable };
}
export function batchSnapshot(product: Product): SoldBatch {
    const r = product.resolvedBatch;
    return { lot: text(r?.product_lot, 100), reportId: text(r?.certificate?.report_id || r?.report_id, 150), certificateLot: text(r?.certificate_lot || (r?.coa_on_request ? r?.product_lot : null), 100), coaAvailable: r?.coa_available === true };
}
