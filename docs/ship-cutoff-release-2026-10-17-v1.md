# 2 p.m. same-day tracker and Logan on new-order emails (October 17, 2026, v1)

Author: Claude agent for the owner. Owner request: "make sure the back end has a tracker for 2pm cut off (has to go out) red star etc send email to logan that new order is here".

## Rules (lib/ship-cutoff.ts)

The published promise (shipping-terms.ts): in-stock weekday orders placed before 2 p.m. Pacific normally process the same business day, excluding federal holidays.

- Due day: placed on a business day before 2:00 p.m. Pacific goes out that day; otherwise the next business day. Business days skip weekends and U.S. federal holidays (observed dates, computed for any year).
- Tracked: paid orders (including label bought or being bought) that are not a preorder, not held for a problem, not an internal test, not archived, and not yet out.
- Out: marked Dropped off, marked dispatched, or scanned by the carrier. A bought label alone is not out.
- States: "Must go out today" (red star), "Late: was due Mon, Oct 19" (red star), "Goes out Tue, Oct 20" (no star).
- Placement time is the order's checkout time (no separate payment time is stored; payment normally follows within minutes).

## Change

- Admin > Orders: a box above the list counts orders that have to go out today across every tab ("3 orders have to go out today (1 late)"), or says "Nothing has to go out today." Each tracked row shows a red star before the order number and its due line under it.
- New paid-order email: a line at the top, "★ Ship today: placed before the 2 p.m. Pacific cutoff." or "Ship by Monday, October 19: placed after the 2 p.m. Pacific cutoff or outside business days."; same-day orders' subject starts "SHIP TODAY · ". Preorders keep their own notice.
- Runtime (Cloudflare Worker biomod-peptides, not in Git): Logan's address (taken from the existing owner list) added to ORDER_NOTIFY_EMAILS, now 4 recipients. Changed through the settings API with every other binding inherited; 28 bindings and 11 secrets before and after. ORDER_NOTIFY_EMAILS also addresses the daily 9 a.m. parcel alert, so Logan receives that too.
- Files: lib/ship-cutoff.ts (new), lib/order-queue.ts, components/store/orders-admin.tsx and .module.css, lib/order-summary.ts, lib/checkout.ts; tests/ship-cutoff-v1.cjs (new, release gate); orders-queue-v1 and orders-dropped-off-v1 loaders updated.

## Verification

- `npm run check:release`: TypeScript and 96 suites; `BIOMOD_DEPLOY=true npm run build` passed. ship-cutoff-v1 covers the 2:00 boundary, daylight and standard time, weekends, Thanksgiving, observed July 4 2027, each excluded order type, queue counts on every tab, and the email line and subject.
- Gap: the signed-in Orders screen was not viewed (needs an owner or manager sign-in), and no real order email was sent as a test. The next paid order will show both.
