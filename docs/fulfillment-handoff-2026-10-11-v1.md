# TryBiomod fulfillment handoff correction

Author: Codex. October 11, 2026 Pacific. TryBiomod only.

## Confirmed problem

The prior label endpoint immediately changed a paid order to `shipped`, wrote `shippedAt`, and sent customer copy saying the parcel was on its way. EasyPost label creation only supplied `pre_transit`. Neither action established that the Las Vegas store team packed or mailed the parcel. The owner identified that team as the physical fulfillment owner.

Production metadata inspection confirmed that `EASYPOST_API_KEY` and `EASYPOST_WEBHOOK_SECRET` secret bindings exist. Values were not read or logged. Presence is not proof of valid credentials, webhook delivery, carrier acceptance or an arranged pickup. The carrier dashboard requires owner sign-in. The team's notification destination is still awaiting the owner's response; this release does not change recipients or permissions.

## Changes

- Label purchases retain payment-confirmed state, write `labelCreatedAt`, and send tracking information without claiming dispatch.
- Existing stored order records are not rewritten. Admin, customer order history and payment-return screens share delivery wording that distinguishes label creation, manual store confirmation and carrier-reported movement.
- Admin Orders includes a Las Vegas fulfillment review queue with links to each loaded order. Payment-pending records are excluded. Historical tests must be reviewed before fulfillment; the queue does not assert every payment record is a customer sale.
- Protected carrier connection check uses read-only EasyPost account/webhook calls. It exposes no credentials or account identifiers and does not claim successful webhook delivery.
- Each labeled order can request a fresh carrier status. It verifies production shipment identity and updates only shipping state; it never buys another label or sends an email.
- Signed tracking events require production mode, the matching shipment and tracking identifiers, and valid status/time. Older observations cannot replace newer checks. Carrier movement promotes paid orders to shipped; carrier delivery promotes them to delivered.
- Tracking-email feedback now distinguishes provider acceptance from inbox delivery.

Affected routes: `/admin?tab=orders`, `/account/orders`, `/payment-return`, `/api/admin/shipping`, `/api/shipping/easypost`. Customer views receive only carrier status/check time in addition to their existing tracking field; label URLs remain administrator-only.

## Verification

- TypeScript and 33 isolated release suites passed via `BIOMOD_DEPLOY=true npm run build`.
- `tests/fulfillment-v1.cjs`: real route/helper/queue, in-memory database and mocked providers; paid-state preservation, duplicate-label rejection, truthful email, authorization/origin guards, read-only refresh, identity checks and signed transitions.
- `tests/fulfillment-worker-v1.mjs`: actual built Worker and isolated D1, mocked authentication/carrier GETs, no live email/payment/label purchase.
- Desktop browser preview used actual shipping components and synthetic order data. Connection/status buttons produced simulated feedback. Mobile viewport override did not yield reliable narrow-viewport evidence and remains unverified.
- Existing promo/account/admin regressions remain in the required release gate.

No production order, payment, label purchase, shipment, email or pickup was created by this release verification. No historical emails were resent. No team member was granted access.

## Release boundaries

This source must deploy before it is described as live. Record the resulting commit/version in the private release evidence. No schema or binding change is required. The separate visitor-dashboard draft and collaborator inventory drafts remain untouched in their original checkout and are not included.

Still required: owner sign-in to the existing EasyPost account, confirmation of the Las Vegas team inbox/access, live carrier and webhook verification, and an actual pickup/drop-off arrangement after packing. A carrier integration does not pack a box. No pickup booking or recurring charge is authorized by this code change.

Provider references: https://docs.easypost.com/docs/trackers ; https://docs.easypost.com/docs/pickups ; https://docs.easypost.com/docs/webhooks .
