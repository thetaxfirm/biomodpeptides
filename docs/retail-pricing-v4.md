# Softgel retail pricing v4

Owner-approved screenshot, October 6, 2026. Prices are USD per bottle.

| Product | Previous TryBioMod | Approved retail |
| --- | ---: | ---: |
| DELTA | $179.00 | $179.00 |
| ERASER | $179.00 | $179.00 |
| BIONIC | $189.00 | $189.00 |
| LUMEN | $229.00 | $179.00 |
| SCULPTOR | $239.00 | $199.00 |
| AZURE | $109.99 | $110.00 |

The latest explicit AZURE price is $110.00. Existing 3/5/10-bottle discounts remain 10/15/20 percent. Updated pack totals are LUMEN $483.30/$760.75/$1,432.00; SCULPTOR $537.30/$845.75/$1,592.00; AZURE $297.00/$467.50/$880.00.

The versioned retail overlay preserves all other retail overrides. Migration 0009 inserts price-only overrides when absent and updates only price and packPrices for existing override rows with IDs 777, 778 and 779. Inventory, sale schedules, product identity and historical order records are unchanged.

## Publication and verification

Published the three price overrides directly to the existing production Cloudflare D1 database. The application bundle was not redeployed: this checkout also contains separate unpublished catalog changes. The current production catalog retained all 50 product records, with only price and packPrices changed on the three intended IDs. All 47 other product records were identical before and after.

Verified all six live prices through `/api/store/state` and the loaded public softgel collection. A real LUMEN 3-pack selection displayed $483.30 ($161.10 per bottle). Typecheck passed, 24 server quote totals matched the requested singles and existing discounts, and isolated SQLite checks verified insert/update behavior, unrelated-field preservation, and repeatability.
