# Order archive release v1 (2026-10-17)

Owner request, Oct 17 2026: an Archive button for finished orders, and an explanation of why order #A019AE37 sat under Refunded / cancelled.

## What #A019AE37 was

A checkout started Oct 8, 2026 that was never paid. No charge was made and nothing was refunded. On Oct 16 the scheduled "Unpaid checkout release" job closed it (`releasedReason: unpaid_checkout_expired`) and put its stock back on sale. It was created before unpaid-checkout reminders were switched on for new checkouts, so the customer was never emailed. The queue labelled it with the shared bucket name "Refunded / cancelled", which read as if money had moved.

## Change

- Admin > Orders: an **Archive** button on closed, delivered and internal-test orders, and an **Archived** tab with **Restore**. Archived orders leave every working tab and the All count.
- Archive only writes `data.archivedAt` / `data.archivedBy`. Order status, payment, label and customer-facing status are untouched. The server refuses to archive anything still needing work (409).
- Permission: `orders:fulfill`. Recorded in change history through the audited admin writer.
- Closed orders now show why under the status: "Never paid · checkout expired", "Refunded", or "Payment unsuccessful".

## Files

`lib/order-queue.ts`, `lib/fulfillment.ts`, `lib/catalog-visibility.ts`, `app/api/store/[action]/route.ts`, `components/store/orders-admin.tsx`, `tests/orders-queue-v1.cjs`.

## Verification

- `npm run check:release`: TypeScript and 90 isolated suites passed. `tests/orders-queue-v1.cjs` covers archivable buckets, counts, the Archived tab, lookup, closed reasons, the permission and that archive never changes status.
- `BIOMOD_DEPLOY=true npm run build` passed.
- Commit 4d4fdba on main. GitHub release-check success 10:12:56 UTC; Workers Builds `biomod-peptides` success 10:13:25 UTC; live version c1fbbe89.
- Live, read-only: home page 200; unsigned POST to `admin-order-archive` refused with "Please sign in to continue."

## Gap

The signed-in click (Archive, then Restore) was not run live: it needs an owner sign-in. Author: Claude agent for the owner.
