-- Owner confirmed Wolverine 5 mg / 5 mg (10 mg total) is in stock on October 8, 2026.
-- Preserve recorded inventory, prices, pack prices, and all other product fields.
INSERT INTO product_overrides (id, data) VALUES (764, '{"inStock":true,"purchasable":true}')
ON CONFLICT(id) DO UPDATE SET data = JSON_SET(product_overrides.data, '$.inStock', json('true'), '$.purchasable', json('true'));
