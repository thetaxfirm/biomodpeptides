# Homepage MOTS-c sizes v1

## Change

The homepage originally placed MOTS-c10mg second and40mg ninth. The10mg card did not indicate another vial size existed. Both now appear together in the first row, with explicit10mg/40mg titles and a link from each card to the other size's product page. Each card retains its own image, price, pack selection, stock status, wishlist ID and add-to-cart SKU.

The full31-vial list and16-at-a-time pagination are unchanged, as are the existing discovery holds. The new cross-links are enabled only on homepage cards for the existing explicit MOTS-c pair.

## Verification

- Actual homepage SSR checks: adjacent sizes, reciprocal product links, correct per-card price and wishlist identity.
- Existing product-page regression checks and TypeScript passed.
- Production build passed.
- Local production browser: the40mg link opens the40mg page; three-pack selection shows $270 / $90 per vial.
-390px mobile inspection: readable size link and no horizontal overflow.
- Live site:10mg remains $35/out of stock;40mg remains $100/in stock. Pack selection verified and reset to single.
- All50 live product records exactly unchanged after deployment.
- Live browser reported no warnings or errors. No order was submitted.

## Release

Worker version: `5645c068-a6b1-4d73-ba26-794e348de596`

Evidence: `/tmp/biomod-home-mots-sizes-v1.png`

Page: https://trybiomod.com/#home-vials
