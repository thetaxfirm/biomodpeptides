# Automatic payment verification — 27 Oct 2026

## What it does

Every five minutes, orders already marked paid are put back to the payment provider and asked a
narrower question than checkout asks. The verdict is written to `$.paymentVerified` on the order and
shown as a green check beside the order number on every tab of the Orders queue.

An order is only verified when the provider confirms **all** of this:

- a transaction on **this order's own invoice** (not another order's),
- of type **auth-and-capture** (not an authorisation, not a refund),
- that the bank **approved** (response code 1),
- for the **exact order total**, to the cent,
- and that has not been voided or reversed.

`settled` means the money reached the merchant account. `captured` means it is collected and settles
overnight. Both earn the check; the tooltip says which. Anything else is `failed` and earns a warning
instead.

## Why ask twice

Checkout verifies under time pressure: the customer is waiting and there is one provider call to go
on. This runs afterwards, as often as it needs to, and keeps asking a captured payment until the
money has actually settled — which is the only point at which a capture can no longer fail.

The cases it catches are the ones checkout cannot: a capture that later turns into a settlement
error, a transaction voided after the fact, an order marked paid against a payment that is not
actually there, and an amount that does not match the order.

## The third alert

A failed verification posts one message to the Telegram group naming the order and what is wrong.

This is deliberately a third interruption, against the two-alert rule set on 27 Oct, because the
owner chose it when asked: *"Ping me — it's money."* It is capped at **one message per order, ever**.
A payment that keeps failing is the same news each time, so it is only said once; if it later comes
good, the order quietly earns its check with nobody told again.

## What it never does

- **Never changes an order's status.** It writes one field.
- **Never touches `updated`.** That column is the grace period automatic label purchase measures
  from, so verifying an order must not postpone its parcel.
- **Never turns a provider outage into a verdict.** Unreachable records nothing and alerts nobody: a
  wrong red flag on a good payment is worse than asking again in a few hours.
- **Never asks about** unpaid, internal-test, refunded, or more-than-60-day-old orders, or orders
  belonging to a different payment environment — checking a live order against sandbox credentials
  would answer the wrong question convincingly.
- **Never questions settled money again.** Once settled, an order is finished.

## Cadence

Re-checked every 6 hours until settled. Eight orders per run, newest first.

## Verification

- `npm run check:release` — TypeScript and 105 isolated suites.
- `tests/payment-verify-v1.cjs` runs the real job against isolated SQLite with the provider and chat
  stubbed, and runs the **real** Authorize.net classifier end to end for the amount rule: a cent
  short, a larger capture, another invoice, a refund, a void and an unapproved response all fail.
  Mutation-checked: treating a failure as confirmed, dropping the once-only alert guard, recording a
  verdict on an outage, or re-checking settled orders each fail the suite.
- Live: open the Orders queue after the next run and confirm paid orders carry a check.
