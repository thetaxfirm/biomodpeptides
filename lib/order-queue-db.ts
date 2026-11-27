// Database-backed queues: filter and count the complete history before paging.
import { queueTabs, requestedTab, cleanQuery, type QueueResult, type QueueOrder, type QueueRow } from './order-queue';
import { STALLED_LABEL_MS, STUCK_IN_TRANSIT_MS } from './fulfillment';
import { failedPaymentSql, waitingPreorderSql, numericJson } from './fulfillment-eligibility';
import { shipDue } from './ship-cutoff';

type Row = Omit<QueueRow, 'data'> & { data: string; work: string };
export async function orderDataVersion(data: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
const decode = (row: Row): QueueRow => ({ ...row, data: JSON.parse(row.data) });
const carrier = `coalesce(json_extract(data,'$.shipment.status'),'')`;
const moving = `${carrier} IN ('in_transit','out_for_delivery','available_for_pickup')`;
const problems = `${carrier} IN ('return_to_sender','failure','cancelled','error')`;
const shipment = `json_extract(data,'$.shipment') IS NOT NULL`;
const approval = `(json_extract(data,'$.labelApproval') IS NOT NULL AND NOT (${shipment}))`;
const hold = `json_extract(data,'$.hold') IS NOT NULL`;
export function orderQueueCte(now = Date.now()): string {
    const time = Math.floor(Number.isFinite(now) ? now : Date.now());
    return `WITH source AS (SELECT id,owner,status,total,created,CASE WHEN json_valid(data) THEN CASE WHEN json_type(data)='object' THEN data ELSE '{}' END ELSE '{}' END data FROM orders),
    bucketed AS (SELECT *, CASE
      WHEN coalesce(json_extract(data,'$.internalTest'),0)<>0 THEN 'test'
      WHEN status IN ('refunded','cancelled','canceled','failed') THEN 'closed'
      WHEN ${problems} THEN 'review'
      WHEN ${carrier}='delivered' OR status='delivered' THEN 'delivered'
      WHEN ${hold} OR ${approval} THEN 'review'
      WHEN ${shipment} AND ${numericJson('$.handoff.at')} AND ${carrier} IN ('','pre_transit','unknown') AND ${time}-json_extract(data,'$.handoff.at')>${STALLED_LABEL_MS} THEN 'review'
      WHEN ${moving} AND ${numericJson('$.shipment.checkedAt')} AND ${time}-json_extract(data,'$.shipment.checkedAt')>${STUCK_IN_TRANSIT_MS} THEN 'review'
      WHEN ${moving} THEN 'shipped'
      WHEN status='labeling' OR (${shipment} AND status IN ('paid','shipped')) THEN 'label'
      WHEN status='shipped' THEN 'shipped'
      WHEN status='paid' THEN 'to_ship'
      WHEN status IN ('creating','awaiting_payment','pending') THEN 'unpaid'
      ELSE 'review' END raw_bucket FROM source),
    accepted AS (SELECT *, CASE WHEN raw_bucket='review' AND NOT (${hold}) AND NOT ${approval} AND ${shipment}
      AND ${numericJson('$.dismissed.at')} AND json_extract(data,'$.dismissed.carrierStatus')=${carrier}
      THEN 'shipped' ELSE raw_bucket END bucket FROM bucketed),
    queues AS (SELECT *, CASE
      WHEN bucket='test' THEN 'test'
      WHEN bucket='closed' THEN CASE WHEN status='cancelled' AND substr(coalesce(json_extract(data,'$.releasedReason'),''),1,15)='unpaid_checkout' THEN 'unpaid'
        WHEN status='refunded' THEN 'refunded' WHEN status='failed' THEN 'failed' ELSE 'cancelled' END
      WHEN ${failedPaymentSql} THEN 'review'
      WHEN NOT (${moving} OR ${problems} OR ${carrier}='delivered' OR status='delivered')
        AND (json_extract(data,'$.hold.issue')='out_of_stock' OR ${waitingPreorderSql}) THEN 'backorder'
      WHEN bucket='review' AND status NOT IN ('paid','labeling','shipped','delivered') THEN 'unpaid'
      WHEN bucket='label' THEN CASE WHEN ${numericJson('$.handoff.at')} THEN 'shipped' ELSE 'to_ship' END
      ELSE bucket END work,
      CASE WHEN ${numericJson('$.archivedAt')} THEN 1 ELSE 0 END archived
      FROM accepted)`;
}
const columns = 'id,owner,status,total,created,data,bucket,work';
const searchTextSql = `lower(id || ' ' || coalesce(json_extract(data,'$.email'),'') || ' ' ||
    coalesce(json_extract(data,'$.address.name'),'') || ' ' || coalesce(json_extract(data,'$.address.phone'),'') || ' ' ||
    coalesce(json_extract(data,'$.address.line1'),'') || ' ' || coalesce(json_extract(data,'$.address.line2'),'') || ' ' ||
    coalesce(json_extract(data,'$.address.city'),'') || ' ' || coalesce(json_extract(data,'$.address.state'),'') || ' ' ||
    coalesce(json_extract(data,'$.address.zip'),'') || ' ' || coalesce(json_extract(data,'$.tracking'),'') || ' ' ||
    coalesce(json_extract(data,'$.shipment.tracking'),'') || ' ' || coalesce(json_extract(data,'$.promo.code'),'') || ' ' ||
    coalesce((SELECT group_concat(json_extract(CASE WHEN item.type='object' THEN item.value ELSE '{}' END,'$.product.name'),' ') FROM json_each(CASE WHEN json_type(data,'$.items')='array' THEN json_extract(data,'$.items') ELSE '[]' END) item),''))`;

/** Bounded-memory traversal for shared operational consumers, with no history cutoff. */
export async function* readAllOrderWork(db: D1Database, now = Date.now(), work?: string): AsyncGenerator<QueueRow[]> {
    const cte = orderQueueCte(now);
    let after: { created: number; id: string } | null = null;
    for (;;) {
        const values: (string | number)[] = [];
        const conditions = ['archived=0'];
        if (work) { conditions.push('work=?'); values.push(work); }
        if (after) { conditions.push('(created>? OR (created=? AND id>?))'); values.push(after.created, after.created, after.id); }
        const rows: Row[] = (await db.prepare(`${cte} SELECT ${columns} FROM queues WHERE ${conditions.join(' AND ')} ORDER BY created,id LIMIT 250`).bind(...values).all<Row>()).results || [];
        if (!rows.length) return;
        yield rows.map(decode);
        const last = rows[rows.length - 1]; after = { created: last.created, id: last.id };
        if (rows.length < 250) return;
    }
}

export async function queryOrderPage(db: D1Database, params: { tab?: unknown; q?: unknown; offset?: unknown; limit?: unknown; id?: unknown }, now = Date.now()): Promise<QueueResult> {
    const cte = orderQueueCte(now), tab = requestedTab(params.tab);
    const limit = Math.min(Math.max(Number.parseInt(String(params.limit ?? 50), 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(String(params.offset ?? 0), 10) || 0, 0);
    const id = typeof params.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(params.id) ? params.id : '';
    const counts = Object.fromEntries(queueTabs.map(t => [t.id, 0])) as QueueResult['counts'];
    const groups = (await db.prepare(`${cte} SELECT work,bucket,archived,count(*) n FROM queues GROUP BY work,bucket,archived`).all<{work: keyof typeof counts; bucket: string; archived: number; n: number}>()).results || [];
    let scanned = 0;
    for (const row of groups) {
        scanned += row.n;
        if (row.archived) counts.archived += row.n;
        else { counts[row.work] += row.n; if (row.bucket !== 'test') counts.all += row.n; }
    }
    const values: (string | number)[] = [];
    let where = id ? 'id=?' : tab === 'archived' ? 'archived=1' : tab === 'all' ? "archived=0 AND bucket<>'test'" : 'archived=0 AND work=?';
    if (id) values.push(id); else if (tab !== 'archived' && tab !== 'all') values.push(tab);
    if (!id) for (const word of cleanQuery(params.q).split(/\s+/).filter(Boolean)) { where += ` AND instr(${searchTextSql},?)>0`; values.push(word); }
    const total = (await db.prepare(`${cte} SELECT count(*) n FROM queues WHERE ${where}`).bind(...values).first<{n: number}>())?.n || 0;
    const rows = (await db.prepare(`${cte} SELECT ${columns} FROM queues WHERE ${where} ORDER BY created ${tab === 'to_ship' ? 'ASC' : 'DESC'},id ${tab === 'to_ship' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<Row>()).results || [];
    const mustGoOut = { today: 0, late: 0 };
    for await (const page of readAllOrderWork(db, now, 'to_ship')) for (const order of page) {
        const due = shipDue(order, now); if (due?.state === 'today') mustGoOut.today++; else if (due?.state === 'late') mustGoOut.late++;
    }
    return { orders: await Promise.all(rows.map(async row => ({ ...decode(row), version: await orderDataVersion(row.data) }))), counts, total, offset, limit, hasMore: offset + rows.length < total, scanned, truncated: false, mustGoOut };
}

/** Complete eligible batch selection. The caller pages only after matching the work queue. */
export async function printableOrders(db: D1Database, kind: 'labels' | 'pick', offset = 0, limit = 100, now = Date.now()) {
    const where = "archived=0 AND work='to_ship'" + (kind === 'labels' ? " AND bucket='label' AND json_type(data,'$.shipment.labelUrl')='text' AND lower(json_extract(data,'$.shipment.labelUrl')) LIKE 'https://%'" : '');
    const cte = orderQueueCte(now);
    const total = (await db.prepare(`${cte} SELECT count(*) n FROM queues WHERE ${where}`).first<{n: number}>())?.n || 0;
    const rows = (await db.prepare(`${cte} SELECT ${columns} FROM queues WHERE ${where} ORDER BY created,id LIMIT ? OFFSET ?`).bind(limit, offset).all<Row>()).results || [];
    return { orders: rows.map(decode), total };
}
