// Win-back emails for checkouts that were started but not paid. Each template targets a known reason
// people abandon checkout (Baymard: surprise costs, payment trust, friction; Klaviyo: reminder, then
// incentive, then a final note). Honest by design: no invented deadlines, scarcity or claims.
export type WinBackContext = { firstName: string; items: { name: string; url: string }[]; orderNumber: string; ordersUrl: string; autoRecovery: { savingsCents: number } | null };
export type WinBackTemplate = { id: string; label: string; why: string; body: (c: WinBackContext) => string };
const list = (c: WinBackContext) => { const names = c.items.map(i => i.name); return names.length <= 1 ? names[0] || 'your items' : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; };
const hi = (c: WinBackContext) => `Hi ${c.firstName || 'there'},`;
const auto = (c: WinBackContext) => c.autoRecovery ? `\n\nThe extra $${(c.autoRecovery.savingsCents / 100).toFixed(2)} saving we added to that order is still on it.` : '';
// Owner rules (Oct 24 2026): never embarrass the customer (no "didn't go through", no card talk; any
// problem is the site's), no research-use line in the body (the signature footer carries it), and
// routine emails are not signed with Ash's name. Only the personal note from Ash is signed "Ash".
export const winBackTemplates: WinBackTemplate[] = [
  { id: 'help', label: 'Need a hand?', why: 'Service first, no discount. Offers to finish the order for them, which removes whatever got in the way without making them explain or feel at fault.',
    body: c => `${hi(c)}\n\nYour order for ${list(c)} (${c.orderNumber}) is saved. It looks like the site didn't let you finish checkout, and I'm sorry about that.\n\nIf anything got in the way, just reply and we'll take care of it for you, or we can send you a direct payment link. Your order is waiting under My orders: ${c.ordersUrl}${auto(c)}\n\nThank you,` },
  { id: 'reminder', label: 'Your order is saved', why: 'A plain reminder naming the exact product, plus proof of quality (lot-matched lab reports) to remove doubt. Naming the product is linked to higher opens.',
    body: c => `${hi(c)}\n\nYour order for ${list(c)} (${c.orderNumber}) is saved and ready whenever you are: ${c.ordersUrl}\n\nEvery lot we sell has its own lab report, and you can see them here: https://trybiomod.com/testing${auto(c)}\n\nAny questions before you finish, just reply.\n\nThank you,` },
  { id: 'founder', label: 'Personal note from Ash', why: 'A short, personal note from the founder reads as service rather than marketing and invites a reply, which surfaces the real objection.',
    body: c => `${hi(c)}\n\nAsh here, I'm one of the owners of BioMod. I saw you got as far as checkout with ${list(c)} and wanted to reach out myself.\n\nIf you have any questions about the products, the lab reports or shipping, reply here and I'll answer you directly.\n\nBest,\nAsh` },
  { id: 'last', label: 'Last reminder', why: 'A polite final message that respects their choice. Saying you will stop reminding them prompts a decision without pressure.',
    body: c => `${hi(c)}\n\nJust a last note that your order for ${list(c)} (${c.orderNumber}) is still saved if you want it: ${c.ordersUrl}\n\nIf you've changed your mind, no problem at all. This is the last reminder you'll get about this order.\n\nThank you,` },
];
// One offer email per come-back code (lib/promotions.ts). Best as a second touch, for people who hesitated on price.
// A code cannot be added to a checkout that was already started, so the email sends them to a fresh checkout.
const offers = [10, 15, 20, 25, 30].map((percent): WinBackTemplate => ({
  id: 'off-' + percent, label: `${percent}% off to finish (COMEBACK${percent})`,
  why: percent >= 25 ? 'A strong offer for a customer you really want back, or to make up for a problem. Use sparingly so customers do not learn to wait for it.' : 'A clear incentive works best as a second touch for people who hesitated on price. One real code, no fake deadline.',
  body: c => `${hi(c)}\n\nWe saved your order for ${list(c)}, and here is ${percent}% off to make finishing it easier: code COMEBACK${percent}.\n\nA code can't be added to an order that's already started, so just add the items to your cart again and enter COMEBACK${percent} at checkout:\n${c.items.map(i => i.name + ': ' + i.url).join('\n')}${c.autoRecovery ? `\n\nOr finish your saved order with the saving already on it: ${c.ordersUrl}` : ''}\n\nIf anything gets in the way, just reply and we'll take care of it for you.\n\nThank you,`,
}));
winBackTemplates.splice(3, 0, ...offers);
export const winBackTemplate = (id: string) => winBackTemplates.find(t => t.id === id);
