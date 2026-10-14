# Carrier tracking fail-safe, October 14, 2026

Scope: trybiomod.com only. Author: Claude, at the owner's request ("i want to write a trigger feil safe as well for the marked as shipped orders button, i want the system to automatically track each order and if its scanned into usps or what ever shipping company the momment it updates in their system i would like it to show the travking status next to the order as well ask automatically mrked it as shipped if i or and employee forgets to mark it").

## Why

Automatic marking already existed. `app/api/shipping/easypost/route.ts` verifies the EasyPost webhook signature, filters to production `tracker.updated` events, records the carrier status on the order and moves paid to shipped on the first scan and to delivered on delivery. `/api/admin/shipping` reports `webhookConfigured: true, webhookRegistered: true` in production, so that path is live.

Two things were missing. A webhook that never arrives — provider outage, a delivery EasyPost retries past its window, an event dropped during a deploy — left an order sitting in To ship forever with no second chance. And nothing the carrier said was visible in the orders table, so staff could not tell a package already scanned from one still on the bench.

## Behavior

A sweep runs on the existing five-minute cron. It selects orders that are paid or shipped, carry a shipment id and tracking number, are not already in a settled carrier state (delivered, return to sender, failure, cancelled), and whose last carrier observation is older than the recheck window. Internal test orders are excluded. It reads each tracker from EasyPost and applies the same transition the webhook applies, so both paths agree: delivered moves paid or shipped to delivered; in transit, out for delivery or available for pickup moves paid to shipped. Nothing is written when the status has not changed.

Two settings bound it: `TRACKING_RECHECK_MINUTES` (default 180, clamped 15 to 10080) and `TRACKING_RECHECK_LIMIT` (default 15, clamped 1 to 100). Orders are taken oldest-observation first, so the batch cap delays a check rather than skipping one.

Writes are guarded. The update matches on both the order id and the stored shipment id, and refuses to overwrite an observation newer than the one it read, so a webhook that lands mid-sweep wins. One carrier read failing does not stop the rest of the batch. The sweep runs under its own audit identity ("Carrier tracking sweep", system actor), so change history separates it from staff action and from the webhook.

In Admin > Orders the status cell now shows the carrier's own words under the bucket badge — "in transit", "out for delivery", "delivered" — with the time that status was last confirmed. It is empty until a label exists. The manual "Mark shipped" button is unchanged; this only means staff forgetting it no longer leaves the order wrong.

## Verification

- `npm run check:release`: TypeScript and 77 isolated suites. New `tracking-sweep-v1.cjs` covers setting bounds and clamping, paid to shipped, paid and shipped to delivered, skipping orders that are recent, settled, unlabelled or internal tests, one carrier failure isolated from the rest of the batch, no write when the status is unchanged, a newer stored observation preserved, and the batch cap honoured. It runs against an isolated `node:sqlite` database shaped like D1 with EasyPost stubbed; no live provider is contacted.
- `change-history-system-v1.cjs` updated: the scheduled dispatch assertion now expects four jobs and asserts the sweep receives its own audit-wrapped environment rather than the raw one.
- `lib/tracking-sweep.ts` deliberately does not import `./runtime`, so it loads outside the Worker and the suite exercises the real module rather than a copy.

## Affected

`/admin?tab=orders` status column; the `*/5 * * * *` scheduled handler in `worker.ts`. Read-only against EasyPost. No migration, no schema change, no new route, no customer-facing change, no product, price or credential change. The existing webhook is untouched and remains the fast path.

## Release

Source on main: 5bc0fcf (sweep, worker job, suites, gate) then 8e50bca (carrier status in the queue), fast-forward onto fb7469b with no collaborator commits to preserve. The gate was re-run against the exact pushed bytes: TypeScript and 77 suites passed. Cloudflare Workers Builds deploys every push to main.

Live read-only checks after deploy: `/` and `/checkout` return 200, `/admin` redirects to sign-in (307), `/api/admin/shipping` returns 403 "Administrator sign-in required." when signed out. No order was modified by this verification.

Gap: the sweep's first production pass has not been observed. It only acts on orders that already have a bought label and have been silent longer than the recheck window, so the first visible effect is a carrier status line appearing under the badge in Admin > Orders for parcels already in flight. `TRACKING_RECHECK_MINUTES` and `TRACKING_RECHECK_LIMIT` are unset in production and therefore at their defaults, 180 minutes and 15 orders per run.
