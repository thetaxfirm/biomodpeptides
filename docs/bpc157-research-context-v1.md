# BPC-157 research context v1

October 10, 2026. Author: Codex. Base: `aadaabf`. Scope: TryBiomod only, existing `/product/bpc-157-10mg` route.

## Gap and bounded change

The product's existing description is an identity-and-quantity sentence. An isolated local render of all 17 eligible product pages confirmed literature context only on the four MOTS-c and SS-31 routes. Add one BPC-157 entry to the existing visible research section, keeping its placement, styling, study limits and current-product batch link.

The prior competitor audit sampled the query `buy BPC-157 research peptide` (`docs/competitor-search-audit-v1.md`, line 21). That observed search-result sample supports prioritizing this existing product page; it is not measured query volume, current ranking evidence or proof of conversion demand.

## Primary evidence

Chang C-H, Tsai W-C, Hsu Y-H, Pang J-HS. “Pentadecapeptide BPC 157 Enhances the Growth Hormone Receptor Expression in Tendon Fibroblasts.” *Molecules* 2014;19(11):19066–19077. DOI: `10.3390/molecules191119066`.

Visible citation: [PubMed, PMID 25415472](https://pubmed.ncbi.nlm.nih.gov/25415472/). The accessible primary abstract describes a pentadecapeptide, tendon fibroblasts isolated from rat Achilles tendon, and investigation of growth-hormone-receptor expression and related signaling. The storefront paraphrases only those identity, model and study-focus facts. It reports no treatment outcome.

Independent source checking also recovered indexed primary abstract/methods excerpts from [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6271067/) and the [publisher](https://www.mdpi.com/1420-3049/19/11/19066). Direct PMC access returned a challenge and the publisher returned HTTP 429. This is not a claim of unrestricted full-text retrieval; neither restriction was bypassed. The page links to the accessible PubMed record.

## Preservation and validation

Only the exact `bpc-157-10mg` slug is added, still subject to `eligibleDiscovery`. Existing lot disclosures remain independent from literature context. No product benefit, dose, human-use, salt, sequence, purity, efficacy or BioMod-tested-material claim is added. Catalog, stock, price, certificates, metadata, publication holds, other products and BiomodPro are untouched.

The existing product-research regression is extended to five exact eligible pages. It verifies the BPC-157 citation and model, keeps sources distinct from MOTS-c and SS-31, excludes unknown sizes and later holds, renders the actual product page, and preserves all batch statuses and source records.

Passed: `tests/product-research-details-v1.cjs`, `tests/product-discovery-v1.cjs`, `tests/product-specifications-v1.cjs`, `tsc --noEmit --incremental false`, and `git diff --check`.

No commit, build, deployment, live storefront call, order or gateway operation is part of this implementation. Release verification is separate. No ranking, traffic or sales outcome is claimed.
