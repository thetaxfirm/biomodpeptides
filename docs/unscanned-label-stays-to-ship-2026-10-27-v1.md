# Unscanned labels stay in To ship until they are dropped off — Oct 27 2026

## What the owner asked

Looking at Needs review, five of the eight orders in it read "Not scanned 24h+ · Not dropped off".
The owner: *"so if its not dropped off yet then keep it in the to ship tab why was it moved out of
there?"*

## What was happening

`orderBucket()` escalated any label bought more than 24 hours ago that the carrier had not yet
scanned (`stalledLabel()`) straight to `review`. The intent was to make a parcel sitting on the
bench loud. The effect was the opposite:

- **It hid the work.** To ship is the list the owner packs from. An order that has not been packed
  and dropped off is exactly that list's job, and it was being filed somewhere else.
- **It took away the button that clears it.** `mainStep()` renders **Dropped off** only for
  `bucket === 'label'`, and `canMarkDroppedOff()` requires the same bucket. Once the order moved to
  `review`, the row offered View / Report problem / Dismiss flag — no way to record the handoff.
  The only route out was Dismiss flag, which marks it shipped without ever recording that anyone
  took the box anywhere.

## The rule now

Two different situations that used to share one bucket:

| Situation | Bucket | Tab | Button |
|---|---|---|---|
| Label bought, never marked dropped off | `label` | To ship | **Dropped off** |
| Marked dropped off, carrier silent 24h later | `review` | Needs review | Dismiss flag |

The second is the real anomaly: the box left the building and USPS has no record of accepting it.
The first is just work that has not been done yet, and it is already flagged where it sits —
`ship-cutoff.ts` counts an order with no `handoff.at` as late, so these keep their ★ and their
"Late: was due …" line in To ship, and keep feeding the red must-go-out-today banner.

`stalledAfterHandoff()` is the new predicate. **Its clock runs from the handoff, not from the label
purchase.** That is load-bearing: a week-old label marked dropped off today must buy a full day of
silence before it counts as stalled. Timing it from `labelCreatedAt` would have thrown the order
straight back into Needs review the instant the owner pressed the button, with no way to clear it.

`stalledLabel()` itself is unchanged, so the row still reads "Not scanned 24h+ · Not dropped off" —
now in To ship, where it is actionable.

## Dismiss flag

`dismissibleReview()` is unchanged in code but narrower in effect: a never-dropped-off parcel no
longer reaches `review`, so it can no longer be dismissed. That follows the rule the file already
states — a hold, a label over the limit and a payment needing a check are not dismissible *because
each has its own button*. Dropped off is now that button. The 409 from
`app/api/admin/shipping/route.ts` names the new case.

## What did not change

- **The four-day digest.** `parcelAlerts()` runs its own query on its own clock and never consults a
  bucket. A box that is never dropped off is still chased at four days, with
  `stalledReason()` returning "postage bought, never scanned and never marked dropped off. Find the
  box." The owner's two-alert rule is untouched.
- **The customer's view.** `customerOrderStatus()` showed "Preparing shipment" for both cases before
  and still does. No customer-visible change.
- **Holds, over-limit labels, payment review, carrier problems and stuck-in-transit.** All still
  escalate to Needs review exactly as before; a hold still outranks everything.

## Checks

`tests/orders-queue-v1.cjs`, `tests/shipping-protection-v1.cjs` and
`tests/change-history-shipping-v1.cjs` cover the split, the handoff clock, the fresh-drop-off grace,
and the narrowed dismiss. Mutations verified to fail the suite: restoring the old rule, removing the
handoff gate, and treating the handoff as always present.

`npm run check:release` — TypeScript and 105 isolated suites.
