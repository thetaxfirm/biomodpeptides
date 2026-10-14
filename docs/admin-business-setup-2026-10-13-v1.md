# Admin set up for running the business, October 13, 2026

Scope: trybiomod.com administration. Author: Claude, at the owner's request: "make it professional admin set up... review our admin page and make adjustments to help us run a proper business." The reply desk (Requests) is owned by a parallel session and was not changed here.

## Review findings

1. No home screen: administration opened on the order queue with no view of what was waiting, how sales were going or what was blocked. Unanswered customers waited up to six days unnoticed.
2. Thirteen tabs (counting the reports) in one row, daily work mixed with technical records (Search publishing, Traffic, Diagnostics, Changes); the row overflowed at normal laptop widths.
3. The "Can't ship: no COA" list on Orders was a 33-row wall above the orders.
4. Products had no "needs attention" view; COA wording in the list used a different rule than the shipping block.
5. Presales asked for "Product IDs, separated by commas".
6. Not changed, recommended next: promo codes are fixed in code (lib/promotions.ts) and cannot be created, paused or edited in admin; the Rewards tab is a raw ledger that needs a customer ID (the rewards program v1 is built separately and awaits owner approval).

## Changes

- New **Today** tab, the landing page for every role. "Needs attention" lists, urgent first, each with an Open button to the right tab: shipping prices not set up or all off, payments in test mode, paid orders to ship (oldest wait, how many are blocked by a missing COA), labels bought but not marked shipped, orders needing review, unfinished checkouts this week, customers waiting over a day for a reply (the reply desk's own `overdueCustomers` rule), products holding up paid orders for lack of a COA, out of stock, low stock (5 or fewer), products for sale without a COA. Sales: paid orders and revenue today (from midnight Pacific), last 7 and last 30 days, live payments only, internal tests excluded. Sections follow role permissions (sales for owners/managers, product items for store editors, requests for request handlers). A failed request check is shown as such, never as all clear.
- Tabs reordered by daily work: Today, Orders, Requests, Products, Promo codes, Presales, Rewards, Settings, Team, Reports. Sales reports, Traffic, Search and Change log share one Reports tab with a switcher; old ?tab= links still work.
- Orders: the no-COA panel shows only products holding up paid orders; the rest sit behind one line.
- Products: "Needs attention" views (No COA, Stock not entered, Low stock, Out of stock); each row's COA wording uses the shipping rule ("No COA, can't ship").
- Presales: searchable product checklist instead of typed IDs.

## Verification

`npm run check:release` and `BIOMOD_DEPLOY=true npm run build`: TypeScript and 74 suites, including new `admin-overview-v1.cjs` and updated `admin-read-recovery-v1.cjs` (default Today, tab order, single Reports tab). Production build reviewed locally on synthetic data with providers intercepted: Today counts, Reports switcher deep link (?tab=traffic), Products filters, collapsed Orders panel.

Affected: /admin (all tabs), /api/store/admin-overview (new, staff only). No migration, no data change.
