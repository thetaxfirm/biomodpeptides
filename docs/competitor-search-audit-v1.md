# Competitor search audit v1

October 8, 2026. Baseline: TryBiomod release v6 / commit `06bfc95`. This document separates observed search placement, public-page features and implementation hypotheses. It is not a supplier endorsement, compliance assessment or explanation of ranking causes.

## Actual Google selection

The browser sample used **“buy research peptides”** in Las Vegas Valley, NV 89118. Google's footer reported **“Results are not personalized.”** Phoenix, American and Kylo were the first three organic results observed in that snapshot. These are the three selected comparison companies, not universal market leaders or the top three for every product, location and date. Ads, AI Overview citations and ordinary organic results are distinct.

| Observed organic position | Selected company | Observed model / comparison value |
| --- | --- | --- |
| 1 | [Phoenix Pharmaceuticals](https://phoenixpeptide.com/) | Institutional B2B supplier with research-facility/account approval; useful for technical documentation and procurement clarity, not a like-for-like retail checkout benchmark. |
| 2 | [American Peptides](https://www.americanpeptides.us/) | DTC-style RUO storefront; useful product-size, document and contextual education organization. This is not similarly named buyamericanpeptides.com. |
| 3 | [Kylo Peptides](https://kylopeptides.com/) | DTC-style RUO storefront; useful catalog links, batch-library organization and product documentation layout. |

The same head-term snapshot's AI Overview cited American and PSPeptides. An AI citation does not establish an organic position, click, purchase or quality finding.

Two additional Google snapshots used the same recorded location and non-personalized footer:

| Query | First three observed ordinary results | Selected-company corroboration |
| --- | --- | --- |
| buy BPC-157 research peptide | American Peptides; ProSpec; Kylo | American #1 and Kylo #3. ProSpec is a laboratory-reagent supplier, a different business comparison. |
| buy MOTS-c research peptide | American Peptides; ProSpec; True Research Labs | American #1; Kylo appears #9 in the saved ordinary-result list. Do not relabel that as a top-three product result. |

Google's observed People also ask included “What is the most legit peptide company?” and “How to find a legit peptide supplier?”, plus questions about purchasing legality. Those questions support a supplier-evidence guide; their presence does not establish demand volume, a legal answer or the legitimacy of any company.

Durable public-result evidence: `docs/competitor-search-evidence-v1.json`. Raw Google evidence: `/tmp/biomod-google-generic-serp-v1.json`, `/tmp/biomod-google-bpc-serp-v1.json`, `/tmp/biomod-google-mots-serp-v1.json`. PAA wording was recorded in the root agent's browser accessibility output; it is not a field in those JSON files. Display links omit Google's tracking parameters; the raw files retain observed URLs.

## Public-page coverage and limits

| Company | Coverage | Retrieval and metadata evidence |
| --- | --- | --- |
| Phoenix | 6 pages: home, catalog, representative product, synthesis/quality service, FAQ, ordering | Indexed official text available for all six. Direct web opens: five HTTP 403 responses and one product-page cache miss. No direct-render, metadata/schema or checkout-success claim. |
| American | 6 pages: home, BPC-157, MOTS-C, COA library, About, research library | Audit records six ordinary HTTP 200 responses. HTML titles, headings, links and JSON-LD were inspected. Home has Organization/LocalBusiness/WebSite; sampled products have Product/FAQPage/BreadcrumbList; research library has CollectionPage/BreadcrumbList. Presence is not validation or a ranking explanation. |
| Kylo | 6 pages: home, catalog, BPC-157, MOTS-c, COA library, FAQ | All six pages were readable through the web tool; it did not expose numeric status. Subsequent ordinary raw requests returned HTTP 403 on all six. Titles/structured-data inventory are therefore not independently verified here. The catalog extraction showed an empty-search message; neither full-grid rendering nor broken search is inferred. |

Eighteen representative pages were reviewed across the three sites, not their complete catalogs. No checkout, payment, account, form submission or laboratory-result authentication was performed. Competitor certificates, manufacturing statements, customer reviews and quality promises remain their claims.

## What is missing versus already present

Already present in TryBiomod v6: all 50 catalog records; 31 crawlable vial links on plain `/shop`; search/filter/comparison; 1/3/5/10 packs; per-container/per-mg pricing where supported; product specifications in initial HTML; batch search; original-PDF links where permitted; lot-mismatch/pending safeguards; COA guide; ten readable FAQ answers; shipping/returns information. Do not rebuild or describe those as new missing capabilities.

The following scope is **deployed and verified** in release v7 (October 8, 2026). See `docs/search-visibility-v7.md` for the live checks. Benefits are hypotheses about discovery and decision clarity, not ranking or sales promises.

| Baseline issue / comparison evidence | Scoped change | Intended benefit and verification boundary |
| --- | --- | --- |
| Research navigation uses a noindex category-query URL even though plain `/shop` opens the same vial collection. Competitors expose direct catalog destinations. | Use canonical `/shop` in research navigation and home catalog actions. | Concentrate links on the existing indexable catalog; keep search/facet noindex behavior and legacy category selection working. |
| Initial home grid has 16 products but only six reviewed/index-eligible destinations; ten reviewed products require Load more. | Put the existing 16 reviewed products first in the home grid. | Make eligible products immediately discoverable. Preserve all 50 records and Load more; do not expand the review allowlist. |
| American groups MOTS-C 10/40 mg choices with separate documentation; TryBiomod's two pages do not link to each other. | Explicit “other listed sizes” links for MOTS-c 10/40 mg with exact contents, current stock and independent document status. | Help users find a listed alternative size. The 10 mg record is matched; 40 mg is pending. Never share their certificate, purity result or imply interchangeability. |
| Alphabetical related links promote held entries and repeatedly choose the same three products. | Review-aware related links; prefer verified exact-identity/same-format size relationships, then accurately labeled other research vials. | Improve relevant discovery without promoting held products or inventing scientific relationships between compounds, blends, sprays and softgels. |
| Product pages lack concise answers about their own contents, pack count and documents, despite the general FAQ. | Short SKU-specific questions derived only from existing records; contextual COA-guide links. | Reduce uncertainty at the product page. Preserve distinct matched, mismatched, missing and restricted-document states. |
| The main testing index initially hides report details/PDF links inside a client accordion. Kylo exposes an ordinary document table. | Native `details/summary` with existing styling and filters; record details and allowed PDF anchors in initial HTML, expandable without JavaScript. | Make existing documentation discoverable and usable. Preserve `coaOnRequest` precedence, mismatch warnings, original URLs, previews and current deep-route canonical/noindex policy. |
| Observed PAA asks how to assess supplier legitimacy; competitors offer contextual educational routes. | Published at `/choosing-a-research-supplier`: one original guide explaining identity, lot evidence, test scope, missing handling documents and order costs. Unique metadata, sitemap inclusion and the footer link were verified live. | Answer an observed buyer question without ranking vendors, providing treatment guidance or certifying legality. FDA Q7A section 11.4 is relevant to certificate contents in its API context, not a certification of RUO stores. |

## Remaining evidence, not automatic implementation

Verified per-SKU sequence/chemical form, molecular weight, storage conditions and authentic SDS could improve technical clarity, but require authoritative documentation for the exact sold material. Do not derive them from competitor copy or manufacture an SDS. Historical/current-lot designations also need actual supply records.

A specific existing inconsistency also needs source reconciliation: the MOTS-c 10 mg vial artwork displays “>98% HPLC,” while its published matching-lot record displays “97.07% + 0.18%.” This release preserves the artwork and laboratory result; the label claim should be checked against the original method and report before making a quality promise. The live screenshot is `/tmp/biomod-competitor-improvements-v1.png`.

Named technical staff, manufacturing location, certifications, response commitments and finalized policies require owner evidence and approval of the facts. Existing review-draft policy language cannot be made final by borrowing competitor terms. Subscriptions, discounts, international delivery, payment methods and institutional credit accounts are commercial/operational decisions, not automatic SEO changes.

This audit did not measure backlinks, traffic, paid acquisition, conversion or search volume. Future backlink research can identify genuine editorial references and relevant relationships, but cannot establish that links caused the sampled positions. No purchased ranking-credit links, fake mentions, fabricated reviews, universal laboratory claims or mass keyword pages are justified. Google identifies paid ranking-credit links and optimized links in distributed releases as link-spam risks; search performance is not guaranteed.

## Primary source URLs

**Phoenix, six pages:** [home](https://phoenixpeptide.com/), [catalog](https://phoenixpeptide.com/product-categories/), [sample product](https://phoenixpeptide.com/products/boc-phe-leu-phe-leu-phe/), [custom synthesis/quality](https://phoenixpeptide.com/services/custom-peptide-protein-synthesis/), [FAQ](https://phoenixpeptide.com/frequently-asked-questions/), [ordering](https://phoenixpeptide.com/order_information/).

**American, six pages:** [home](https://americanpeptides.us/), [BPC-157](https://americanpeptides.us/products/bpc-157), [MOTS-C](https://americanpeptides.us/products/mots-c), [COAs](https://americanpeptides.us/pages/coa), [About](https://americanpeptides.us/pages/about), [research library](https://americanpeptides.us/learn).

**Kylo, six pages:** [home](https://kylopeptides.com/), [catalog](https://kylopeptides.com/catalog/), [BPC-157](https://kylopeptides.com/product/bpc-157/), [MOTS-c](https://kylopeptides.com/product/mots-c/), [COAs](https://kylopeptides.com/coa/), [FAQ](https://kylopeptides.com/faq/).

**Official context:** [FDA Q7A guidance, certificate section 11.4](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q7a-good-manufacturing-practice-guidance-active-pharmaceutical-ingredients), [Google's current AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies).

Kylo direct-status evidence: `/tmp/biomod-kylo-http-audit-v1.json`.

Temporary detailed audits: `/tmp/biomod-phoenix-audit-v1.md`, `/tmp/biomod-american-audit-v1.md`, `/tmp/biomod-kylo-audit-v1.md`. American inner-page metadata: `/tmp/biomod-american-pages-v1.json`; home: `/tmp/biomod-american-home-v1.html`. Baseline implementation evidence: `docs/search-visibility-v6.md`.

## Appendix: separate search-tool samples

These are a **different search surface**, obtained through three separate tool queries. They neither select nor rerank the three companies above. The underlying engine's localized Google equivalence is not established.

| Returned supplier order | buy BPC-157 research peptide | buy MOTS-c research peptide | buy Semax research peptide |
| --- | --- | --- | --- |
| 1 | apexlab.org | truebondlabs.com | akhbiolabs.com |
| 2 | truebondlabs.com | blackwellbiolabs.com | reserveresearch.com |
| 3 | biopepusa.com | americanresearchcompany.com | blackwellbiolabs.com |
| 4 | labfirstpeptides.com | peptselect.com | northlinelabs.org |
| 5 | eppixlabs.com | olympusbiologics.com | peptides.net |

First five distinct relevant direct-supplier domains were retained in returned order; news, Reddit, reference articles, directories and affiliates were excluded. None of the selected results was labeled an ad; unlabeled paid status was not independently established. All selected listings were DTC-style RUO storefronts by their direct product-purchase presentation. Raw result headings, URLs and classification caveats: `/tmp/biomod-competitor-serp-products-v1.json`. Do not merge these rows with the actual Google positions.
