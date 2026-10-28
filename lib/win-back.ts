// Staff-reviewed checkout follow-up drafts. Purchase and contact evidence are checked before rendering.
export type WinBackContext = { firstName: string; items: { name: string; url: string }[]; orderNumber: string; ordersUrl: string; autoRecovery: { savingsCents: number } | null };
export type WinBackTemplate = { id: string; label: string; why: string; body: (c: WinBackContext) => string };
const list = (c: WinBackContext) => { const names = c.items.map(i => i.name); return names.length <= 1 ? names[0] || 'your items' : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]; };
const hi = (c: WinBackContext) => `Hi ${c.firstName || 'there'},`;
export const winBackTemplates: WinBackTemplate[] = [
  { id: 'help', label: 'Ask if they need help', why: 'A short question leaves room for a purchase or conversation outside the store records. It does not assume a payment problem or offer another discount.',
    body: c => `${hi(c)}\n\nDid you get your ${list(c)} order sorted, or would you like a hand?\n\nThank you,` },
  { id: 'reminder', label: 'Share the saved order', why: 'Use when the customer wants to continue this checkout. Keeps the saved order and its existing savings together.',
    body: c => `${hi(c)}\n\nIf you would still like to continue your saved ${list(c)} order (${c.orderNumber}), you can find it here: ${c.ordersUrl}${c.autoRecovery ? `\n\nThe $${(c.autoRecovery.savingsCents / 100).toFixed(2)} saving already applied is included in that order.` : ''}\n\nIf you already arranged it another way, just let us know. Otherwise, reply here if you would like a hand.\n\nThank you,` },
];
// Old discount, founder and final-reminder ids deliberately do not resolve. Historical sent mail stays intact.
export const winBackTemplate = (id: string) => winBackTemplates.find(t => t.id === id);
