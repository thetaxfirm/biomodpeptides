# Orders admin work queue, October 12, 2026

Owner asked for the Orders tab to be reviewed and then "fix all". Author: Claude. Base: ad66ff3 (fetched main, separate worktree `claude/orders-admin-v1`); collaborator checkouts untouched. Source commit 3a8d3af, fast-forwarded to main.

## Problems found

- About a screen of help text (checkout recovery, EasyPost guide, fulfillment queue caveats) sat above the first order on every visit.
- Up to 200 orders rendered as fully expanded cards: item table, totals, address, label controls and forms on every card.
- No status filter, search or sort; orders to ship were mixed with unpaid checkouts, tests, refunds and delivered orders.
- Card titles were a random order code; statuses were long sentences; action buttons moved with state; the manual form stayed visible after a label existed.
- The list stopped silently at 200 orders.

## Change

- New `GET /api/store/admin-orders` (`orders:read`): scans up to 5,000 recent orders, classifies each, returns counts per status, a filtered/searched page of 50 and `hasMore`. A single-order lookup (`id`) keeps the details panel current after an order changes state. Truncation is reported, never silent.
- `components/store/orders-admin.tsx`: status tabs with counts (To ship by default, oldest first; Label bought; Shipped; Delivered; Unpaid; Needs review; Refunded / cancelled; All; Internal tests kept out of All), one search box (name, email, order number, tracking, city, items, promo), a compact table with one next step per row, and the full order in a side panel. Help moved behind one disclosure.
- `ShippingLabel` gains a `compact` button-only mode for table rows; the confirmation still names the saved service.
- Customer My Account orders: short status, line prices, one primary button for unpaid orders.
- Status rules: `orderBucket`, `bucketStatus`, `customerOrderStatus` in `lib/fulfillment.ts` next to `fulfillmentLabel`. Queue, search, paging: `lib/order-queue.ts`. Shared status styles: `app/storefront-v35.css`.

Affected: app/api/store/[action]/route.ts, components/store/admin.tsx, orders-admin.tsx, orders-admin.module.css, shipping-admin.tsx, account.tsx, lib/fulfillment.ts, lib/order-queue.ts, app/layout.tsx, app/storefront-v35.css. URLs: /admin?tab=orders, /account/orders.

## Validation

- `npm run check:release`: TypeScript and 62 isolated suites, including new `orders-queue-v1.cjs` (buckets, counts, search, ordering, paging, lookup, truncation, customer labels, route permission and UI wiring). `admin-read-recovery-v1.cjs` now drives order drafts, refresh, discard and reconcile through the queue component's props.
- `BIOMOD_DEPLOY=true npm run build` passed.
- Local browser check with synthetic orders on a temporary uncommitted page: tabs and counts, search ("avery phoenix" to 3 rows), Load more (50 to 72), side panel open and Escape close, compact row actions, 375 px width with no horizontal scroll.

## Live deployment

Pushed 3a8d3af to main at about 05:18 UTC October 13; Workers Builds deployed versions 080b5576 (05:20 UTC) and eb668635 (05:22 UTC) to trybiomod.com. Read-only checks: `/api/store/admin-orders` returns "Please sign in to continue." signed out (unknown actions return 404), and the live stylesheet contains the new status classes.

## Gaps

- The signed-in admin Orders tab and customer orders page were not viewed live with real orders; that needs an owner session in the browser.
- No real labels, payments or emails were exercised.
