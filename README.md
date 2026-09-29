# Biomod Peptides custom storefront

A custom React storefront with an original Biomod campaign, using 45 real Biomod products, approved brand graphics, source-grounded product descriptions, and published laboratory documents. There is no WooCommerce or WordPress runtime integration. Source URLs are retained only as provenance and original public certificate links.

## Search and imagery update

- Added three labeled AI product illustrations, product-gallery controls and a sourced Locations page in navigation.
- Replaced generic slogans and removed raw promotional source descriptions from the public catalog/API.
- Added server metadata, canonical URLs, sitemap/robots routes, structured data, real 404s and protected search-publication controls. Preview indexing remains disabled. See `docs/seo-publication-v7.md` for configuration, source conflicts and review requirements.
- Verify with `node tests/seo-v7.cjs` and `python3 tests/seo-http-v7.py` against the local preview.

## September 2026 redesign

- Original black and bronze campaign image generated from real AZURE, BPC-157 and FORGE product graphics. Collection routes, product presentation, mobile selectors and testing library rebuilt for Biomod.
- Compound identities visible and searchable across shop, pack builder and product details. Editorial provenance and unresolved source conflicts are retained in `lib/product-editorial-v1.json`.
- Up to four products can be compared by compound, format, contents, documentation and 1/3/5/10 pack pricing.
- Named packs persist in D1 for the guest shopping session or signed-in customer. Load, edit, save a copy, remove and download selections. Updates and deletion enforce owner isolation; guest selections transfer to the customer on sign-in.
- Product batch records include original certificates, matching-lot status, copyable links and downloadable QR codes. Twenty matching-lot PDFs, six lot mismatches and twenty-four missing PDFs are distinguished. No verification claim is inferred from a mismatched document.
- Paid, shipped and delivered orders can be reordered at current validated prices and quantities. No actual orders were fabricated for verification.
- Checkout, account and guest restock states have useful routes when external services are not configured; unavailable carts can be cleared safely.

## Working storefront

- Responsive homepage, catalog search, category/availability/size/price filters, sorting and grid/list views.
- Product details, quantities, price per mg where the labeled unit supports it, wishlist and cart drawer.
- Fixed single-product 1/3/5/10 packs across 26 peptide, 8 softgel and 10 spray products. Peptides count vials; softgels and sprays count complete bottles. Pack totals and per-vial/per-bottle prices appear on cards and detail pages, with per-mg pricing only for applicable peptide vials. Separate 1/3/5/10 mix-and-match selector covering all three product categories with horizontal slots and 0/10/15/20% discounts.
- Seventeen sourced compound/strength/form price comparisons. Singles match Crush where Biomod was higher; existing lower prices remain. Fixed packs use the lower of the matched Crush tier and standard bulk pricing, with non-increasing per-vial prices. Unmatched singles stay unchanged. Sources and applied values: `docs/crush-pricing-v2.json`.
- Durable guest cart/wishlist and customer-owned account records using Cloudflare D1.
- Testing library for 45 products, 21 linked certificate PDFs, source-reported results, lot-mismatch handling, search, filtering, and PDF viewing controls.
- Account screens for profile, addresses, orders, wishlist, rewards, applications and notifications.
- Presale campaign creation, opening/closing dates, separate carts and cumulative customer limits.
- Administrator allowlist, product price/inventory controls, pack discounts, shipping settings, campaigns, customer requests, order fulfillment and manual Chase reconciliation.
- Support/application requests persist for administrator review; automated email delivery is not configured.

## Authorize.net payments

`PAYMENT_PROVIDER=authorizenet` (the default) uses Authorize.net Accept Hosted. Card details are typed only on Authorize.net's hosted page; this server never receives them. The Chase adapter remains available with `PAYMENT_PROVIDER=chase`.

