# Softgel retail pricing v5

Owner instruction in chat, November 10, 2026. Prices are USD per bottle on trybiomod.com.

| Product | Product ID | Previous | Owner price | Change |
| --- | ---: | ---: | ---: | --- |
| BIONIC | 776 | $189.00 | $189.00 | none |
| LUMEN | 777 | $179.00 | $227.00 | raised |
| DELTA | 781 | $179.00 | $179.00 | none |
| NEXUS | 780 | $219.00 | $219.00 | none |
| SCULPTOR | 778 | $199.00 | $239.00 | raised |
| ERASER | 852 | $179.00 | $179.00 | none |
| CHISEL | 782 | $169.00 | $169.00 | none |
| EQUIL (Selank spray) | 771 | $75.00 | $99.00 | raised |

Fixed packs keep the existing 10/15/20 percent discounts: LUMEN $612.90 / $964.75 / $1,816.00; SCULPTOR $645.30 / $1,015.75 / $1,912.00; EQUIL $267.30 / $420.75 / $792.00. The five unchanged products keep their automatic pack totals.

`lib/retail-pricing-v5.json` supersedes v4 (preserved) and changes LUMEN and SCULPTOR and adds EQUIL. For live D1 `product_overrides` rows 777, 778 and 771, `drizzle/0035_owner_softgel_retail_pricing_v5.sql` updates only their `price` and `packPrices` keys; stock and every other saved key are preserved. Any running site-wide sale still applies on top of these base prices. Historical orders keep their saved amounts.

Correction, same day: the owner changed EQUIL from $89.00 to $99.00. Migration 0035 had already set $89.00 live, so `drizzle/0036_owner_equil_price_v5.sql` sets $99.00.
