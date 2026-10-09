# Search visibility release v6

October 8, 2026. Production Worker version `c08f7add-69b7-4d46-a8fd-2a3711535ac5`.

## Published change

The dedicated `/faq` now renders ten complete answers in its initial HTML, with contextual links to the batch library, COA guide, pack builder and existing policies. Six existing answers remain unchanged. The home-page accordion remains unchanged. The FAQ title and description now name its actual documentation and pack topics.

Product specifications appear below the batch record without opening a tab. Description and Shipping remain interactive tabs. Already-public certificates gain an ordinary original-PDF anchor beside the existing preview. No certificate was edited, substituted or newly made public. Missing, mismatched and on-request document guards remain intact.

## Verification

- Production build and TypeScript passed.
- Real-component SSR checks passed for all 50 specifications and all ten FAQ answers. Exact facts, held specifications, the HEAT document restriction, missing certificates and lot mismatches were exercised.
- SEO eligibility, catalog removal safeguards, product specifications and storefront search regression checks passed; `git diff --check` passed.
- Live HTTP verified FAQ text and product specifications outside script payloads, plus the original PDF anchor. The original BPC-157 report returned HTTP 200, PDF content type and a PDF signature.
- Desktop browser verified the FAQ, a contextual guide link, visible product specifications and the Shipping tab and certificate preview. The direct PDF destination also loaded in a browser tab.
- All 50 live catalog records exactly match the previous product-only snapshot, including names, strengths, prices, pack totals, SKUs and availability. Sitemap remains 24 URLs with the same 16 eligible products.
- Mobile visual verification was attempted using the documented viewport override, but the browser stayed at 1280 px. The override was reset; no mobile pass is claimed.
- An independently run legacy retail-pricing test has a pre-existing stale AZURE expectation of 10999 versus the current approved 11000. This release does not change retail prices to satisfy that stale test.

Live evidence: `/tmp/biomod-seo-live-audit-v6.json`; desktop FAQ image `/tmp/biomod-faq-desktop-v1.png`. Build and deploy logs are `/tmp/biomod-seo-build-v9.log` and `/tmp/biomod-seo-deploy-v8.log`.

## Search and press evidence

Google Search Console's effective Search generative AI control is Include, inherited from the domain default. No setting change was needed. Performance/indexing data is still processing, and no dedicated AI report was visible. Screenshot: `/tmp/biomod-google-ai-inclusion-v1.png`.

The campaign research and remaining dependencies are in [ai-search-campaign-v1.md](ai-search-campaign-v1.md). A one-page press draft about the existing COA guide was prepared as editable DOCX and PDF, rendered and visually inspected. It has not been distributed. No outreach, purchase, new tracking service, ranking claim or payment test was performed. Existing product specification and policy-review dependencies remain open.