- Checkout saves the order and reserves stock, then sends the customer to `/api/store/pay?id=…`. That page requests a fresh single-use hosted-form token and posts the customer to Authorize.net. Before it issues a token, it checks Authorize.net and refuses when a capture or fraud-review hold already exists. `duplicateWindow` is set to 8 hours.
- The invoice number is a stable 20-character hash of the order ID (`lib/authorizenet-payments.ts`).
- An order is marked paid only after an authenticated `getTransactionDetails` read shows an `authCaptureTransaction` for this invoice, with response code 1, a captured or settled status and the exact order amount. Two captures, an amount mismatch, auth-only transactions or refunds go to review.
- Webhook: register `https://trybiomod.com/api/payments/authorizenet` in Merchant Interface → Account → Webhooks for the `net.authorize.payment.*` events. Signatures are verified with HMAC-SHA512 using the Signature Key. The payload is treated only as a hint, and status is always re-read from the API. Declines leave the order open so the customer can try another card.
- Customers and admins can also press *Verify payment*. That searches unsettled transactions, and settled batches for orders older than one hour.
- Secrets: `AUTHORIZENET_API_LOGIN_ID`, `AUTHORIZENET_TRANSACTION_KEY`, `AUTHORIZENET_SIGNATURE_KEY`. Settings: `AUTHORIZENET_ENVIRONMENT` (`sandbox`/`live`) and `AUTHORIZENET_RETURN_URL` (`https://trybiomod.com/payment/return`). Set `AUTHORIZENET_CONNECTION_VERIFIED=true` only after a sandbox test purchase succeeds, and set `COMMERCE_MODE` to match the environment. Live mode also requires `COMMERCE_FULFILLMENT_VERIFIED=true`.
- Test: `node tests/payments-authorizenet-v1.mjs` (no network).
- Not automated: refunds and voids after payment are handled in the Authorize.net Merchant Interface, and an admin updates the order.

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
- `python3 tests/bottle-packs-v3.py` verifies every softgel and spray pack total.
- `python3 tests/saved-packs-v6.py` verifies durable saved selections, owner isolation, update/delete, invalid selections and CSRF.
- Build with the installed Sites `scripts/build-site.mjs` helper.

Secret key names, without values, are documented in `.env.example`. Local `.env` is ignored. Site-owned IDs and logical binding declarations are in `.openai/hosting.json`.

## Catalog withdrawal controls

Five withdrawn listings, their product images and complete certificate records are excluded from published data. Cart, wishlist, saved-pack and presale paths use current product IDs; retired order product snapshots are projected as archived items while financial ledgers remain intact. Existing checkout links cannot be reissued for unavailable products. Server response projections remove withdrawn references from saved free text. The original legacy WordPress server is separate and requires authenticated administration for source-file removal.

Validation: `node tests/catalog-removal-v8.cjs`, `python3 tests/catalog-removal-http-v8.py`, the pack and SEO checks.

## Custom-domain launch v16

Source is now private at https://github.com/thetaxfirm/biomodpeptides.
The Cloudflare runtime and D1 storage are deployed in the shared Cloudflare account that also owns biomodpro.com:
https://trybiomod.com and https://www.trybiomod.com

`trybiomod.com` registration was moved into the shared account on September 19, 2026. It had no DNS records or enabled DNSSEC before the move. Both custom hostnames are configured on the `biomod-peptides` Worker. Existing preview D1 data was copied into the shared account's database before deployment. The previous deployment at https://biomod-peptides.biomodcompounds.workers.dev remains available as a fallback, with its separate database.

`biomodpeptides.com` remains separate and uses dns-parking.com nameservers; it has not been changed.

Publish updates from an authenticated Cloudflare CLI session:

```sh
BIOMOD_DEPLOY=true npm run build
npx wrangler d1 migrations apply biomod-peptides --remote --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json
```

`COMMERCE_MODE=preview`: payment and customer sign-in remain unconfigured. Source control is on GitHub; automatic Cloudflare builds are not configured yet. Hosting currently remains on Cloudflare because this code uses its Workers and D1 APIs, not Vercel's Node runtime.
