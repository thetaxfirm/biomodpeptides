// What the store knows about a customer, handed to the AI reply writer so a draft never guesses
// about orders (owner, Oct 24 2026: a draft told a partner "we don't see your order" while his
// order sat in review), plus the VIP signal for partners and business buyers.
// Order states are worded for staff understanding only. The writer is told never to mention a
// declined card, a failed payment or a review status to the customer.

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'verizon.net', 'cox.net', 'mail.com', 'gmx.com', 'gmx.us', 'zoho.com']);
const VIP_WORDS = /\b(partner(ship)?s?|wholesale|distribut\w*|bulk|reseller|white[ -]?label|private[ -]?label|co-?brand\w*|expo|olympia|trade ?show|booth|met (you|jeff|logan|ash|chris)|gyms?|clinics?|pharmac\w+|retail\w*|stockists?|ceo|founder|owner of)\b/i;

export type VipSignal = { vip: boolean; why: string };

/** A partner, distributor, business buyer or someone met at a show. */
export function vipSignal(email: string, text: string): VipSignal {
    const domain = String(email || '').toLowerCase().split('@')[1] || '';
    const reasons: string[] = [];
    if (domain && !FREE_MAIL.has(domain)) reasons.push('company email (' + domain + ')');
    const word = String(text || '').match(VIP_WORDS)?.[0];
    if (word) reasons.push('mentions "' + word.toLowerCase() + '"');
    return { vip: reasons.length > 0, why: reasons.join(', ') };
}

const STATUS_WORDS: Record<string, string> = {
    awaiting_payment: 'saved, checkout not finished',
    pending: 'saved, checkout not finished',
    review: 'saved, payment not completed on the site (handle it for them personally)',
    paid: 'paid, being prepared',
    shipped: 'shipped',
    delivered: 'delivered',
    cancelled: 'cancelled',
    refunded: 'refunded',
};

type OrderRow = { id: string; status: string; total: number; created: number; data: string };
type Database = { prepare: (sql: string) => { bind: (...values: unknown[]) => { all: <T>() => Promise<{ results: T[] }> } } };

export type CustomerContext = { vip: boolean; vipWhy?: string; orders: { number: string; placed: string; status: string; items: string; total: string }[] };

export function orderSummary(row: OrderRow): CustomerContext['orders'][number] {
    let data: any = {};
    try { data = JSON.parse(row.data); } catch { data = {}; }
    const items = Array.isArray(data.items) ? data.items.slice(0, 12).map((i: any) => String(i?.product?.name || 'item') + (Number(i?.quantity) > 1 ? ' x' + Number(i.quantity) : '')).join(', ') : '';
    const city = data.address && typeof data.address === 'object' ? [data.address.city, data.address.state].filter(Boolean).join(', ') : '';
    return {
        number: String(row.id).slice(0, 8).toUpperCase(),
        placed: new Date(row.created).toISOString().slice(0, 10),
        status: STATUS_WORDS[row.status] || row.status,
        items: (items || 'items not listed') + (city ? '; ships to ' + city : ''),
        total: '$' + (Number(row.total) / 100).toFixed(2),
    };
}

export async function customerContext(db: Database, email: string, message: string): Promise<CustomerContext> {
    const signal = vipSignal(email, message);
    const address = String(email || '').toLowerCase();
    const rows = address
        ? (await db.prepare("SELECT id,status,total,created,data FROM orders WHERE lower(json_extract(data,'$.email'))=? ORDER BY created DESC LIMIT 5").bind(address).all<OrderRow>()).results
        : [];
    return { vip: signal.vip, ...(signal.vip ? { vipWhy: signal.why } : {}), orders: rows.map(orderSummary) };
}
