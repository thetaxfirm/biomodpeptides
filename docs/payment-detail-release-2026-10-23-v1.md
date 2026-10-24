# Payment detail and held-payment decisions, release log v1

- Date: 2026-10-23 (Pacific). Author: Claude (owner request: "this screen does not give enough information", "we need to have access to this through api").
- Source commit: 8a55931 on main. Cloudflare Worker biomod-peptides version c605f784, deployed 2026-10-24 04:58 UTC.
- Files: lib/payment-check.ts (new), lib/authorizenet-payments.ts, lib/payments.ts, lib/checkout.ts, app/api/store/[action]/route.ts, app/api/payments/authorizenet/route.ts, components/store/orders-admin.tsx, tests/payment-check-v1.cjs (new, in release gate), tests/change-history-system-v1.cjs, tests/orders-dropped-off-v1.cjs.

## What changed
- Check payment saves each Authorize.net card attempt on the order (data.paymentCheck): status in plain words, card type and last 4, amount, time, AVS and CVV results, the fraud filters that flagged it (FDSFilters), and the 5-day hold deadline. No IP or full card data.
- Webhook saves declines on the order without changing its status.
- Unpaid and Needs review rows show the reason; the order panel lists every attempt and what to do.
- Owner-only Approve payment / Decline (admin-payment-hold, not in adminActionPermission) calls updateHeldTransactionRequest only for a transaction on that order's invoice that is still held, records attempted/succeeded/failed in change_events, then re-checks the order.

## Checks
- npm run check:release: TypeScript and 100 isolated suites passed.
- Live: trybiomod.com 200; the new Orders panel text is in the live client bundle.

## Gaps
- Signed-in check not done by Claude (needs the owner's sign-in). Saved payment detail appears only after Check payment is pressed again on an order.
- Authorize.net webhook subscriptions are an account setting; held payments do not move orders by themselves unless the fraud "held" event is subscribed.
- Approve/Decline has not run against live Authorize.net yet; its first use will be the owner's.
