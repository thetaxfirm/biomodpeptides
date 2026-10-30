# Back order and Abandoned carts — Oct 30 2026

## What the owner asked

> "i need a new tab opened called abandoned carts cause these orders that havent been paid are
> clogging up my system and causing confusion i want any order that is started then abandoned or
> not paid or partials need to get put into it"

> "also need to add a back order tab in here that cn pull orders that we dont have in stock or that
> we have pulled back for pre ordered products"

Chosen by the owner: abandoned carts collects unpaid **and** expired checkouts, and moves out of the
main tab row into the records dropdown. "Partials" was withdrawn — the store has no partial-payment
state, since Authorize.net either captures the full total or the order is not paid.

## Why it mattered

Two live orders were filed where nobody could act on them, and both were actively misleading:

- **#5683EF1B** (Chip Jones, IGNITE) sat in **Needs attention** for 22 days. Nothing there was a
  decision anyone could make; it was waiting for a batch.
- **#0FA26640** (Aniket Sinha) sat in **Pack & ship** looking five days late with a bought label and
  no carrier scan. It is a **preorder shipping early November**. It was read as a lost parcel and
  very nearly chased as one.

Waiting on stock is neither a decision nor a box to pack. Leaving it in either queue is what made
both lists untrustworthy.

## The rules

### Back order — new main tab

`backOrdered()` in `lib/fulfillment.ts`. An order is back-ordered when it is held with issue
`out_of_stock`, **or** it carries a preorder line (`orderHasPreorder`).

It stops being back-ordered the moment the carrier has the parcel: a moving, delivered or
problem carrier status, or a delivered order, all return false. A box in transit is not waiting on
stock, whatever the order still says.

In `tabForOrder()` the check sits **above** payment verification and the work queues, and **below**
internal tests and closed orders. So a refund, a cancellation, an internal test and a carrier
problem all still outrank it.

### Abandoned carts — renamed, moved to the dropdown

The `unpaid` tab keeps its id (it is still the unpaid bucket, and old `?tab=unpaid` links still
resolve) and becomes **Abandoned carts**, marked `secondary` so it leaves the main row.

`tabForOrder()` now routes a **closed order, cancelled, whose `releasedReason` starts with
`unpaid_checkout`** to that tab instead of Cancelled. A refund or an unsuccessful payment with the
same reason string is untouched — only a cancellation moves. `releasedReason` is already on the
`adminOrderView` allowlist, so the server-side bucketing sees it.

Cancelled is left holding only orders somebody decided to cancel, and its detail line no longer
claims otherwise. The bucket is unchanged, so an expired checkout is still archivable from its new
home.

### The main row now

Pack & ship · Needs attention · **Back order** · Track parcels · All orders

Records dropdown: **Abandoned carts** · Delivered · Refunded · Cancelled · Payment unsuccessful ·
Internal tests · Archived.

No component change was needed — `orders-admin.tsx` renders the row from `queueTabs.filter(t =>
!t.secondary)` and the dropdown from the rest.

## Today screen

`orderAttention()` gains a **waiting on stock** card. Without it, an order held for a batch that
never arrives would drop off the dashboard entirely the moment it stopped counting as attention —
the exact disappearance this change was meant to prevent. It turns urgent past 14 days. The unpaid
card is retitled to match the tab.

## Checks

`tests/orders-queue-v1.cjs` covers both rules: an out-of-stock hold and a preorder line each route
to Back order, a label bought early does not make a preorder packable, a moving or delivered
preorder is a parcel, a carrier problem and a refund outrank it, another hold reason is still a
decision; an expired checkout joins the unpaid ones while a decided cancellation stays put, a
refund and a failed payment never move, the tab is still archivable, and the row/dropdown placement
is asserted.

Mutations verified to fail the suite: removing the Back order routing, removing the moving-parcel
guard, removing either half of `backOrdered`, removing the expired-checkout routing, and treating
every released reason as an expired checkout.

`tests/admin-overview-v1.cjs` and `tests/orders-dropped-off-v1.cjs` updated for the new cards and
labels.

`npm run check:release` — TypeScript and 110 isolated suites.

## Not in this change

`adminOrderView` still strips `paymentVerified`, `paymentCheck`, `dismissed` and `labelApproval`
before orders reach the browser. That is why every row reads "No independent provider verification
recorded" and why `paymentVerificationFailed()` in `tabForOrder` can never fire. Raised with the
owner, not yet authorised.
