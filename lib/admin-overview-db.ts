// Full-history overview aggregates. No fixed history window or all-orders buffer.
import { orderQueueCte, readAllOrderWork } from './order-queue-db';
import { COA_REQUIRED_TO_SHIP, hasCoa } from './coa-shipping';
import type { Product } from './catalog';
import type { OverviewOrderSummary, SalesCohort } from './admin-overview';
import { overviewSalesPeriods } from './admin-overview';
import type { ReportOptionsInput } from './report-window';

const empty = (): SalesCohort => ({ orders: 0, paymentRecorded: 0, grossCents: 0, missingPaymentRecords: 0 });

export async function readAdminOverviewOrderSummary(db: D1Database, products: Product[], now = Date.now(), options: ReportOptionsInput = {}): Promise<OverviewOrderSummary> {
    const windows = overviewSalesPeriods(now, options);
    const summary: OverviewOrderSummary = { toShip: { count: 0, oldest: now, labels: 0, coaBlocked: 0 }, review: 0, backorder: { count: 0, oldest: now }, sales: [], coaProductIds: [] };
    const work = (await db.prepare(`${orderQueueCte(now)} SELECT work,count(*) count,min(created) oldest,
        sum(CASE WHEN json_extract(data,'$.shipment') IS NOT NULL THEN 1 ELSE 0 END) labels
        FROM queues WHERE archived=0 AND status IN ('paid','labeling','shipped','delivered') AND work IN ('to_ship','review','backorder') GROUP BY work`)
        .all<{work: string; count: number; oldest: number; labels: number}>()).results || [];
    for (const row of work) {
        if (row.work === 'to_ship') Object.assign(summary.toShip, { count: row.count, oldest: row.oldest, labels: row.labels });
        else if (row.work === 'review') summary.review = row.count;
        else if (row.work === 'backorder') summary.backorder = { count: row.count, oldest: row.oldest };
    }
    // This rule is currently off. If enabled, walk only packing work in bounded pages and keep
    // product IDs, never customer rows. The ordinary path is two small aggregate queries.
    if (COA_REQUIRED_TO_SHIP) {
        const blockedProducts = new Set<number>(), byId = new Map(products.map(p => [p.id, p]));
        for await (const page of readAllOrderWork(db, now, 'to_ship')) for (const order of page) {
            let blocked = false;
            for (const item of Array.isArray(order.data?.items) ? order.data.items : []) {
                const id = Number(item?.id ?? item?.product?.id);
                if (!hasCoa(byId.get(id))) { blocked = true; if (Number.isSafeInteger(id)) blockedProducts.add(id); }
            }
            if (blocked) summary.toShip.coaBlocked++;
        }
        summary.coaProductIds = [...blockedProducts];
    }

    summary.sales = windows.map(w => ({ label: w.label, orders: 0, revenue: 0, live: empty(), sandbox: empty(), unknown: empty() }));
    const validPayment = "typeof(payment_ref)='text' AND length(trim(payment_ref))>0 AND typeof(notification_id)='text' AND length(trim(notification_id))>0";
    const rows = (await db.prepare(`WITH windows(position,start,end) AS (VALUES ${windows.map((_,index)=>`(${index},?,?)`).join(',')}),
        source AS (SELECT created,status,total,payment_ref,notification_id,CASE WHEN json_valid(data) THEN data ELSE '{}' END data FROM orders),
        sales AS (SELECT position,total,payment_ref,notification_id,
            CASE WHEN json_extract(data,'$.environment') IN ('live','authorizenet:live') THEN 'live'
                 WHEN json_extract(data,'$.environment') IN ('sandbox','authorizenet:sandbox') THEN 'sandbox' ELSE 'unknown' END cohort
            FROM source JOIN windows ON created>=start AND created<end
            WHERE status IN ('paid','labeling','shipped','delivered') AND coalesce(json_extract(data,'$.internalTest'),0)=0
              AND typeof(created)='integer' AND created BETWEEN -9007199254740991 AND 9007199254740991)
        SELECT position,cohort,count(*) orders,
            sum(CASE WHEN ${validPayment} THEN 1 ELSE 0 END) paymentRecorded,
            sum(CASE WHEN ${validPayment} AND typeof(total)='integer' AND total BETWEEN 0 AND 9007199254740991 THEN total ELSE 0 END) grossCents
        FROM sales GROUP BY position,cohort`)
        .bind(...windows.flatMap(w => [w.from, w.end])).all<{position: number; cohort: 'live' | 'sandbox' | 'unknown'; orders: number; paymentRecorded: number; grossCents: number}>()).results || [];
    for (const row of rows) summary.sales[row.position][row.cohort] = { orders: row.orders, paymentRecorded: row.paymentRecorded, grossCents: row.grossCents, missingPaymentRecords: row.orders - row.paymentRecorded };
    for (const window of summary.sales) { window.orders = window.live.paymentRecorded; window.revenue = window.live.grossCents; }
    return summary;
}
