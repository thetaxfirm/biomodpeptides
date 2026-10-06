INSERT INTO product_overrides (id, data)
VALUES (1389, '{"price":7900}')
ON CONFLICT(id) DO UPDATE
SET data = JSON_SET(product_overrides.data, '$.price', 7900);
