# Epitalon and DSIP research context v1

October 10, 2026 Pacific / October 11 UTC. Author: Codex. Base: 1286c707. Scope: TryBiomod only.

## Observed gap and product scope

The live Epitalon 50 mg and DSIP 10 mg pages had short identity/quantity descriptions and common packaging/document questions, but no molecule-specific literature context. This was verified in the browser before editing. The existing Epithalon search alias already works and is not changed by this release. Search Console has not established demand or performance for these queries; this is a content-quality improvement to existing reviewed products, not a claim of measured ranking opportunity.

Exact routes: /product/epitalon-50mg (product 759, SKU BM-LYO-016, lot 407-50-0001) and /product/dsip-10mg (product 762, SKU BM-LYO-019, lot 410-10-0001). Their saved and visibly published product/certificate lot numbers match. This is evidence of the site's current published records, not new laboratory authentication. Current runtime prices and availability are preserved; the historical imported price fields are not pricing authority.

## Primary evidence

- Khavinson, Bondarev and Butyugov (2003), Bulletin of Experimental Biology and Medicine, 135(6):590-592. PMID 12937682. DOI 10.1023/a:1025493705728. https://pubmed.ncbi.nlm.nih.gov/12937682/. The indexed primary abstract describes Epithalon in cultured human fetal fibroblasts, examining telomerase catalytic-subunit expression, enzymatic activity and telomere elongation. The page identifies this as a cell-culture study and does not repeat the abstract's lifespan extrapolation.
- Schoenenberger and Monnier (1977), Proceedings of the National Academy of Sciences, 74(3):1282-1286. PMID 265572. DOI 10.1073/pnas.74.3.1282. https://pubmed.ncbi.nlm.nih.gov/265572/. The indexed primary abstract identifies a nine-residue peptide and compares synthetic DSIP with related peptides in rabbits using EEG analysis. The page summarizes characterization and delta/spindle EEG patterns without administration instructions or a sleep-benefit claim.

Root and an independent reviewer checked the primary indexed abstracts and citation metadata. Direct PubMed page extraction was incomplete. No full-text review, systematic review or comprehensive/current scientific consensus is claimed. These are clearly dated individual studies. Their methods and observations do not add sequence, salt, manufacturing origin, purity, efficacy or human-use suitability to the catalog or batch reports.

## Implementation and validation boundary

Two exact slug mappings are added after the existing publication-eligibility check in ProductResearchDetails. The seven previously reviewed literature sections remain unchanged. The sections are visible in server-rendered HTML and link to each product's own current batch record. Existing catalog facts, original PDFs, price/stock, purchase controls, layout and publication holds remain unchanged.

The existing SSR integration test is extended to cover nine exact eligible routes, correct primary links/DOIs, experimental settings, own-lot links, future holds and preservation of catalog/certificate data. Production build, review and live deployment evidence belong in the dated work log and immutable scorecard v19. Expected outcome: more informative eligible product pages and a clearer path from literature to the actual batch record. Traffic, ranking and sales effects remain unmeasured.
