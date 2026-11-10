-- EQUIL (Selank spray, ID 771): owner correction, November 10, 2026: $99.00, not $89.00.
-- Updates only price and packPrices (existing 10/15/20 percent discounts); other saved keys are preserved.
INSERT INTO product_overrides (id, data)
VALUES (771, '{"price":9900,"packPrices":{"3":26730,"5":42075,"10":79200}}')
ON CONFLICT(id) DO UPDATE
SET data = JSON_SET(product_overrides.data, '$.price', 9900, '$.packPrices', JSON_OBJECT('3', 26730, '5', 42075, '10', 79200));
