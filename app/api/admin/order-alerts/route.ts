import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { runtime, timestamp } from '@/lib/runtime';
import { auditRun, recordChange } from '@/lib/change-history';
import { cleanRecipients, orderAlertRecipients, orderNotifyRecipients, ORDER_ALERT_KEY } from '@/lib/order-summary';
import { readTelegramConfig, validBotToken, cleanChatIds, probeTelegram, sendTelegramTest, TELEGRAM_TOKEN_KEY, TELEGRAM_CHATS_KEY } from '@/lib/telegram';
export const dynamic = 'force-dynamic';
const j = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Who gets told about a new paid order, and about the daily parcel digest. Kept out of the store
 * config on purpose: the cron that sends the digest has no request runtime, so this list has to be
 * readable straight from D1 (owner, Oct 20 2026).
 */
export async function GET() {
    try {
        await requireStaff('store:write');
        const env = runtime();
        const saved = await orderAlertRecipients(env as never);
        const fallback = orderNotifyRecipients(env as never);
        // The bot token is a credential: whether one is set is useful, the token itself is not.
        const telegram = await readTelegramConfig(env as never);
        return j({
            recipients: saved, usingFallback: saved.length > 0 && saved.join() === fallback.join() && fallback.length > 0, deployed: fallback,
            telegram: { configured: Boolean(telegram.token), chats: telegram.chats },
        });
    }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }
}

export async function POST(req: NextRequest) {
    if (req.headers.get('origin') !== req.nextUrl.origin)
        return j({ error: 'Please refresh the page and try again.' }, 403);
    let actor;
    try { actor = await requireStaff('store:write'); }
    catch { return j({ error: 'Administrator sign-in required.' }, 403); }
    try {
        const env = runtime();
        const context = { source: 'admin' as const, actor: actor.email, actorType: 'staff' as const };
        const body = await req.json().catch(() => ({})) as { recipients?: unknown; botToken?: unknown; chatIds?: unknown; findChats?: unknown; test?: unknown };

        // Looks up the groups the bot can already see, so nobody reads a chat id out of raw JSON.
        // The token may come from the form before it is saved, and is never written to history.
        if (body.findChats === true) {
            const typed = validBotToken(body.botToken);
            const token = typed || (await readTelegramConfig(env as never)).token;
            if (!token) return j({ error: 'Add the bot token first. BotFather gives it to you when you create the bot.' }, 400);
            const probe = await probeTelegram(token);
            // Each failure gets its own sentence. An empty queue and a rejected token both produce no
            // chats, and saying the wrong one sends the owner looking in entirely the wrong place.
            if (probe.problem === 'unauthorized') return j({ error: 'Telegram rejected this token. If you revoked it in BotFather, paste the replacement it gave you.' }, 400);
            if (probe.problem === 'unreachable') return j({ error: 'Telegram could not be reached just now. Try again in a moment.' }, 502);
            if (probe.problem === 'webhook') return j({ error: 'This bot has a webhook registered, which takes its updates before anything else can read them. Remove the webhook, or use a bot that has none.' }, 409);
            const who = probe.username ? '@' + probe.username : 'The bot';
            return j({ chats: probe.chats, username: probe.username, message: probe.chats.length
                ? probe.chats.length + (probe.chats.length === 1 ? ' chat found.' : ' chats found.') + ' Pick the group you want and save it.'
                : who + ' is live, but Telegram has nothing for it yet. In the group, send ' + (probe.username ? '/start@' + probe.username : '/start') + ' exactly. A bot in a group cannot see ordinary messages, only commands aimed at it. Check the member list names this same bot.' });
        }

        if (body.test === true) {
            const result = await sendTelegramTest(env as never);
            if (!result.configured) return j({ error: 'Save a bot token and at least one chat first.' }, 400);
            // Accepted by Telegram is not the same as read by a person, and the wording says so.
            return j({ message: result.sent
                ? 'Telegram accepted the test for ' + result.sent + ' of ' + result.chats + (result.chats === 1 ? ' chat.' : ' chats.') + ' Check the group to confirm it arrived.'
                : 'Telegram refused the message for every chat. Check the bot is still in the group and the chat id is right.' }, result.sent ? 200 : 502);
        }

        // Telegram settings save on their own so the email list is never disturbed by them.
        if (body.botToken !== undefined || body.chatIds !== undefined) {
            const changed: string[] = [];
            if (body.botToken !== undefined) {
                const raw = String(body.botToken ?? '').trim();
                if (raw && !validBotToken(raw)) return j({ error: 'That does not look like a bot token. BotFather gives you digits, a colon, then a long code.' }, 400);
                await auditRun(env.DB, context, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', TELEGRAM_TOKEN_KEY, validBotToken(raw));
                changed.push(raw ? 'bot token set' : 'bot token cleared');
            }
            if (body.chatIds !== undefined) {
                const chats = cleanChatIds(body.chatIds);
                await auditRun(env.DB, context, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', TELEGRAM_CHATS_KEY, chats.join(','));
                changed.push(chats.length + (chats.length === 1 ? ' chat' : ' chats'));
            }
            try {
                await recordChange(env.DB, {
                    ...context, action: 'store.order_alerts_chat', entityType: 'setting', entityId: TELEGRAM_CHATS_KEY, status: 'succeeded', changes: [],
                    summary: 'Telegram order alerts updated: ' + changed.join(', ') + '.',
                });
            } catch { /* the settings are saved; a missing history row must not suggest otherwise */ }
            const now = await readTelegramConfig(env as never);
            return j({ telegram: { configured: Boolean(now.token), chats: now.chats }, message: 'Telegram settings saved. Use Send a test message to prove it reaches the group.' });
        }

        if (typeof body.recipients !== 'string') return j({ error: 'Send the list as text.' }, 400);
        const recipients = cleanRecipients(body.recipients);
        const dropped = String(body.recipients).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean).length - recipients.length;
        // The addresses themselves are the change, and they are staff contact details rather than a
        // customer's, so the count goes in the history and the list does not.
        await auditRun(env.DB, context, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', ORDER_ALERT_KEY, recipients.join(','));
        try {
            await recordChange(env.DB, {
                ...context, action: 'store.order_alerts', entityType: 'setting', entityId: ORDER_ALERT_KEY, status: 'succeeded', changes: [],
                summary: 'Order alert recipients saved: ' + recipients.length + (recipients.length === 1 ? ' address' : ' addresses') + '.',
            });
        } catch { /* the list is saved; a missing history row must not suggest otherwise */ }
        return j({
            recipients,
            message: recipients.length
                ? recipients.length + (recipients.length === 1 ? ' address' : ' addresses') + ' saved.' + (dropped > 0 ? ' ' + dropped + ' entr' + (dropped === 1 ? 'y was' : 'ies were') + ' not a valid address and ' + (dropped === 1 ? 'was' : 'were') + ' dropped.' : '')
                : 'List cleared. New-order alerts fall back to the addresses set in Cloudflare.' + (dropped > 0 ? ' Nothing you typed looked like an address.' : ''),
        });
    }
    catch (e) {
        return j({ error: e instanceof Error ? e.message : 'Request failed.' }, 400);
    }
}
