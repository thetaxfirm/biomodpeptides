# Search visibility release v7

October 8, 2026. Production worker version `65f60cbe-4518-44c3-90bc-8c95a45f3453`. Previous source baseline `06bfc95dc8d3be77ce4dd336340f390ad16d9a83`.

## Published changes

- Existing 16 reviewed product destinations now appear in the homepage initial HTML. All 31 vial entries remain accessible through the existing 16-at-a-time control.
- Research navigation and home catalog actions use canonical `/shop`. Its existing facet/query noindex policy remains.
- MOTS-c 10/40 mg pages link both listed sizes with current prices, stock and their separate batch-document status. No equivalence claim or shared certificate.
- Reviewed research products receive two concise product-specific answers and review-aware catalog recommendations. Existing nonresearch recommendations stay unchanged.
- Testing library uses native disclosures. All 50 records and 21 existing public original-PDF links are present in the initial response; mouse/keyboard expansion, search and product filters remain functional. Existing missing, mismatched and restricted-document conditions are preserved.
- Original supplier-evidence guide at `/choosing-a-research-supplier`, linked from the footer, with unique metadata and sitemap inclusion. No third-party compliance or clinical claims copied.

## Verification

- Production build and TypeScript pass.
- Passed product-discovery, product-research-details, testing-discovery, search-readable-facts, search-visibility, product-specifications, catalog-removal and research-faq checks. Separate reviews found no remaining material blocker.
- Public API before/after equality: all 50 product records unchanged, including identity, pricing, stock, branding references and contents.
- Live sitemap 25 URLs, including the same 16 product URLs. Reviewed product routes index/follow; held TB500 and category-query route remain noindex/follow. Canonicals match production paths.
- Actual browser: homepage 16 cards expands to 31, no remaining Load more at the end; no horizontal overflow at 1280 px. MOTS 10 → 40 link opens correct size. Selecting 3-pack updates price to $270.00 / $90.00 per vial without cart/order submission.
- Actual browser: main testing search for MOTS returns two records; mouse expands 10 mg and Enter expands 40 mg. Matched and pending statuses stay distinct. The new guide is linked and readable.
- Live HTTP evidence saved in `docs/search-visibility-live-v7.json`. Before-release catalog snapshot `/tmp/biomod-seo-catalog-before-v7.json`; HTTP checker `/tmp/biomod-seo-live-v7.py`.
- Screenshot `/tmp/biomod-competitor-improvements-v1.png` shows the live MOTS size navigation. Responsive CSS is present, but mobile viewport rendering was not independently verified because the browser viewport override did not take effect in this session.

## Limits and next evidence

These changes improve discovery and factual purchase research; no ranking, AI citation or sales lift is established. Competitor comparison and retrieval limitations are recorded in `docs/competitor-search-audit-v1.md`; public search observations in `docs/competitor-search-evidence-v1.json`.

Actual per-SKU SDS, supplied-lot records, storage specifications and policy facts are still needed before publishing those capabilities. The audit records an existing MOTS 10 mg artwork/report purity discrepancy for source reconciliation. No paid backlinks, outreach, press distribution, invented credentials or new product claims were added.
