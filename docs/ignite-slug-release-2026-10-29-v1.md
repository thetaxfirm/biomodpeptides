# IGNITE address rename, October 29, 2026 v1

Author: Claude, on the owner's instruction to rename the IGNITE link so it no longer says oxytocin. Commits `21efd69` and the follow-up that updates the served permalink fields.

## Change

- Product address `/product/ignite-pt-141-oxytocin-spray` is now `/product/ignite-pt-141-oxy-spray`. The old address returns a permanent 308 redirect (`lib/legacy-routes.ts`); old-domain links reach the new page.
- Product photo renamed to `ignite-pt-141-oxy-spray-v1.webp`. Pixels unchanged; the photographed label still prints "PT-141 + OXYTOCIN".
- `permalink` and `product_url` provenance fields point at the renamed old-domain path, which resolves to the new page. Nothing in the app reads them, but they were serialized into page data.
- D1 stock, batch and order records are keyed by product id; no data migration was needed.
- IGNITE remains held: `noindex`, not in the sitemap. Canonical is the new address.

## Not changed

- Visible ingredient wording. Codex's commit `860fb86` (October 26) changed IGNITE and NOCTIS text to "Oxy (oxytocin)" under the scientific-identity rule, after the owner asked for "Oxy" only. That conflict is with the owner to decide.
- `lib/catalog-source-v1.json` (original-site import, not imported or served).

## Verification

- `npm run check:release`: TypeScript and 109 isolated suites passed. `legacy-domain-routes-v1` asserts the redirect from both slash forms and that IGNITE stays out of the sitemap.
- Live after `21efd69`: new page 200 with canonical to the new address and `noindex, follow`; old address 308 to the new one; `biomodpeptides.com/product/ignite-pt-141-oxytocin-spray/` ends at the new page (3 hops); image 200 `image/webp`.
