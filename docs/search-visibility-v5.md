# Search visibility follow-up v5

October 8, 2026. This release corrects two stale references found in the completion audit.

## Public terms reference

A browser visit to the former `https://biomodpeptides.com/terms-of-sale/` address lands on the current TryBiomod Terms of Sale page. That page nevertheless claimed separate published terms remained available at the former address. Removed only that obsolete sentence. The existing review-draft status remains explicit; this change does not approve or finalize legal policy text.

## Current measurement sheet

Use [product-search-targets-v2.csv](product-search-targets-v2.csv) for the current page/query measurement sheet. It supersedes v1, which is retained as a historical artifact. An independent comparison of all 26 rows against the current exported catalog and publication policy found one mismatch: TB500's secondary identity still asserted Thymosin Beta-4. The v2 field now reads `TB-500 (sequence confirmation pending)`, matching the catalog. Its specification hold remains in place.

All other fields are unchanged. The sheet contains 16 technically eligible products and ten held products; ranks and search volumes remain unmeasured. Technical eligibility is not evidence of indexing or ranking.

## Verified release

Published Cloudflare Worker version `ae4d30c8-b309-445a-a8ff-66ec908ae0b8`. The production build and TypeScript check passed. Live HTTP and browser checks confirm the obsolete terms reference is absent and draft status remains. A product-only before/after comparison found no changes to names, strengths, SKUs, prices, pack prices, inventory or purchase availability across all 50 records. The sitemap retains the same 24 URLs, including the same 16 product pages. Earlier SEO, redirect, search and checkout regression results remain documented in v1-v4; no payment test was performed in this release.

## Unfinished goal requirements

| Requirement | Remaining evidence or action |
| --- | --- |
| Explain low sales and measure conversion | Owner classification of actual customer orders versus internal tests; provider payment reconciliation; an owner-performed complete purchase; a valid visitor/funnel denominator. Existing aggregate records do not establish these. |
| Promote every eligible product accurately | Manufacturer/lab specifications for held sequences, salt forms and formulations. The holds in `lib/product-specification-review-v1.json` remain. Other unresolved packaging/formulation publication restrictions remain unchanged. |
| Complete customer policy review | Approved terms/privacy text and confirmed operational commitments. Removing the obsolete domain reference does not resolve this dependency. |
| Obtain relevant external backlinks | The exact AlphaGrade and Estly requests in `backlink-corrections-v1.md` remain unsent pending explicit send authorization. The Las Vegas publisher also needs a verified contact. Existing BiomodPro links are documented separately. |
| Establish search outcomes | Google search/indexing data and actual results. The accepted domain move and successful technical checks do not prove page-one rankings. |

No email, contact form, new analytics service, payment transaction or product-identity concealment was introduced. The overall goal remains incomplete.
