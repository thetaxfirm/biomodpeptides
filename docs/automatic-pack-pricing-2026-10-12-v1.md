# Automatic fixed-pack repricing

Owner request: changing a product's single-item price must update its 3-, 5- and 10-pack totals. TryBiomod only.

The product editor now recalculates these totals immediately using the established fixed-pack discounts: 10%, 15% and 20%. Calculations use integer cents and the same discount-rounding rule as the storefront. An $80 single item produces $216, $340 and $640 pack totals. These are illustrative amounts, not newly published product prices.

Existing custom pack totals remain intact when opening an editor or changing unrelated fields. A single-price edit resets all three totals to automatic prices. Staff can then deliberately edit individual pack totals for a custom price. Editing the single price again recalculates all three. Blank or invalid price drafts clear derived pack values until a valid amount is entered.

The protected save route recomputes automatic pack totals itself. A price change submitted by an older editor without a mode also gets fresh pack totals; stale fixed totals cannot silently survive that base-price change. An explicit custom mode requires a pack-price payload for a changed base price. The mode is request intent, not a private field persisted in the product record. Existing version, inventory, lot and publication checks remain in force.

The saved product record remains the shared source for storefront cards, product pages, cart, checkout, scheduled offers and receipts. Mix-and-match discounts remain a separate existing setting. Historical orders retain their saved amounts. Deployment does not change live product prices, stock, lots or publication status.

Baseline source: `6fbc8323327d684fc755ce734e7762423732a324`. Shared main fetched with a clean checkout and no divergence. Final source, tests, actual deployment, public assets, signed-in browser validation and nonsecret runtime comparisons are retained in the dated external release receipt under BioMod-Admin-Audit.
