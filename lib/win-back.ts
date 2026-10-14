// Win-back emails for checkouts that were started but not paid. Each template targets a known reason
// people abandon checkout (Baymard: surprise costs, payment trust, friction; Klaviyo: reminder, then
// incentive, then a final note). Honest by design: no invented deadlines, scarcity or claims.
export type WinBackContext = { firstName: string; items: { name: string; url: string }[]; orderNumber: string; ordersUrl: string; autoRecovery: { savingsCents: number } | null };
export type WinBackTemplate = { id: string; label: string; why: string; body: (c: WinBackContext) => string };
const list = (c: WinBackContext) => { const names = c.items.map(i => i.name); return names.length <= 1 ? names[0] || 'your items' : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; };
const hi = (c: WinBackContext) => `Hi ${c.firstName || 'there'},`;
const auto = (c: WinBackContext) => c.autoRecovery ? `\n\nThe extra $${(c.autoRecovery.savingsCents / 100).toFixed(2)} saving we added to that order is still on it.` : '';
export const winBackTemplates: WinBackTemplate[] = [
  { id: 'help', label: 'Need a hand?', why: 'Service first, no discount. The top checkout drop-offs are surprise costs, payment trust and a clunky form; asking what went wrong fixes the real problem.',
    body: c => `${hi(c)}\n\nI saw your order ${c.orderNumber} for ${list(c)} didn't go through at payment. Sometimes the card form or the shipping total gets in the way, and I'd rather fix that than lose you.\n\nIf something went wrong, just reply and tell me what happened. I'll sort it out personally. Your order is saved under My orders: ${c.ordersUrl}${auto(c)}\n\nAsh` },
  { id: 'reminder', label: 'Your order is saved', why: 'A plain reminder naming the exact product, plus proof of quality (lot-matched lab reports) to remove doubt. Naming the product is linked to higher opens.',
    body: c => `${hi(c)}\n\nYour order for ${list(c)} (${c.orderNumber}) is saved and ready when you are: ${c.ordersUrl}\n\nEvery lot we sell is matched to its own lab report, and you can read them here: https://trybiomod.com/testing${auto(c)}\n\nAny questions before you finish, just reply.\n\nAsh` },
  { id: 'founder', label: 'Personal note from Ash', why: 'A short, personal note from the founder reads as service rather than marketing and invites a reply, which surfaces the real objection.',
    body: c => `${hi(c)}\n\nAsh here, I run BioMod. I noticed you got as far as checkout with ${list(c)} and wanted to check in myself.\n\nIf there's anything you want to know about the product, the lab reports or shipping, reply to this email and I'll answer directly.\n\nAsh` },
  { id: 'last', label: 'Last reminder', why: 'A polite final message that respects their choice. Saying you will stop reminding them prompts a decision without pressure.',
    body: c => `${hi(c)}\n\nOne last note about your order for ${list(c)} (${c.orderNumber}). It's still saved if you want it: ${c.ordersUrl}\n\nIf you've changed your mind, no problem at all. I won't send another reminder about this order.\n\nAsh` },
];
// One offer email per come-back code (lib/promotions.ts). Best as a second touch, for people who hesitated on price.
// A code cannot be added to a checkout that was already started, so the email sends them to a fresh checkout.
const offers = [10, 15, 20, 25, 30].map((percent): WinBackTemplate => ({
  id: 'off-' + percent, label: `${percent}% off to finish (COMEBACK${percent})`,
  why: percent >= 25 ? 'A strong offer for a customer you really want back, or to make up for a problem. Use sparingly so customers do not learn to wait for it.' : 'A clear incentive works best as a second touch for people who hesitated on price. One real code, no fake deadline.',
  body: c => `${hi(c)}\n\nYour order for ${list(c)} didn't go through, so here is ${percent}% off to make it easier: code COMEBACK${percent}.\n\nA code can't be added to an order that was already started, so add the items to your cart again and enter COMEBACK${percent} at checkout:\n${c.items.map(i => i.name + ': ' + i.url).join('\n')}${c.autoRecovery ? `\n\nOr, if you prefer, finish your saved order with the saving already applied: ${c.ordersUrl}` : ''}\n\nAsh`,
}));
winBackTemplates.splice(3, 0, ...offers);
export const winBackTemplate = (id: string) => winBackTemplates.find(t => t.id === id);
