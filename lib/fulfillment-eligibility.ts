// One rule for manual actions, automation and atomic database claims.
import { paymentVerificationFailed, preorderAwaitingRelease, type FulfillmentOrder } from './fulfillment';

export function fulfillmentBlock(order: FulfillmentOrder): string | null {
    if (order.data?.internalTest) return 'Internal test orders cannot be fulfilled.';
    if (!['paid', 'shipped', 'delivered'].includes(order.status)) return 'Only paid orders may be fulfilled.';
    if (paymentVerificationFailed(order)) return 'Recheck the payment verification before fulfilling this order.';
    if (order.data?.hold) return 'Clear the order hold after resolving the problem.';
    if (preorderAwaitingRelease(order.data)) return 'Confirm preorder stock is ready before releasing this order for packing.';
    return null;
}

// Trusted SQL fragments only. Never interpolate user input into these expressions.
export const numericJson = (path: string) => `json_type(data,'${path}') IN ('integer','real')`;
export const hasPreorderSql = `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(data,'$.items')='array' THEN json_extract(data,'$.items') ELSE '[]' END) item
    WHERE json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.product.activePreorder.percentOff') IN ('integer','real')
      AND json_extract(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.product.activePreorder.percentOff') > 0 AND json_extract(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.product.activePreorder.percentOff') < 100
      AND json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.product.activePreorder.ships')='text' AND length(trim(json_extract(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.product.activePreorder.ships'))) BETWEEN 1 AND 120
      AND length(json_extract(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.product.activePreorder.ships'))<=120
      AND json_type(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.product.activePreorder.basePrice')='integer' AND json_extract(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.product.activePreorder.basePrice') BETWEEN 1 AND 9007199254740991)`;
export const preorderReleasedSql = `(${numericJson('$.preorderRelease.at')} AND json_extract(data,'$.preorderRelease.at')>0
    AND json_type(data,'$.preorderRelease.by')='text' AND length(trim(json_extract(data,'$.preorderRelease.by')))>0
    AND json_type(data,'$.preorderRelease.note')='text' AND length(trim(json_extract(data,'$.preorderRelease.note')))>0)`;
export const waitingPreorderSql = `(${hasPreorderSql} AND NOT coalesce(${preorderReleasedSql},0))`;
export const failedPaymentSql = `(${numericJson('$.paymentVerified.at')} AND json_extract(data,'$.paymentVerified.state')='failed')`;
export const fulfillmentEligibleSql = `coalesce(json_extract(data,'$.internalTest'),0)=0
    AND NOT coalesce(${failedPaymentSql},0) AND json_extract(data,'$.hold') IS NULL
    AND NOT ${waitingPreorderSql}`;
export const labelClaimSql = `UPDATE orders SET status='labeling',updated=? WHERE id=? AND status='paid'
    AND json_extract(data,'$.shipment') IS NULL AND ${fulfillmentEligibleSql} AND data=?`;
