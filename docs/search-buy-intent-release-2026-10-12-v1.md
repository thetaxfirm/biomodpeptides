# Buy-intent search release, October 12, 2026

Author: Claude, at the owner's request: target "buy bpc-157", "bpc 157 10mg", "buy peptides" and "buy research peptides", and ship plan items 1-5 (product FAQ markup, /faq markup, sized headings, brand signals, internal links).

## Changes

Commits 9249cd5 and 6d93c59.

| Surface | Before | After |
| --- | --- | --- |
| Home title / H1 | Biomod Peptides \| Research Vials & COAs \| TryBiomod / "Research-only compound vials." | Buy Research Peptides \| Biomod Peptides \| TryBiomod / "Buy research peptides." Button "Shop research peptides". Description names BPC-157 10mg, MOTS-c, SS-31. |
| Shop title / H1 | Research Peptides: Compounds, Vial Sizes & Batch Records / "Research peptides & compounds" | Buy Peptides for Research: Vials & Batch Records / "Buy research peptides & compounds" |
| FAQ title | Peptide COA, Pack Sizes and Ordering Questions | How to Buy Research Peptides: COAs & Ordering. New first answer "How do I buy research peptides from Biomod?" |
| Product titles | BPC-157 10mg Research Vial | Buy BPC-157 10mg Research Vial (all 17 eligible products). Product schema `name` keeps no "Buy". |
| Product H1 (research vials) | BPC-157 (size on a separate line) | BPC-157 10 mg ("/ vial" dropped for Selank, Semax, Glutathione) |
| Product questions | 2 questions, hard-coded in the component | 3 questions from `lib/product-questions.ts`, first "How do I buy <product> <size>?" |
| Structured data | Product, BreadcrumbList; Organization logo SVG | + FAQPage on every eligible product and on /faq, generated from the same text as the visible answers (the live-rendered shipping answer is excluded). Organization logo `/brand/logo-navy-tm-v36.png` (rendered from the v36 SVG). |
| Internal links | 3 related product cards | + "All research peptides" plain-link index of every published research vial on each research vial page |

No dosing, human-use or efficacy wording added. Publication holds unchanged (17 products).

## Verification

- `npm run check:release`: TypeScript and 67 suites (new `tests/search-buy-intent-v1.cjs`: titles <= 70 and descriptions <= 160 on changed pages, no medical wording, Product name without "Buy", FAQPage equals visible questions for all 17 products and /faq, no FAQPage on pages without questions, PNG logo). `BIOMOD_DEPLOY=true npm run build` completed for both commits.
- GitHub Website consistency run 38354079230 succeeded for 9249cd5. Cloudflare version 1c12ca6c-2ce3-44f4-88fc-051801a0a151 (2026-10-13T06:17:41Z) serves both commits along with later contributor work.
- Live: titles above on /, /shop, /faq, /product/bpc-157-10mg, /product/selank; FAQPage present on /product/bpc-157-10mg, /product/mots-c-40mg and /faq; Organization logo PNG returns 200 image/png; H1 "BPC-157 10 mg", "SELANK 10 mg"; vial index shows 16 links with no "/ vial"; desktop and 375 px mobile checked, no horizontal overflow. Structured data is intentionally omitted on URLs with unknown query parameters (for example `?cb=`), so checks used clean URLs.
- IndexNow: 200 OK, 28 URLs, 2026-10-13T06:17:58Z.

## Open

- Ranking movement is not yet observable; the daily Claude task (`trybiomod-search-ranking`, 2 PM) records Bing/DuckDuckGo positions for these four phrases.
- Bing Webmaster verification, apex property, sitemap resubmission and Site Move from biomodpeptides.com still need the owner's sign-in.
- Catalog casing (SELANK, SEMAX, MOTS-C) comes from catalog data and was not changed.
