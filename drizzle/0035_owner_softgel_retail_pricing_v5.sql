-- Owner soft gel prices, November 10, 2026 (see docs/retail-pricing-v5.md).
-- Only LUMEN and SCULPTOR carry saved price overrides that differ from the new prices.
-- Updates only price and packPrices; every other saved key (stock, sale, lot) is preserved.

-- LUMEN (BM-SOF-003): $227.00; packs at the existing 10/15/20 percent discounts.
INSERT INTO product_overrides (id, data)
VALUES (777, '{"price":22700,"packPrices":{"3":61290,"5":96475,"10":181600}}')
ON CONFLICT(id) DO UPDATE
SET data = JSON_SET(product_overrides.data, '$.price', 22700, '$.packPrices', JSON_OBJECT('3', 61290, '5', 96475, '10', 181600));

-- SCULPTOR (BM-SOF-004): $239.00; packs at the existing 10/15/20 percent discounts.
INSERT INTO product_overrides (id, data)
VALUES (778, '{"price":23900,"packPrices":{"3":64530,"5":101575,"10":191200}}')
ON CONFLICT(id) DO UPDATE
SET data = JSON_SET(product_overrides.data, '$.price', 23900, '$.packPrices', JSON_OBJECT('3', 64530, '5', 101575, '10', 191200));

-- EQUIL (Selank spray, ID 771): $89.00 (owner, same instruction). Its saved row holds stock only;
-- adding price and packPrices keeps the existing 10/15/20 percent pack discounts.
INSERT INTO product_overrides (id, data)
VALUES (771, '{"price":8900,"packPrices":{"3":24030,"5":37825,"10":71200}}')
ON CONFLICT(id) DO UPDATE
SET data = JSON_SET(product_overrides.data, '$.price', 8900, '$.packPrices', JSON_OBJECT('3', 24030, '5', 37825, '10', 71200));
