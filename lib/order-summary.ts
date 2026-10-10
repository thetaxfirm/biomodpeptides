import { presentationText } from './private-presentation';
import type { AnetOrderDetails } from './authorizenet-payments';
// One readable summary of a saved order, shared by the admin Orders tab, the Authorize.net receipt and the store's order email.
type Environment = Record<string, string | undefined>;
export type SummaryItem = { id: string | number; name: string; detail: string; quantity: number; unitCents: number | null; lineTotalCents: number };
const int = (v: unknown) => Number.isSafeInteger(v) ? v as number : 0;
const money = (c: number) => (c < 0 ? '-$' : '$') + (Math.abs(c) / 100).toFixed(2);
export function itemDetail(item: Record<string, any>): string {
    const parts: string[] = [];
    if (item.packSize)
        parts.push((item.packKind === 'fixed' ? 'Fixed ' : 'Mixed ') + item.packSize + '-pack');
    if (item.presaleId)
        parts.push('Presale');
    return parts.join(', ');
}
export function summaryItems(data: Record<string, any>): SummaryItem[] {
    return (Array.isArray(data.items) ? data.items : []).map((item: any) => ({
        id: item.id,
        name: presentationText(String(item.product?.name || 'Product ' + item.id)),
        detail: itemDetail(item),
        quantity: int(item.quantity),
        unitCents: Number.isSafeInteger(item.product?.price) ? item.product.price : null,
        lineTotalCents: int(item.lineTotal),
    }));
}
export function anetOrderDetails(data: Record<string, any>): AnetOrderDetails {
    const promo = data.promo?.code ? 'Promo ' + String(data.promo.code) + (int(data.promo.savings) ? ' saved ' + money(int(data.promo.savings)) : '') : '';
    return {
        items: summaryItems(data).map(i => ({ id: i.id, name: i.name, detail: i.detail, quantity: i.quantity, lineTotalCents: i.lineTotalCents })),
        taxCents: int(data.tax),
        shippingCents: int(data.shipping),
        shippingName: data.shippingService ? String(data.shippingService) : 'Shipping',
        note: promo,
    };
}
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
/** Store copy of a paid order, with every item, for the addresses in STORE_ADMIN_EMAILS (or ORDER_NOTIFY_EMAILS). */
export function orderEmailHtml(orderId: string, data: Record<string, any>): string {
    const a = data.address || {};
    const row = (label: string, value: string, bold = false) => '<tr><td style="padding:4px 0;color:#5c5c5c">' + label + '</td><td style="padding:4px 0;text-align:right' + (bold ? ';font-weight:bold' : '') + '">' + value + '</td></tr>';
    const items = summaryItems(data).map(i => '<tr><td style="padding:8px 0;border-bottom:1px solid #eee">' + esc(i.name) + (i.detail ? '<br><span style="font-size:12px;color:#5c5c5c">' + esc(i.detail) + '</span>' : '') + '</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">' + i.quantity + '</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">' + money(i.lineTotalCents) + '</td></tr>').join('');
    return '<div style="background:#fbf1ea;padding:24px 16px"><div style="font-family:Arial,sans-serif;color:#141414;max-width:560px;margin:0 auto;background:#fff;border:1px solid #e9d9ef;border-radius:8px;overflow:hidden">'
        + '<div style="background:#2b1030;color:#fbf1ea;padding:16px 20px;font-size:20px;font-weight:bold;letter-spacing:2px">BIOMOD</div><div style="padding:20px">'
        + '<h2 style="margin:0 0 4px;color:#2b1030">New paid order ' + esc(orderId.slice(0, 8)) + '</h2>'
        + '<p style="margin:0 0 16px;color:#5c5c5c">' + esc(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })) + ' (Pacific)</p>'
        + '<table style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="text-align:left;padding-bottom:6px">Item</th><th style="padding-bottom:6px">Qty</th><th style="text-align:right;padding-bottom:6px">Total</th></tr>' + items + '</table>'
        + '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">'
        + row('Subtotal', money(int(data.subtotal)))
        + (int(data.discount) ? row('Discounts' + (data.promo?.code ? ' (promo ' + esc(data.promo.code) + ')' : ''), money(-int(data.discount))) : '')
        + row('Shipping' + (data.shippingService ? ' - ' + esc(data.shippingService) : ''), money(int(data.shipping)))
        + row('Tax', money(int(data.tax)))
        + row('Total paid', money(int(data.total)), true) + '</table>'
        + '<h3 style="margin:20px 0 6px;color:#2b1030">Ship to</h3><p style="margin:0;line-height:1.5">' + esc(a.name) + '<br>' + esc(a.line1) + (a.line2 ? '<br>' + esc(a.line2) : '') + '<br>' + esc(a.city) + ', ' + esc(a.state) + ' ' + esc(a.zip) + '<br>Phone: ' + esc(a.phone) + (data.email ? '<br>Email: ' + esc(data.email) : '') + '</p>'
        + '<p style="margin-top:20px"><a href="https://trybiomod.com/admin" style="display:inline-block;background:#2b1030;color:#fbf1ea;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Open store admin</a></p>'
        + '</div></div></div>';
}
export function orderNotifyRecipients(env: Environment): string[] {
    return (env.ORDER_NOTIFY_EMAILS || env.STORE_ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)).slice(0, 10);
}
/** Sends the store copy of a paid order. Never throws; returns false when email is not configured or Resend refuses it. */
export async function sendOrderNotification(env: Environment, orderId: string, data: Record<string, any>): Promise<boolean> {
    const key = (env.RESEND_API_KEY || '').trim();
    const to = orderNotifyRecipients(env);
    if (!key || !to.length)
        return false;
    const count = summaryItems(data).reduce((s, i) => s + i.quantity, 0);
    try {
        const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: env.ORDER_EMAIL_FROM || 'BIOMOD Orders <no-reply@trybiomod.com>', to, ...(data.email ? { reply_to: String(data.email) } : {}), subject: 'New order ' + orderId.slice(0, 8) + ' - ' + money(int(data.total)) + ' - ' + count + ' item' + (count === 1 ? '' : 's'), html: orderEmailHtml(orderId, data) }),
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
        });
        return r.ok;
    }
    catch {
        return false;
    }
}
