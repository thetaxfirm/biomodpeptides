-- Owner confirmed SS-31 50 mg at $110 with 100 available vials on October 9, 2026.
-- Initialize only the new SKU. Never reset inventory after a sale or admin adjustment.
INSERT INTO product_overrides (id, data)
VALUES (5027, '{"inStock":true,"purchasable":true,"stockQuantity":100}')
ON CONFLICT(id) DO NOTHING;
