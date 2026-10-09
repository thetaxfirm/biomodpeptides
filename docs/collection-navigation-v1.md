# Softgel and nasal/spray navigation v1

The softgel page had no direct nasal/spray link, and neither collection was available from the global menu. Added Softgels and Nasal & spray to the shared desktop/mobile navigation, a direct Shop nasal & spray products link beside the softgel-page collection action, and a nasal/spray footer link. The shop heading and category filter now use Nasal & spray products.

Existing destinations remain /softgels and /shop?category=spray-products. Product records, prices, stock, imagery and documentation are unchanged. Navigation wraps into balanced tablet rows; mobile uses the existing menu.

## Verification

- Storefront search, product discovery and product research detail checks passed.
- TypeScript and production build passed.
- Desktop direct softgel-to-spray link opened the ten-product nasal/spray collection; Softgels menu link returned to the editorial collection.
- Mobile menu links worked in both directions at 390px; no horizontal overflow.
- Final 930px tablet layout had two balanced navigation rows, intact imagery and no horizontal overflow.
- Production links repeated successfully and browser reported no warnings or errors.
- Existing product additions awaiting inventory inputs were excluded using an isolated checkout.

Worker version: 0c14d431-82a2-4c32-8d0f-6c0b610f1867
Live proof: /tmp/biomod-collection-links-live-v1.png
