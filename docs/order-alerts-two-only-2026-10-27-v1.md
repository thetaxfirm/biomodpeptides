# Two alerts, and no others — 27 Oct 2026

## What the owner asked for

> "I want the flow of the website to only ping us for a new order that has been paid for... only two
> times I get pinged: after a verified paid and collected order comes in, and a notification if an
> order hasn't moved in 4 days."

## What was already true

Both halves of the first request were already the behaviour, and it is worth writing down so nobody
re-fixes it:

- **The order alert already waits for the money.** It fires in exactly one place — `reconcile()` in
  `lib/checkout.ts`, on the single status write that first marks an order paid. Authorize.net runs
  `authCaptureTransaction`, and only `capturedPendingSettlement` or `settledSuccessfully` count as
  paid, so "paid" means captured, not authorised. A paid result without both a provider reference and
  a notification id is refused as `review` instead. Once per order, never at checkout.
- **Auto-label already waits for the same thing.** `runAutoLabels` only selects `status='paid'`, and
  that status is only ever reached through the verified path above.

## What changed

- **One rule for the daily digest.** It used to carry four thresholds: unscanned after 1 day,
  unshipped after 48 hours, no carrier update after 4 days, and carrier problems. It now names orders
  that have shown **no forward progress in four days**, whatever stage they stopped at —
  `shipment.checkedAt`, else `labelCreatedAt`, else `paidAt`, else `created`. One number to remember.
- **It reaches the phone.** The digest posts a single line to the same Telegram group as the paid-order
  alert (count plus the admin link). The list stays in the email. One push a day at most, and a chat
  failure never decides whether the email is sent.
- **The unanswered-reply email is no longer scheduled.** `overdueCustomers` still feeds the admin Today
  screen, so the information waits to be looked at rather than interrupting. Re-adding
  `runOverdueDigest` to the worker cron turns the email back on.
- **Carrier problems are still named without waiting.** A parcel the carrier is returning has not
  stalled, it has failed, and holding that for four days would not make it less true. It rides in the
  same daily message, so it adds no new interruption.

## Not changed, and why

**Website-message alerts** (one email per contact-form submission) are controlled by the `notifyTo`
address in Settings → Requests → *Email controls and delivery history*. Clearing that field turns them
off; the code already treats an empty `notifyTo` as "do not alert".

Hard-coding the removal was tried and backed out. The outbox delivery machinery — leases, retries,
daily caps, idempotency keys, worker concurrency — is exercised end to end through the request-alert
path in `tests/coa-delivery-v1.cjs`, because direct COA sending is already retired. Retiring the alert
in code would have deleted the only coverage of machinery that still exists. Using the switch the
feature already has is the smaller, reversible change.

## Verification

- `npm run check:release` — TypeScript and the full isolated suite set.
- `tests/shipping-protection-v1.cjs` covers one stalled order per stage (no postage, bought but never
  scanned, on hold, quoted above the limit, unreadable at the provider, dropped off but never scanned),
  proves everything inside four days stays silent, and pins the worker cron against the retired email.
  Mutation-checked: moving the threshold to three or five days fails the suite.
- `tests/telegram-alerts-v1.cjs` covers the shared sender, including that a push which would say
  nothing is never sent.
- Live: wait for the next 9 a.m. Pacific run, or place a test order and confirm one alert.
