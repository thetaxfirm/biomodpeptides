# Product size layout revision v1

## Result

Replaced the MOTS-c comparison block with compact 10 mg and 40 mg navigation directly below the product title. The active size has a clear selected state, with availability on each option. Price and batch documentation appear once for the selected product. Existing plum/copper branding is preserved.

SS-31 has one listed size (10 mg), so no alternative was invented. HEAT-R retains its existing layout and discovery holds. Product identity, all pack prices, inventory, batch records, and artwork were not modified.

## Validation

- Product research details SSR regression checks passed.
- Product discovery and search-readable facts checks passed.
- TypeScript and production build passed.
- Isolated local production Worker: guest APIs returned 200; size navigation and 3-pack price updates worked; browser reported no warnings or errors.
- Local D1 migrations were applied only to the isolated `/tmp/biomod-size-prod-v2` store; no remote database migration was run.
- Live navigation between both MOTS-c sizes showed the correct $35/out-of-stock and $100/in-stock states and independent COA records.
- Live 40 mg 3-pack selection showed $270 total and $90 per vial.
- All 50 public catalog records exactly matched the pre-deployment snapshot.
- Responsive preview passed at 320 and 390 pixels; live 390-pixel page had no horizontal overflow.
- No checkout order was submitted.

An initial development preview produced React and API errors. Deployment was held, then approved after the built production Worker passed runtime checks. Already-open product pages needed a refresh after release.

## Deployment

Cloudflare Worker: `biomod-peptides`

Version: `3d51816f-8a22-4aed-ac2e-0942b130594d`

Live page: https://trybiomod.com/product/mots-c-40mg

Local visual evidence:
- `/tmp/biomod-competitor-improvements-v2.png` (desktop)
- `/tmp/biomod-size-selector-mobile-v1.png` (390-pixel mobile)
