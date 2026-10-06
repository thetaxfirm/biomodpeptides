# Owner-approved retail pricing v1

Source defaults prepared October 5, 2026 from the owner's direct retail-price instructions. These prices supersede the older catalog and supplier-comparison price defaults for the three exact listings below. They are retail selling prices, not wholesale prices or manufacturing costs.

| Product | Product ID | SKU | Single | 3-pack | 5-pack | 10-pack |
|---|---:|---|---:|---:|---:|---:|
| C-HEAT-S 10 mg | 746 | BM-LYO-003 | $49.99 | $134.97 | $212.46 | $399.92 |
| 5-Amino-1MQ 50 mg | 783 | BM-LYO-025 | $49.99 | $134.97 | $212.46 | $399.92 |
| AZURE 60 softgels | 779 | BM-SOF-005 | $109.99 | $296.97 | $467.46 | $879.92 |

`lib/retail-pricing-v1.json` uses integer USD cents. `lib/catalog.ts` applies it after `lib/competitive-pricing-v3.json`. Historical catalog and competitive-pricing snapshots are preserved. Fixed-pack totals keep the existing 10%, 15% and 20% discounts for 3, 5 and 10 whole units respectively. Each total is calculated as single price times count minus the discount rounded to the nearest cent. A unit is one vial for C-HEAT-S and 5-Amino-1MQ, and one 60-softgel bottle for AZURE.

This source change does not alter stock, availability, purchase limits or scheduled sales. Existing D1 `product_overrides` continue to take precedence in `lib/commerce.ts`, so the deployment must apply `drizzle/0004_owner_retail_pricing_v1.sql` before publishing the source defaults. The migration updates only the `price` and `packPrices` keys for exact product IDs 746, 783 and 779, preserving every other saved key and all other products. It inserts no rows and changes no schema; products without saved overrides receive the new source defaults. Fixed-pack overrides are updated along with each single price, so old pack totals do not erase the intended discounts. Mix-and-match discount settings are unchanged.

The actual public TryBioMod Cloudflare deployment applies these SQL migrations before deploying the Worker, as documented in `README.md`. The separate private Sites deployment is not the public domain's pricing authority. Preparing the migration does not apply it to any live database. An authenticated live administrator update is also sufficient to change existing-product runtime prices without a source build, provided the corresponding fixed-pack totals and other saved fields are preserved.

ARA-290 has not been added: the current storefront has no ARA product record, and its product metadata must be verified before creating a listing. Preparing these source defaults does not publish them; a source deployment or live administrator update is a separate step.

Validation: `node tests/retail-pricing-v1.cjs`, `python3 tests/retail-pricing-migration-v1.py` and `node tests/sales-v24.cjs`; type checking: `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
