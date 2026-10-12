# Configurable checkout shipping, October 12, 2026

Scope: trybiomod.com only. Owner requested overnight at the carrier price plus $10 and editable shipping settings. Base source: 02329da1b71cfdfae1193c194e39e742371f8395. Codex implementation; no collaborator changes replaced.

## Behavior

Customers receive the cheapest eligible real carrier service in each enabled tier: Standard, Expedited and Overnight. Each choice shows its carrier/service, available transit estimate, total shipping charge and any handling fee. Changing the choice recalculates tax and the total server-side. Quotes remain bound to the owner, cart, address and promotion and expire ten minutes after the original quote. Stale responses cannot restore an earlier account or cart selection.

Admin > Settings controls enabled tiers, allowed USPS/UPS/FedEx carriers, each handling fee, the free-standard threshold and an optional standard fallback. Carrier selection permits rates from an already connected account; it does not activate an account. All delivery tiers may be deliberately disabled, with a warning. At least one carrier is required. Existing settings editors that omit the new settings preserve the current values.

Default overnight handling is $10; standard and expedited handling preserve legacy configured fees (zero when absent). Existing production standard fallback ($15) and free-standard threshold ($200 after discounts) are preserved. Free standard never makes expedited or overnight free. No flat overnight rate is invented when a provider does not return an eligible service. Estimates start after dispatch; preorder availability, holidays and carrier cutoffs still apply.

The selected carrier, service, tier and charge are saved with the order. Label buying must match that service and tier, including USPS Express one-day versus two-day estimates. A missing match stops the purchase instead of downgrading to ground. Existing paid orders keep their recorded charges/service. Historic generic free/standard orders use an eligible Standard service. Recovery discounts preserve saved shipping. Customer order views, administration and existing receipts show the saved service.

Public header, product/cart copy, FAQs, shipping policy and merchant structured data follow current shipping settings. Migration 0022 extends the sanitized settings history projection; it does not rewrite settings, orders or prior audit events.

## Verification and release evidence

Isolated suites cover actual checkout selection/lifecycle, server quote binding and expiry, USD/production carrier rate validation, service classification, free-standard boundaries, settings validation and preservation, payment amount, exact-service label matching, recovery preservation, public policy/schema and audit privacy. A built Worker fixture intercepts every external provider and uses synthetic local data; no real payments, labels, customer emails or production orders are created by tests.

Production read-only baseline: 2026-10-12T22:14:37Z; previous Worker f8fb68c2-aaa0-4148-9e5f-e4772ff14386. Existing EasyPost API access and registered webhook were confirmed in authenticated administration at 22:14:31Z. This alone does not establish funding, production mode or availability of overnight to a particular address.

Local gated production build passed TypeScript and 53 isolated suites. The exact built Worker regression also passed. Browser verification on the isolated built app confirmed Standard $9, Expedited $15 and Overnight $35 ($25 carrier + $10 handling), with an existing BIOMOD15 discount preserved. Selection changed the full total from $193.24 to $219.24. Changing the test-only overnight fee to $12.50 and disabling Expedited persisted through Admin reload and produced only Standard and Overnight $37.50 in the next checkout quote. These are synthetic fixture prices, not live carrier prices.

Final commit, tested source, deployment and live checks are recorded in the versioned shipping release receipt outside the source repository. Do not describe a provider quote, postage purchase, carrier acceptance or inbox delivery as verified without its own evidence.

## Affected pages and data

- /checkout, /cart, /account/orders
- /admin?tab=settings and /admin?tab=orders
- /, /shop and product pages; /faq; /shipping-policy; merchant schema
- /api/store/delivery, /api/store/checkout, /api/store/admin-config; /api/admin/shipping
- Audit settings projection only in migration 0022

No product price/stock, publication hold, historical order, role, credential, hosting setting or email configuration is changed by this release.
