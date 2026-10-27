// New-order alerts into a Telegram group. Free, instant, and a real push notification on every
// owner's phone, which is what carrier texts and email-to-SMS gateways stopped being (owner, Oct 20 2026).
//
// Two settings rows, both editable under Settings so neither needs a deployment:
//   telegram_bot_token_v1 - the bot's credential. Written but never read back to any browser.
//   telegram_chat_ids_v1  - the groups to post into, one id per entry.
type Environment = { DB?: D1Database } & Record<string, any>;

export const TELEGRAM_TOKEN_KEY = 'telegram_bot_token_v1';
export const TELEGRAM_CHATS_KEY = 'telegram_chat_ids_v1';
const API = 'https://api.telegram.org/bot';

/** What BotFather hands out: a numeric id, a colon, then the secret. Anything else is a typo. */
export const validBotToken = (value: unknown): string => {
    const token = String(value ?? '').trim();
    return /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/.test(token) ? token : '';
};
/** Telegram chat ids are integers. A group is negative; a supergroup starts -100. At most ten. */
export const cleanChatIds = (value: unknown): string[] => {
    const list = String(value ?? '').split(/[,;\s]+/).map(s => s.trim()).filter(s => /^-?\d{1,20}$/.test(s));
    return [...new Set(list)].slice(0, 10);
};

export async function readTelegramConfig(env: Environment): Promise<{ token: string; chats: string[] }> {
    try {
        const rows = await env.DB?.prepare(`SELECT key,value FROM settings WHERE key IN ('${TELEGRAM_TOKEN_KEY}','${TELEGRAM_CHATS_KEY}')`).all<{ key: string; value: string }>();
        const byKey = Object.fromEntries((rows?.results || []).map(r => [r.key, r.value]));
        return { token: validBotToken(byKey[TELEGRAM_TOKEN_KEY]), chats: cleanChatIds(byKey[TELEGRAM_CHATS_KEY]) };
    } catch { return { token: '', chats: [] }; }
}

/**
 * What a new order says on a lock screen. Deliberately thin: who, where, how many and how much.
 * No product names ever, because this notification is readable by anyone holding the phone and the
 * catalogue is nobody else's business.
 */
export function orderPushText(orderId: string, data: Record<string, any>): string {
    const money = (c: unknown) => '$' + ((Number.isSafeInteger(c) ? c as number : 0) / 100).toFixed(2);
    const items = (Array.isArray(data.items) ? data.items : []).reduce((n: number, i: any) => n + (Number(i?.quantity) || 0), 0);
    const where = [data.address?.city, data.address?.state].filter(Boolean).join(', ');
    const who = String(data.address?.name || '').slice(0, 60);
    return ['New order #' + orderId.slice(0, 8).toUpperCase(),
        [who, where].filter(Boolean).join(' - '),
        items + (items === 1 ? ' item' : ' items') + ' - ' + money(data.total),
        'https://trybiomod.com/admin?tab=orders'].filter(Boolean).join('\n');
}

/**
 * One message to one chat. Never throws, never retries: an order must not wait on a chat app.
 *
 * Telegram explains every refusal in the body ("bot was kicked from the group chat", "chat not
 * found", "not enough rights to send text messages"). Throwing that away left the admin saying only
 * that something failed, which is useless to whoever has to fix it (owner, Oct 20 2026).
 */
async function post(token: string, chat: string, text: string, send: typeof fetch): Promise<{ ok: boolean; why: string }> {
    try {
        const response = await send(API + token + '/sendMessage', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
            redirect: 'manual', signal: AbortSignal.timeout(8000),
        });
        if (response.ok) return { ok: true, why: '' };
        const body = await response.json().catch(() => null) as { description?: unknown } | null;
        const why = typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : 'Telegram replied ' + response.status;
        return { ok: false, why: why.slice(0, 200) };
    } catch { return { ok: false, why: 'Telegram could not be reached.' }; }
}

/**
 * Posts a new paid order to every configured chat. Returns how many landed, so the admin can say
 * something true rather than claiming delivery. Not configured is zero, not an error.
 */
export async function sendOrderPush(env: Environment, orderId: string, data: Record<string, any>, deps: { fetch?: typeof fetch } = {}): Promise<number> {
    return sendTelegramText(env, orderPushText(orderId, data), deps);
}

/**
 * Any one message to every configured chat: the new-order alert above, and the daily line about
 * orders that have stopped moving. Returns how many landed, so a caller can say something true
 * rather than claiming delivery. Not configured is zero, not an error, and an empty message is
 * never posted — a blank push would be a notification that says nothing.
 */
export async function sendTelegramText(env: Environment, text: string, deps: { fetch?: typeof fetch } = {}): Promise<number> {
    const message = String(text ?? '').trim();
    const { token, chats } = await readTelegramConfig(env);
    if (!token || !chats.length || !message) return 0;
    const results = await Promise.all(chats.map(chat => post(token, chat, message, deps.fetch || fetch)));
    return results.filter(r => r.ok).length;
}
