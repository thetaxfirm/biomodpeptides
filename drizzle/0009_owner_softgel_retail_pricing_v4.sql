-- AZURE (BM-SOF-005): owner-approved retail and existing pack discounts.
INSERT INTO product_overrides (id, data)
VALUES (779, '{"price":11000,"packPrices":{"3":29700,"5":46750,"10":88000}}')
ON CONFLICT(id) DO UPDATE
SET data = JSON_SET(product_overrides.data, '$.price', 11000, '$.packPrices', JSON_OBJECT('3', 29700, '5', 46750, '10', 88000));

-- SCULPTOR (BM-SOF-004): owner-approved retail and existing pack discounts.
INSERT INTO product_overrides (id, data)
VALUES (778, '{"price":19900,"packPrices":{"3":53730,"5":84575,"10":159200}}')
ON CONFLICT(id) DO UPDATE
SET data = JSON_SET(product_overrides.data, '$.price', 19900, '$.packPrices', JSON_OBJECT('3', 53730, '5', 84575, '10', 159200));

-- LUMEN (BM-SOF-003): owner-approved retail and existing pack discounts.
INSERT INTO product_overrides (id, data)
VALUES (777, '{"price":17900,"packPrices":{"3":48330,"5":76075,"10":143200}}')
ON CONFLICT(id) DO UPDATE
SET data = JSON_SET(product_overrides.data, '$.price', 17900, '$.packPrices', JSON_OBJECT('3', 48330, '5', 76075, '10', 143200));
