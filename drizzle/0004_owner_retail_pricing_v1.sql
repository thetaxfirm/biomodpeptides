-- Owner-approved retail prices and fixed-pack totals. Preserve all other override keys.
UPDATE product_overrides
SET data = JSON_SET(data, '$.price', 4999, '$.packPrices', JSON_OBJECT('3', 13497, '5', 21246, '10', 39992))
WHERE id = 746;
--> statement-breakpoint
UPDATE product_overrides
SET data = JSON_SET(data, '$.price', 4999, '$.packPrices', JSON_OBJECT('3', 13497, '5', 21246, '10', 39992))
WHERE id = 783;
--> statement-breakpoint
UPDATE product_overrides
SET data = JSON_SET(data, '$.price', 10999, '$.packPrices', JSON_OBJECT('3', 29697, '5', 46746, '10', 87992))
WHERE id = 779;
