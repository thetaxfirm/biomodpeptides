# Shipping v1 release (2026-10-17)

Owner request, Oct 17 2026: let staff see whether a parcel actually left and whether the carrier has scanned it, add insurance and signature rules, and keep the process simple.

## What was already true before this release

EasyPost tracking was automatic: a signed webhook plus a five-minute backup sweep (healthy, last run 10:05 UTC today) move an order to Shipped on the first carrier scan and to Delivered on delivery. The three orders in Label bought on Oct 17 morning showed "unknown" because USPS had not scanned them yet; labels were bought 2:30 to 4:00 PM Pacific on Oct 16.

Gaps found: "Mark shipped" let staff record a shipment the carrier never saw; two older orders are marked Shipped/Delivered with no carrier scan ever recorded; a 48-hour wait before an unscanned label was flagged; no insurance; a signature asked for on every label because the setting was never saved (default applies).

## Change

- **Insurance and signature thresholds (owner sets the numbers).** Admin > Settings > Shipping: "Only on orders of at least ($)" under Delivery confirmation, and "Insure orders of at least ($)". Value = goods after discounts (no shipping or tax). Empty keeps today's behaviour: signature on every order, no insurance. Insurance is bought through EasyPost with the label on the full goods value; the store pays. Insured amount and signature are recorded on the label and shown in the queue.
- **Dropped off replaces Mark shipped** in the queue. It records who and when, changes no status and emails nobody. The carrier's first scan moves the order to Shipped.
- **Tracked parcels cannot be marked Delivered by hand.** Only the carrier's delivery scan does it.
- **Flags for staff:** a label unscanned for 24 hours (was 48) and a parcel with no carrier update for 4 days go to Needs review. Customers still see Preparing shipment or Shipped.
- **Plain carrier wording** in the queue: "Not scanned by carrier yet", "Dropped off 10/17, 2:10 PM", "Not scanned 24h+ · Not dropped off", "No carrier update since ...".
- **Daily parcel alert** at 9 AM Pacific to the order-notify list (ORDER_NOTIFY_EMAILS): unscanned labels (says whether marked dropped off), stuck parcels, and returns/failed deliveries. Nothing is sent when every parcel is moving. Internal only.

Not in v1: USPS SCAN form and pickup booking (one scan accepts the whole day's parcels). Candidate for v2.

## Files

`lib/shipping-options.ts`, `lib/easypost.ts`, `lib/auto-label.ts`, `app/api/admin/shipping/route.ts`, `app/api/admin/shipping-services/route.ts`, `components/store/admin-shipping-settings.tsx`, `lib/fulfillment.ts`, `lib/catalog-visibility.ts`, `app/api/store/[action]/route.ts`, `components/store/orders-admin.tsx`, `lib/parcel-alerts.ts` (new), `worker.ts`. Tests: `tests/shipping-protection-v1.cjs` (new), `tests/orders-dropped-off-v1.cjs` (replaces orders-mark-shipped-v1), updates to `shipping-options-v1`, `change-history-system-v1`, `change-history-shipping-v1`.

## Verification

- `npm run check:release`: TypeScript and 91 isolated suites passed. The new suite runs the real buyLabel against a stubbed EasyPost (insurance on the buy, signature on the shipment, thresholds, unset behaviour) and the real alert job on in-memory SQLite with a stubbed mail provider (fixed clock, once per day, archived/test/fresh parcels excluded).
- `BIOMOD_DEPLOY=true npm run build` passed; built-Worker tests for fulfillment, shipping services, shipping options, COA shipping, checkout expiry and admin overview passed.
- Commit 0761c5a on main. GitHub release-check success; Workers Builds `biomod-peptides` success 10:23:28 UTC; live version aaf2c852.
- Live, read-only: home 200; unsigned `admin-order-handoff` refused ("Please sign in to continue."); unsigned shipping-services refused 403.

## Gaps

- Signed-in clicks (Dropped off, saving thresholds) not run live: needs an owner sign-in.
- Thresholds are empty until the owner enters them, so no insurance is bought yet.
- The first alert email can only be confirmed when it sends (9 AM Pacific on a day with a flagged parcel).

Author: Claude agent for the owner.
