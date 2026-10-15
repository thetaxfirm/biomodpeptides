# Shipping hardening: ten fixes, October 15, 2026

Scope: trybiomod.com only. Author: Claude, at the owner's request ("fix all problems", "All ten, one release"), with the two limits chosen by the owner: **$50 the most to spend on one automatic label**, and **48 hours before an unscanned label is called stalled**.

## Why

Automatic label purchase went live earlier the same day. A full diagnostic of the shipping path afterwards found ten things worth fixing before the store runs unattended for long. Four are about money or an order going quiet; three are about who can see customer details; three are about the queue telling the truth.

## What changed

**1. Unreadable settings no longer mean "use the defaults."** `settingsRow()` returns `null` when the settings row cannot be read, and the job treats that as a reason to stand down, not a reason to fall back to enabled. A database hiccup could previously resurrect a job the owner had switched off, and start spending.

**2. A ceiling on any one automatic label.** Default $50, configurable under Settings > Shipping, bounded $1–$1000 in the form and again on the server. The rate is compared against it *before* the buy call, so nothing is charged. A person clicking Buy is never stopped by it — the limit is for the robot, and the ceiling is only passed on the unattended path. This is what catches a mistyped address that quotes a freight rate.

**3. An order the carrier keeps refusing stops being retried.** Failed attempts are counted on the order (`labelAttempts`, so the count survives a restart). At the limit (default 3) the order is put on hold with a plain note and moves into Needs review. A hold takes it out of the automatic queue, so nothing retries it in silence. A successful purchase clears the count.

**4. A label the carrier never scans is surfaced.** After 48 hours with no carrier scan, an order with a bought label moves to Needs review. Automatic purchase makes this failure likelier, because nobody handled the order by hand and noticed the parcel still on the bench. A corrupt or missing purchase time never raises a stall.

**5. A returned parcel no longer hides in Delivered.** `return_to_sender`, `failure`, `cancelled` and `error` now outrank a delivered status in the queue: a parcel delivered back to us is a return and a refund, not a completed order. A clean delivery still reads as delivered, and a hold still never hides a delivery that already happened.

**6. The order queue is a POST.** The admin search term is a customer's email, phone or street address, and it was travelling in a query string — written into every proxy log, access log and browser history in front of the app. The queue now reads its parameters from the request body. The GET name answers old bookmarks with a 405 and reads no orders. The queue is gated on `orders:read` through the same permission map as every other admin POST.

**7. An authentication failure is no longer relayed as a 400 with its reason.** On `/api/admin/shipping` the staff check now runs outside the try, returning a flat 403 "Administrator sign-in required." Before, the internal reason was relayed to the caller, which told any signed-in customer whether they were staff and which permission they lacked.

**8. A stale order edit is refused instead of silently overwriting.** The admin order write now matches on the status it read, and reports "This order changed while you were working on it" when nothing was updated, rather than writing over a colleague's change.

**9. `app/chatgpt-auth.ts` is deleted.** It trusted `oai-authenticated-user-id` and `oai-email` request headers — values a caller sets freely — as proof of identity. Nothing imported it. Dead code that would have been a complete authentication bypass if ever wired up.

**10. Both scheduled jobs now report their health, and the admin shows it.** Automatic purchase and the backup tracking sweep each write what their last run did, with a status. Settings > Shipping shows the automatic-label line; the EasyPost connection check shows the sweep line. Both say "may have stopped" when the last report is older than 30 minutes, because the jobs run every five, **and a job that never runs produces no errors at all — silence reads like success.** The lines distinguish working, switched off, limit reached, could-not-read and stopped. A missing report says so plainly rather than looking like a failure.

A smaller one, alongside 2: a per-label ceiling submitted by an older admin page that omits it keeps the saved value rather than resetting it.

## Settings

Two new fields under Settings > Shipping, in the automatic-purchase block: **Most to spend on one label ($)** (default 50) and the automatic-run health line. The existing switch, wait and daily limit are unchanged. The retry limit (3 attempts) and the 48-hour stall window are not exposed in the form; they are environment-overridable (`AUTO_LABEL_MAX_ATTEMPTS`, `AUTO_LABEL_MAX_LABEL_CENTS`).

## Verification

`npm run check:release`: TypeScript and 86 isolated suites, all green. Beyond the gate, `tests/shipping-services-worker-v1.mjs` and `tests/shipping-options-worker-v1.mjs` were run against a production build on local D1 — both pass.

New and extended coverage:

- `tests/auto-label-v1.cjs` — unreadable settings stand the job down and record why, with the order untouched; the ceiling is handed to the purchase and an over-ceiling rate is refused while an ordinary one is not; repeated failures count up, hand the order to a person at the limit, and the hold then takes it out of the automatic queue; a successful purchase clears the count; health is readable after a run, after a disabled run, and returns null rather than throwing when unreadable.
- `tests/easypost-v1.mjs` — the real ceiling check: a refused label never reaches the buy endpoint, a rate under the ceiling buys as usual, and a purchase with no ceiling (a person) is never stopped.
- `tests/orders-queue-v1.cjs` — return-to-sender after delivery reaches Needs review while a clean delivery does not; a label stalled past 48 hours reaches Needs review while a fresh one, a moving parcel, an arrival, an order with no label and a label with no recorded purchase time do not; the retired GET reads no orders and the POST queue is permission-gated with the search term in the body.
- `tests/admin-shipping-services-ui-v1.cjs` — the ceiling's bounds and exact cents; a page that never collected it leaves the saved value alone; every health line, including that a stale report never reads as a healthy run.
- `tests/shipping-services-worker-v1.mjs` — against the built Worker: the limits are stored as submitted, an omitted ceiling keeps the saved one while the submitted change still applies, out-of-range values are refused and change nothing, and the health report travels with the panel.
- `tests/easypost-admin-ui-v1.cjs` — the backup-sweep line in each of its states.
- `tests/change-history-shipping-v1.cjs` — the 403 is flat and the internal reason is never relayed; no event is recorded and no provider is called on a refused request.

Live verification is still required after deploy.

## Not done

- `tests/coa-shipping-worker-v1.mjs` fails, and failed before this release: it asserts the COA-before-shipping rule still blocks a label, and the owner turned that rule off on October 14 (`COA_REQUIRED_TO_SHIP = false`). It is deliberately not in the release gate. Its call to the retired GET queue was updated here so that is not a second, hidden failure; the COA expectations were left alone for a decision about whether that suite is retired or rewritten.
- The real signature-confirmation fee has not been measured against a live label. If it is larger than expected, the $500 daily cap may want revisiting.
- International shipping (country allow-list, per-product customs fields) is still not built, and UPS returns no rates in the live check — neither was investigated here.
