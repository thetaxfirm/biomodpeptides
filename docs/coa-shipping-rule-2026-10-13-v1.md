# No contact-us checkout hold; never ship without a COA, October 13, 2026

Scope: trybiomod.com. Author: Claude, at the owner's request.

## Owner instructions

1. "No, don't contact us. We can send COA on delivery or they can contact us." A customer (returning, mixed 10-pack including HEAT-R 20mg) was stopped at payment by "Inventory is awaiting verification. Please contact us before ordering." because five HEAT products had no stock count.
2. "Don't mail out the products we don't have COA for. But all the HEAT we have. Also create a list in the admin page for products we cannot ship out for this reason."

## Behavior

- Checkout no longer stops on a product with no stock count. No count means inventory is not tracked for that product; the reservation guard no longer rejects it. Counted products still cannot be oversold. Paying never invents a count.
- Shipping rule: an order containing a product whose current lot has no original COA on record (`resolvedBatch.coa_available` false or missing) cannot get a label (refused before any carrier call) and cannot be marked shipped. It stays Paid. The block lifts by itself once the COA is attached under Products.
- Admin > Orders shows "Can't ship: no COA on file": each product, the lot being sold and how many paid orders are waiting on it. Blocked orders show "Can't ship: no COA for ..." in place of the label button.
- All five HEAT products (HEAT-R 20mg, HEAT-R 30mg, HEAT-T, C-HEAT, C-HEAT-S) have a matched COA on record and ship normally.

At release, 28 live products had no matched COA for the lot being sold (most spray and softgel products, plus 5-Amino-1MQ, KPV, Lipo-C w/B12, MOTS-C 40mg, SELANK, SEMAX, SLU-PP-332, SS-31 50mg, Acetic Acid Solution and Wolverine). They can still be ordered; they cannot be shipped until their COA is attached.

## Verification

`npm run check:release`: TypeScript and 72 suites, including new `coa-shipping-v1.cjs` and the untracked-stock checkout case in `shipping-services-v1.cjs`. `BIOMOD_DEPLOY=true npm run build` passed. Built-Worker tests passed: `shipping-options-worker-v1.mjs` (label still bought for a product with a COA), `shipping-services-worker-v1.mjs`, and new `coa-shipping-worker-v1.mjs` (label refused with no carrier call, mark-shipped refused, order stays paid, queue flag and list). Synthetic data only.

Affected: /checkout, /admin?tab=orders, /api/admin/shipping, /api/store/admin-order, /api/store/admin-orders. No migration, no product, price or order data changed.

## Release

Main 5958e89 (after collaborator commit 5dcad86), gate 72 suites passed. Cloudflare version cc09e63c-2188-400c-b12d-1689f1fc13eb deployed 2026-10-14T03:26:21Z. Live: /, /checkout, /shop 200; admin orders data refused when signed out. Signed-in Orders list not yet viewed live (needs owner sign-in).

## Exception, October 14, 2026

Owner: "remove need for coa for lipo-c" and "fix the order to allow for shipment". `shipsWithoutCoa` in `lib/coa-shipping.ts` lists products that ship without a COA on file; it holds Lipo-C w/B12 (product 784). It ships normally and is no longer on the "Can't ship: no COA on file" list. Paid orders containing it clear automatically (the rule is evaluated live; no order data changed). `tests/coa-shipping-v1.cjs` uses a synthetic product for the blocked case and asserts the Lipo-C exception.

## Rule removed, October 14, 2026

Owner, minutes after the Lipo-C exception: "remove the never ship without coa rule". `COA_REQUIRED_TO_SHIP = false` in `lib/coa-shipping.ts`: no order is held for a missing COA (label purchase and Mark shipped proceed), the admin "Can't ship: no COA on file" list is empty, and the overview no longer counts blocked orders. The code stays behind the switch so the rule can be restored. The checkout change from Oct 13 (no contact-us hold for untracked stock) is unchanged.
