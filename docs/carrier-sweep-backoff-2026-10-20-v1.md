# Carrier sweep back-off and unreadable parcels — 20 Oct 2026

## Why

Two complaints from the owner, one cause each.

1. **"We keep getting notifications about packages that have already been out for days."**
   A parcel whose carrier status did not change was never recorded as having been asked about.
   `checkedAt` only moved when the status moved, and the due queue is ordered by that same column,
   so an unchanging parcel kept the oldest timestamp, was re-read on every five-minute run, and
   once enough of them collected to fill the per-run limit (15) nothing behind them was ever
   reached. The same held for a parcel the provider refused to answer about.

2. **The daily digest told the team to go find a box that was never the problem.**
   A shipment EasyPost will not return tracking for — a cancelled label, an edited tracking code,
   a shipment on another account — looks exactly like a parcel the post office has not scanned.
   `readShipmentTracking` throws in that case; the throw was counted in the run health and then
   discarded, so the order stayed at `pre_transit` forever and produced the same line every day.

A third defect was found while fixing these. `checkedAt` had two meanings at once. The webhook
writes the **carrier's event time** to it, which is what `stuckInTransit` measures and what the
orders queue prints as "No carrier update since". The sweep and the admin **Check carrier status**
button wrote **our own check time** to the same field, so pressing that button silently reset a
genuinely stuck parcel's clock to zero and hid it from the four-day alert.

## What changed

- **`shipment.sweptAt`** is new and means only *when we last asked*. It is written on every sweep
  outcome: status changed, status unchanged, provider refused, stored observation newer, malformed
  record. It never touches the order's `status` or `updated` column.
- **`shipment.checkedAt`** now means only *when the carrier last reported something new*. The sweep
  and the manual refresh button write it only on an actual change. The webhook is unchanged.
- The due query orders and filters on
  `coalesce(sweptAt, checkedAt, labelCreatedAt, created)`, so every parcel backs off by
  `TRACKING_RECHECK_MINUTES` (180 by default) after being asked and the queue rotates.
- **`shipment.readFails`** counts consecutive provider refusals and is cleared by the first
  successful read. At three (`UNREADABLE_AFTER`, about nine hours at the default interval) the
  parcel is reported as unreadable rather than unscanned.
- The daily digest line for such a parcel now reads: *"the carrier will not return tracking for it.
  Open the shipment in EasyPost: the label may be cancelled or the tracking code wrong. The box may
  well be moving."* An ordinary unscanned parcel's line is unchanged.
- The orders queue shows **"Carrier will not return tracking · check the label in EasyPost"** in
  place of "Not scanned 24h+ · Not dropped off" for those parcels.
- The order's shipping panel now says **"Carrier last asked X. Last change the carrier reported: Y."**
  instead of one sentence that was true of neither field.

## Dependent surfaces checked

| Surface | Effect |
| --- | --- |
| `lib/fulfillment.ts` `stuckInTransit` | Reads `checkedAt`; now correct, because asking no longer resets it. |
| `lib/fulfillment.ts` `stalledLabel`, `orderBucket` | Unchanged. |
| `app/api/shipping/easypost/route.ts` (webhook) | Unchanged; still the fast path, still writes the carrier's own event time. |
| `app/api/admin/shipping/route.ts` label purchase | Untouched. |
| `lib/auto-label.ts` | Relies on `orders.updated`; the sweep's back-off stamp deliberately leaves it alone. |
| `components/store/fulfillment-admin.tsx` sweep report | Counter meanings unchanged — `changed` still means a carrier change. |

## Regression tests

`tests/tracking-sweep-v1.cjs` — a changed status records both fields; an unchanged status records
`sweptAt` only and leaves `checkedAt` and `updated` alone; a failed read backs off; eight unchanging
parcels with a limit of four are read four and four across two runs rather than the same four twice;
a newer stored observation is preserved **and** still backs off; three refusals are counted and one
good read clears them; a recent `sweptAt` defers a parcel exactly as a recent `checkedAt` does.

`tests/shipping-protection-v1.cjs` — three refusals produce `unreadable: true`, two do not, a parcel
the carrier answers about is never flagged, and the digest sends the team to the label rather than
to the post office.

`npm run check:release`: TypeScript and 97 isolated suites green.

## Live verification still required

Admin → Settings → Shipping, carrier sweep line: `due` should now fall below the limit on successive
runs instead of sitting at it. Open order #65402CE8 or #0EE1BA61 and read "Carrier last asked" —
if those parcels are among the unreadable ones, the queue line will change within about nine hours
and the next 9 AM digest will name the label rather than the box.
