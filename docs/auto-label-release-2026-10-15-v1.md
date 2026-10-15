# Automatic label purchase, October 15, 2026

Scope: trybiomod.com only. Author: Claude, at the owner's request ("i just want it to auto do it once the customer buys the order and i just download it"), with the grace period and daily limit chosen by the owner: 20 minutes, $500 a day.

## Why

Nothing was automatic. "Buy shipping label" was the only way a label was ever bought, and an earlier design for automating it was never built. A full diagnostic of the shipping path first turned up two defects that had to be fixed before a scheduler could be trusted to spend money unattended:

1. **`labeling` was a terminal state.** The purchase claims the order by setting `status='labeling'`, and only two statements in the codebase moved it back — both inside the same request. If the save failed after EasyPost returned a label, the order sat in `labeling` forever: the queue showed it as "Label bought", no further label could be bought, it could not be marked shipped, and the purchased label existed only in one HTTP response. Recovery needed direct database access.
2. **A timed-out purchase could be charged twice.** Every carrier call has a 15-second timeout, and an abort after the request was delivered was reported as "EasyPost could not be reached". The order was released back to `paid`, and a retry created a *new* shipment and bought a *second* label. The first label's postage was never refunded. The claim protected against a double click, which is cheap; it did not protect against an unknown outcome, which is not.

A third, smaller: the success write replaced the whole order record from a snapshot taken before the carrier call, so a hold placed during those seconds was silently erased and the order shipped anyway.

## Behavior

**Purchases are now resumable.** The EasyPost shipment is recorded on the order before the buy. Any later attempt — manual retry or scheduled — hands that shipment back, and a shipment EasyPost has already sold is *adopted* rather than replaced. A second label cannot be bought for the same attempt.

**Recovery runs every five minutes, whether or not automatic buying is on,** because a manual purchase strands an order the same way. It asks the carrier about every attempt that reached EasyPost but left no label on the order, whatever the order's status: a sold label is attached to the order, and a claim with nothing to adopt is released so the order is workable again. A claim younger than the stuck threshold (5 minutes) is never touched, so a live request is never interrupted.

**The label write is targeted.** Only the tracking, shipment and timestamp keys are set, and only our own claim is released, so a hold or a carrier status written while the purchase was in flight survives.

**Automatic purchase** runs on the same five-minute cron. An order is bought for when it is paid, has no label, is not on hold, is not an internal test, has an address, and nothing has touched it for the grace period — the clock restarts whenever anyone edits the order, so staff working an order always postpone the purchase rather than race it. A saved shipping option that no longer validates is skipped for a human. Orders are taken oldest first.

Owner settings, under Settings > Shipping: the switch, the wait after payment (default 20 minutes), and the most to spend automatically per day (default $500). The cap counts only labels bought automatically in the last 24 hours — the owner's own purchases never count against it and are never blocked by it. The cap is checked before every purchase, so a run can exceed it by at most one label. At the limit, orders simply wait in To ship. The panel shows what has been spent automatically in the last 24 hours. A per-run limit (10) bounds a single tick, and `AUTO_LABEL_ENABLED=false` is an environment-level stop.

The job runs under its own audit identity, "Automatic label purchase". The customer gets the same tracking email as a manual purchase, carrying the configured reply address; without one configured the mailer refuses to send, so no automatic tracking email goes out rather than one from a wrong sender. A mail failure never undoes a bought label. The COA rule is currently off (`COA_REQUIRED_TO_SHIP = false`); if it is ever turned back on the job stands down rather than judge the rule without today's catalog.

## Verification

`npm run check:release`: TypeScript and 84 isolated suites. New `tests/auto-label-v1.cjs` runs the real module against isolated SQLite with EasyPost stubbed, and asserts on how many times the stub was actually charged. It covers: the agreed defaults and every setting bound; the grace period; the hold, internal-test, already-labelled, unpaid and addressless gates; an unreadable saved option skipped; the daily cap stopping a run, counting only automatic labels, ignoring spend older than a day, and ignoring the owner's own purchases; the kill switch stopping buying but not recovery; **a purchase that was charged but whose outcome was lost being adopted on a later run rather than repeated — one charge, one shipment**; stranded claims released; a claim younger than the threshold left alone; a hold written mid-purchase surviving the save; one failure not stopping the rest of the run; the per-run limit; and the configured reply address travelling with the tracking email.

`tests/change-history-shipping-v1.cjs` extended against the real route: the shipment is recorded before the buy and survives the release, the retry resumes it, the resolved attempt is cleared, and a hold placed while the carrier call was in flight is not erased. `tests/change-history-system-v1.cjs` now expects five scheduled jobs and asserts the new one gets its own audit-wrapped environment. `tests/admin-shipping-services-ui-v1.cjs` covers the new settings in the save payload, including that a save which never collected them leaves the stored settings alone.

No network, no provider calls, no real orders or labels in any suite.

## Affected

`/admin?tab=settings` shipping panel (switch, wait, daily limit, spend to date); the `*/5 * * * *` scheduled handler; `POST /api/admin/shipping` (now resumable, targeted write); `GET/POST /api/admin/shipping-services`. New order fields: `pendingShipmentId`, `pendingAuto` (both cleared once resolved) and `labelAuto`. No migration, no schema change, no checkout or customer-facing pricing change.

## Release

Pushed file by file, each verified byte-identical against the gate-tested copy afterwards. Three of those pushes rebuilt a file from an older copy and reverted someone else's work; each was caught by that verification and restored in the next commit: `lib/easypost.ts` (a collaborator's reply-address hardening in `sendTrackingEmail`), `scripts/release-check.mjs` (three gated suites — request-alerts, request-snapshot, social-preview), and `tests/change-history-shipping-v1.cjs` (the cross-origin assertion). The gate was re-run against main as deployed and passed: TypeScript and 84 suites.

## Gaps

No automatic purchase has yet run against the live carrier. The suites prove how many times the stub was charged, not that EasyPost bills once — the first automatic label should be checked by hand against the EasyPost dashboard, and the 24-hour spend figure in the settings panel compared with the EasyPost account.

Known and deliberately not addressed here, from the same diagnostic: the minimum-service floor can switch carriers and has no price ceiling; a delivered order that the carrier later reports as return-to-sender stays in Delivered and never reaches Needs review; `admin-order` writes the whole order record without a guard and compares a trimmed id against an untrimmed one; auth failures on the label route return 400 with the internal message instead of a generic 403; the order search puts customer emails in a URL query string; and `app/chatgpt-auth.ts` is dead code that trusts client-supplied identity headers and should be deleted.
