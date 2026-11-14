# Search holds lifted: release v1

November 14, 2026. Owner direction, after reviewing the Search Console "Page indexing" report: index the terms of sale, privacy policy and locations pages, and all 15 products that carry no review block in code.

## What changed

- `lib/seo-policy.ts`: `/locations`, `/terms-of-sale` and `/privacy-policy` are eligible, so they are indexed and listed in the sitemap.
- `lib/seo-publication-v1.json`: 15 products join the allowlist (20 to 35): the APEX, EQUIL, FLUX, FORGE, GLOW, IGNITE, KLOW and SOLARA sprays; the BIONIC, CHISEL, DELTA, ERASER, NEXUS and SCULPTOR softgels; and Acetic Acid Solution 1%.
- Still held, by `productReviewBlocks`: TB500, Wolverine 10 mg and 20 mg, GLOW 70 mg, KLOW 80 mg, 5-Amino-1MQ, SLU-PP-332, Lipo-C, the HEAT line, LUMEN, Methylene Blue, NOCTIS and ZENITH. An allowlist entry cannot override these.
- Product titles and meta descriptions now follow the product's format. Before, a spray read "Buy APEX 60mg / bottle Spray" and every description offered "single vials". Now: "Buy APEX 60mg Spray", "single bottles or 3, 5 and 10-packs", and no pack wording where packs are not sold. An alias list is dropped if it would push a description past 160 characters (FLUX).
- Product structured data omits the Compound and Container contents properties when the catalog has no value, instead of publishing an empty `value` (Acetic Acid Solution).

## Checks

- `npm run check:release`: TypeScript and 129 suites passed. Updated suites: seo-v7, merchant-policies-v1, social-preview-v1, legacy-domain-routes-v1 (IGNITE now listed), product-description-v1 (spray, softgel and supply containers), product-discovery-v1 and editorial-vial-links-v1 (home grid and editorial links stay vial-only), product-schema-identifiers-v1, shop-item-list-v1 (35 products).
- `tests/llms-indexnow-v1.cjs` (not in the release gate) also fails on main before this change: llms.txt no longer starts with the heading it expects. Left as is.
- `BIOMOD_DEPLOY=true npm run build`: Worker `biomod-peptides`, 35 allowlisted product slugs in the built settings.

## Live verification

- Commit c1af582 pushed to main at 22:50 UTC Nov 14; Workers Builds served it on trybiomod.com by 22:54 UTC.
- Live sitemap: 82 URLs (was 64), every one 200 with `index, follow`.
- Spot checks: /terms-of-sale, /privacy-policy, /locations, /product/apex-semax-spray ("Buy APEX 60mg Spray"), /product/softgel-eraser-tesofensine and /product/acetic-acid-solution-1 are indexable. /product/tb500-10mg and /product/wolverine-10mg remain `noindex, follow`; /cart remains `noindex, nofollow`; /shop?category=softgels remains `noindex, follow`.
- Search Console: the 404 validation was started on November 9. The sitemap was resubmitted after this release.
