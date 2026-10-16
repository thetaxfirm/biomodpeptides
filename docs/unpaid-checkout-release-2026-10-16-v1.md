# Unpaid checkout release — 2026-10-16

## What was wrong

Nothing ever expired an unpaid checkout. An order reached `awaiting_payment`, the customer closed
the tab, and it stayed that way forever: verified at 1, 8, 30, 120 and 365 days against the built
Worker, the status never changed and its `inventory_reservations` row was never released. The
five-minute cron sent recovery email and bought labels; no job owned the dead ones.

Two things followed, both reproduced against the production build before any change was made.

**The customer could not buy anything else.** `orders_owner_active` is a partial unique index
allowing one unresolved order per owner, and checkout refuses ahead of it with *"You already have an
unresolved checkout."* There is no cancel action for the customer and none for staff — `admin-order`
accepts only `shipped` and `delivered`, on orders that are already paid — so clearing one meant
editing the database by hand. The account page offers *Resume checkout* and *Check payment status*;
after seven days the pay page refuses the order, so Resume leads to a page that will not serve it,
and after twenty-nine days verification answers *"outside the online verification window."*

**Abandoned carts consumed stock.** With one unit in stock and one abandoned checkout holding it,
the shop still advertised `inStock: true, stockQuantity: 1`, let a second customer quote, and then
refused at the final step with *"Inventory, presale limits, or an existing checkout prevented this
order."* The last unit of a product was unsellable for as long as somebody's abandoned cart held it,
which was indefinitely.

## What changed

`lib/checkout-expiry.ts` releases a checkout once it is certainly dead, and "certainly dead" is
decided by Authorize.net rather than by a clock. `releaseUnpaidOrder` asks the provider first and
acts only on a confirmed absence of payment — the same gate the recovery mailer uses before it
offers a discount. A payment that exists, is pending, or is under review is never touched, and
neither is an order held for `review`, one already carrying a payment reference or notification id,
or one containing an archived product: those wait for a person. Both writes are guarded on the exact
row that was read, so a payment landing mid-flight, an administrator edit, or a second release
running concurrently makes the whole thing do nothing rather than cancel a paid order. A provider
that is slow, silent or throwing costs stock, never an order.

Two callers:

- **The checkout path.** When an earlier unresolved checkout blocks a new one, each blocker is now
  examined rather than refused outright. An exact repeat still hands back the original order,
  unchanged. Anything else is offered to the provider, and a verified absence of payment releases it
  so the new order proceeds. A real payment, a pending one, or an order held for review still blocks
  with the message it always used. This is what unlocks a customer immediately, at any age.
- **The five-minute cron.** A bounded sweep (ten per run, oldest first) releases unpaid checkouts
  past the hold window in this payment environment, and records health under
  `checkout_expiry_health_v1`: status, when it last looked, how many were due, released, kept and
  failed. A job that never runs produces no errors at all; this line is how a dead one shows up.

## Timing

`UNPAID_HOLD_MS` is 24 hours — the owner's decision, so that the last unit of a product is back on
sale the next day rather than held indefinitely.

The recovery mailer complicates this and its suite caught the collision: it waits a day, then offers
an abandoning customer a further 7.5% and points them back at that same order to pay it, stopping at
seven days. Releasing at twenty-four hours would have emailed people a discount on an order that had
just been cancelled, and `tests/checkout-recovery-worker-v1.mjs` went red accordingly. So while
`checkout_recovery_v1.enabled` is true the programme owns an unpaid checkout for its first week and
the sweep leaves it alone (`RECOVERY_WINDOW_MS`); with recovery switched off there is nothing to
wait for and the day-long hold is the whole of it. The checkout path is unaffected either way — a
blocked customer is unblocked on their next attempt regardless of age, which is the part they feel.

## Dependent surfaces checked

- `orders_owner_active` is the real enforcement; the release clears the row before the insert, which
  is why a new order now succeeds where it previously hit the constraint.
- `inventory_reservations` is otherwise cleared only by `clearSettledReservation` on a paid order;
  the new delete is guarded the same way and only ever touches an order this batch just cancelled.
- `settleInventory` still decrements against a paid order only. A released order is `cancelled`, so
  it is outside both.
- `runCheckoutRecovery` skips cancelled orders by status, and its window is now respected.
- `reconcile` is unchanged; a released order is `cancelled`, not one of the statuses it acts on.
- `tests/address-normalization-v1.cjs` stubs the blocking-order query by prefix and was updated for
  the widened column list.
- `tests/change-history-system-v1.cjs` now asserts six scheduled jobs and that the release runs
  under its own audit identity, never the shared `env.DB`.

## Verification

- `tests/checkout-expiry-v1.cjs` (in the release gate): every verdict the provider can return
  against an otherwise releasable order; review, referenced, notified and archived orders; the
  payment-lands-first and administrator-edit races; the hold window, the recovery window, the
  payment environment, a throwing provider, and both unreadable-input states.
- `tests/checkout-expiry-worker-v1.mjs`: the deployed five-minute cron against the built Worker and
  a local D1 — an expired checkout released and its stock returned, while in-window, paid,
  held-for-review and foreign-environment orders are untouched, the provider is asked before any
  cancellation, and a second run releases nothing.
- Gate green: TypeScript and 88 isolated suites. All Worker suites green.
- Against the rebuilt Worker: a customer who abandons a checkout and returns wanting a different
  product now gets a new order, with the abandoned one `cancelled` and its reservation released.
  A full purchase still completes unchanged — overnight shipping selected, order total $251.75,
  $251.75 sent to Authorize.net, one EasyPost rate call.

## Not done

- The sweep's health is stored but not yet shown on an admin screen, unlike the shipping and sweep
  health lines. Until it is, a silently failing release is only visible in `settings`.
- Staff still have no way to cancel an order from the admin UI. The sweep and the checkout path
  cover the cases that block a customer, but a deliberate cancellation still needs a database edit.
