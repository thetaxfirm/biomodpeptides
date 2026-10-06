INSERT INTO product_overrides (id, data)
VALUES (745, '{"price":9999}')
ON CONFLICT(id) DO UPDATE
SET data = JSON_SET(product_overrides.data, '$.price', 9999);
