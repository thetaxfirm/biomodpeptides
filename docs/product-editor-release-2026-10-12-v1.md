# Product availability and scheduled-sale editor, October 12, 2026

Scope: TryBiomod only. Owner direction: make products easier to manage by group, provide clear Coming soon and Sold out controls, and show scheduled discounts with their actual prices and countdowns. This release adds controls; it does not select new live prices, stock quantities, sale schedules or preorder terms.

## Behavior

- The protected Products page groups the catalog and provides an inline editor for base price, fixed-pack prices, stock, purchase limit, availability, preorder terms and timed percentage sales. Preview amounts distinguish the base price, amount saved and resulting sale price. Date inputs describe their local-time interpretation; the server saves and validates absolute start/end timestamps.
- Availability is an optional explicit value: Available, Coming soon, Sold out or Unavailable. Existing products retain their legacy stock/purchasable behavior until an explicit status is selected. Coming soon and Sold out remain visible with distinct labels but cannot enter a new checkout. Available cannot manufacture positive stock or override a source publication hold.
- Home/shop/search, product pages, alternate choices, comparison and pack selection consume the same merged availability and pricing state. Shipping copy for a closed product does not promise ordinary dispatch. Closed products retain configured offers but do not advertise an active discount. Eligible Product schema agrees with the current purchase state; an active timed sale includes its price-validity date.
- Timed sales use the authoritative percentage rule for single and fixed-pack prices, activate at the saved start and end at the saved deadline. The public countdown uses that real deadline. Current prices refresh at the boundary; the server independently requotes checkout. Existing 15% preorders take precedence over a timed sale, and existing pack/promo rules remain downstream. There is no second application of the same sale percentage.
- Existing runtime price, stock, sale and preorder overrides remain authoritative. Older editors cannot silently erase an explicit status, sale or fixed-pack configuration by omitting it; existing preorder omission protection remains. Inventory changes retain the expected-stock and reserved-quantity guards. The atomic new-order reservation check also rejects a product closed after the initial quote read.
- Historical orders, prices, attribution and saved preorder promises remain unchanged. This does not cancel, reprice or rewrite an already reserved order. New status controls do not change fulfillment policy or assert that a label means an item was mailed.

## History migration

`drizzle/0021_product_availability_history.sql` is additive to the deployed migration history. It replaces only the three product-override audit triggers from 0020, adding a strictly validated Availability before/after field. Only the four permitted enum values enter this field; arbitrary raw strings or private values are not copied into history.

Apply 0021 once after 0020. It does not create product overrides, change prices/stock/preorders, rewrite historical events, or backfill invented prior status changes. Existing atomic staff attribution, rollback and append-only history protections remain. Do not replay previous migrations or seed older catalog defaults during publication.

## Verification completed before publication

- The gated production build passed TypeScript, whitespace checks and all **48 isolated release suites**. Build evidence: `/private/tmp/product-editor-build-final-v1.log` records the passing gate and completed build.
- New availability regressions cover every status, repeated normalization, runtime override precedence, explicit reopen, zero-stock behavior, hard publication holds, route authorization/validation, optional-field preservation, scheduled-sale and preorder precedence, fixed packs, all five existing promo codes, safe before/after history and unchanged historical records.
- Inventory regressions execute the actual SQL transaction and prove a new reservation rolls back when availability closes, without disturbing an earlier reservation.
- `node tests/product-editor-worker-v1.mjs` passed against the fresh compiled Worker with all migrations and an isolated local D1 database. It exercised authenticated status save, shared catalog response, cart/quote rejection, real sale start/end, fixed-pack/all-code totals, staff-attributed history, publication-hold rejection and anonymous denial. No order or live provider call was created.
- `node tests/checkout-recovery-worker-v1.mjs` passed against the same compiled output, covering the existing durable recovery discount, provider no-payment check, cron, deduplication and scanner-safe unsubscribe. Providers were intercepted or mocked; no real email or payment occurred.
- Independent source review found no remaining blocking arithmetic, availability, attribution or historical-order issue. Targeted checks confirmed closed-product shipping copy and configured-offer labels. This review and the isolated tests are not a claim of production or authenticated live verification.

- Actual browser interactions against the isolated local Worker saved Coming soon and Sold out and verified disabled ordering on the product page. A 24-hour 15% fixture sale saved correctly: the $35 single price became $29.75, the $94.50 three-pack became $80.33, and the countdown advanced from 23h 59m 07s to 23h 58m 10s. Nasal and softgel filters displayed separate groups and retained the source preorder offer.
- Desktop browser screenshots were visually inspected. The requested 390px viewport override did not change the browser's measured 1280px width; mobile visual verification remains unavailable, rather than claimed as passed. Responsive CSS and controls are covered by source/component checks.

## Affected surfaces and files

- Administration: `/admin?tab=products` and `/admin?tab=changes`; `components/store/admin.tsx`, the new `admin-products` component/styles, and the admin product action in `app/api/store/[action]/route.ts`.
- Catalog and purchasing: `/`, `/shop`, search, `/product/[slug]`, comparison, pack builder, cart and checkout; `lib/availability.ts`, `lib/catalog.ts`, `lib/commerce.ts`, `lib/sales.ts`, `lib/inventory-statements.json`, store provider/catalog/comparison/pack components, and shared product-status/sale-notice components.
- Search metadata: `lib/seo.ts`; eligible Product offers use the same effective availability and timed-sale price as the storefront.
- Audit and regression coverage: migration 0021, product availability/editor tests, inventory/UI/countdown regressions and the explicit release-check allowlist.

## Publication receipt: pending

- Source commit and shared GitHub main sync: **pending**.
- Exact-commit hosted checks/build: **pending**.
- Production migration 0021: applied successfully at approximately 2026-10-12 21:31 UTC; seven commands completed in 22.37ms. No product rows were altered.
- Deployed Worker version and publication time: **pending**.
- Read-only live verification of affected URLs, desktop/mobile interactions and authorized shared admin view: **pending**. Do not make purchases or change real catalog settings for a smoke test.
- Changes-page source/build/deployment import and verification: **pending**.

The immutable release receipt will record the exact commit, deployed version, live observations and remaining verification gaps after publication: `/Users/godsstrengthandspeed/Documents/AI Workspace/Documents/Generated/2026/10/BioMod-Admin-Audit/product-editor-release-2026-10-12-v1.json`. No live product data was changed during implementation or the isolated tests. Production sales, inbox delivery and physical shipping outcomes are outside what this release establishes.
