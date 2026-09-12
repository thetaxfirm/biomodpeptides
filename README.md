# Biomod Peptides custom storefront

A custom React storefront following the observed Crush Research shopping layout, using 50 real Biomod products, the approved Biomod brand graphics, and published Biomod laboratory documents. There is no WooCommerce or WordPress runtime integration. Source URLs are retained only as provenance and original public certificate links.

## Working storefront

- Responsive homepage, catalog search, category/availability/size/price filters, sorting and grid/list views.
- Product details, quantities, price per mg where the labeled unit supports it, wishlist and cart drawer.
- Fixed single-product 1/3/5/10-vial packs with complete pack totals, per-vial and per-mg pricing on product cards and detail pages. Separate 1/3/5/10 mix-and-match selector with horizontal slots and 0/10/15/20% discounts.
- Seventeen sourced compound/strength/form price comparisons. Singles match Crush where Biomod was higher; existing lower prices remain. Fixed packs use the lower of the matched Crush tier and standard bulk pricing, with non-increasing per-vial prices. Unmatched singles stay unchanged. Sources and applied values: `docs/crush-pricing-v2.json`.
- Durable guest cart/wishlist and customer-owned account records using Cloudflare D1.
- Testing library for 50 products, 26 linked certificate PDFs, source-reported results, lot-mismatch handling, search, filtering, and PDF viewing controls.
- Account screens for profile, addresses, orders, wishlist, rewards, applications and notifications.
- Presale campaign creation, opening/closing dates, separate carts and cumulative customer limits.
- Administrator allowlist, product price/inventory controls, pack discounts, shipping settings, campaigns, customer requests, order fulfillment and manual Chase reconciliation.
- Support/application requests persist for administrator review; automated email delivery is not configured.

## Connections still required before public commerce

The preview does not accept payments or fabricate signed-in accounts, purchases, rewards, certificates or presale campaigns. Supabase managed authentication is implemented through its HTTP API and requires the configured project, verified email delivery, approved redirect URLs, and Google configuration if enabled. Private preview access through Sites is separate from storefront customer accounts.

Chase uses the J.P. Morgan Checkout hosted payment adapter. Confirm that this is the merchant's actual Chase gateway product before configuration; a Chase bank account alone is insufficient. Supply merchant configuration securely through hosting secrets. Never put credentials in source, issue descriptions, chat, or documentation. Set the registered return URL to the deployed site's `/payment/return` route. Sandbox certification must precede live enablement.

Tax calculation currently has a TaxJar HTTP adapter and requires the merchant's origin and tax account configuration. Standard shipping cost is unset; the verified public free-shipping threshold is $200. Verify actual inventory quantities, policy language, tax settings and fulfillment before enabling `COMMERCE_MODE=live`. No unverified inventory can be sold.

Orders reserve stock atomically in SQLite. A unique active attempt per customer prevents duplicate checkout creation after reloads. A quote receipt binds the reviewed cart, address and total. The initial order stores the deterministic Chase reference and environment before the intent request. Uncertain responses and failed payment attempts remain under review with stock reserved. Only authenticated Chase notification verification can mark payment paid. Payment captures and notification identifiers are unique. Fulfillment requires verified payment.

A production reconciliation schedule, confirmed cancellation/expiry workflow, refund processing, reward earning/redemption rules, automated affiliate attribution/payouts, coupon programs, and email delivery require further business configuration and implementation. They are not represented as live functionality. The observed logged-in Crush checkout was not accessible, so exact backend parity is not claimed.

## Local development

Node 22.13+; install with `npm run install:ci`. Use port 3056 or another available non-Jarvis port. Port 3000 is reserved for Jarvis on this Mac. The dev server uses local D1. Apply generated SQL in `drizzle/` before exercising stored data. Hosting packages and applies these migrations to the Site-managed binding. Do not create tables at request time.

- `npx tsc --noEmit`
- `python3 tests/inventory-v1.py` uses isolated in-memory SQLite.
- `node tests/payments-v1.mjs` uses isolated notifications and no network.
- `python3 tests/packs-v2.py` verifies fixed and mixed totals, price authority, pack validation and sourced competitive schedules.
- `python3 tests/http-v1.py` targets only `http://localhost:3056` and never submits an order.
- `npm run build`

Secret key names, without values, are documented in `.env.example`. Local `.env` is ignored. Site-owned IDs and logical binding declarations are in `.openai/hosting.json`.
