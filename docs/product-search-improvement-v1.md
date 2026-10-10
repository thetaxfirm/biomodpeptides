# TryBiomod on-site peptide search improvement v1

Date: October 10, 2026. Author: Codex product-audit agent. Draft implementation, not deployed or committed by this agent. The preceding read-only audit used fetched shared main `3741498c81ddcb0fa168c2204f8f4b33d0dd66a8`. The root agent owns the separate release and live verification.

## Observed problem

The live `/shop?q=BPC157%20peptide` returned HTTP 200 with “No products match these filters.” The current matcher also returned no products for `SS31 50mg peptide` and `MOTS C 40mg peptide`; generic `peptides` returned only DSIP. The Research Compounds category does not contain the word peptide, although these specific reviewed listings are peptide vials.

A separate identity/strength issue was confirmed in the source matcher: `SS31 21mg` could match a 10 mg or 50 mg vial because the numeric term 21 occurs in its CAS identifier `736992-21-5`. Numeric token equality alone did not prove that the requested strength matched the actual container size.

This is on-site search behavior, not an external Google ranking claim. No search-position, traffic or conversion gain is asserted.

## Change

`lib/product-search.ts` now:

- Recognizes peptide/peptides as contextual shopping vocabulary for an explicit list of 16 reviewed peptide vial products. It requires the existing `eligibleDiscovery` check as well as the Vial format. The list is deliberate, not inferred from the legacy Research Peptides category. NAD+ and other non-peptides are not labeled or matched as peptide products.
- Keeps withheld or unreviewed products out of the new contextual peptide discovery. Existing explicit name, CAS and SKU searches continue; search does not change their publication, availability or purchasing status.
- Preserves exact quantity plus unit together. A query containing an explicit mg/mcg/g/mL quantity must find that same quantity/unit in the product's listed container size. It cannot borrow digits from a CAS identifier, SKU, molecule name, different strength, or blend component. Unit conversion and fuzzy numeric matching are not introduced.
- Adds the exact spelling `Epithalon` only to the reviewed Epitalon 50 mg listing, using its existing original lab certificate. It is not an alias for all products containing an Epitalon component, and it disappears if that product is later held.
- Retains existing ranking priorities, punctuation/spacing normalization, real product identities, form labels and documented stock. No hidden page text, meta keywords, claim copy or new sitemap entries were added. Both the shop and pack builder use this existing matcher; pack eligibility still applies independently.

The explicit peptide-vial list is AOD 9604, BPC-157, DSIP, Epitalon, reduced L-glutathione, Kisspeptin, KPV, MOTS-c 10 mg and 40 mg, PT-141, Selank, Semax, SS-31 10 mg and 50 mg, Tesamorelin and Thymosin Alpha-1. Future products require explicit classification/review before being added to this list.

## Alias and classification evidence

The existing [original Epithalon 50 mg certificate](https://biomodpeptides.com/wp-content/uploads/2026/05/Epithalon_50mg_55c88823.pdf) returned HTTP 200 and actual PDF bytes during the audit. Its complete single page was extracted and visually rendered. The heading and Compound field both say Epithalon, report `V260304-6 016`, lot `407-50-0001`, reported April 2, 2026. That is the report and lot published on the current Epitalon 50 mg product page. The alternate spelling is therefore tied to the existing exact product record, rather than assumed from a search result or filename alone. The original certificate was not changed. This reading does not independently authenticate the sampled material or override the report's sampling limitations.

Reduced L-glutathione is included because it is a tripeptide, as described by [PubChem's Glutathione record](https://pubchem.ncbi.nlm.nih.gov/compound/L-glutathione), which also lists the catalog's CAS `70-18-8`. This taxonomy check adds no clinical, absorption or efficacy claim. NAD+ remains a distinct non-peptide compound and is still searchable by its own name/strength/CAS without a peptide qualifier.

## Validation

New `tests/product-search-peptide-v1.cjs` exercises the real matcher and actual catalog, including:

- The exact 16-product set for peptide, peptides and research peptides.
- BPC157, SS31, MOTS-c, Elamipretide and glutathione queries with correct strengths, plus Epithalon case variants.
- Wrong strengths, CAS-number collisions, multiple incompatible quantities, wrong units and wrong formats.
- Non-peptide negatives, including NAD+, SLU-PP-332, 5-Amino-1MQ, ERASER/tesofensine, methylene blue and Lipo-C.
- No substitution of held blends, sprays or softgels for a named reviewed single-compound vial.
- Original exact name/CAS/SKU lookups; dynamic removal of contextual vocabulary and the alias when a product is held; no mutation of catalog facts or stock; unchanged 17 eligible product URLs.

Passed locally: new matcher test; `storefront-search-v2.cjs`; `search-visibility-v1.cjs`; `search-readable-facts-v1.cjs`; `product-research-details-v1.cjs`. `tsc --noEmit --incremental false` and `git diff --check` also passed.

## Ownership and release boundary

Owned files only: `lib/product-search.ts`, `tests/product-search-peptide-v1.cjs`, this document. Do not include concurrent measurement implementation files or the unrelated SS-31/Wolverine inventory drafts in the search-only commit.

No production deployment, live post-change search verification, Git commit or push was performed by this agent. The parent must build and release this change separately from the measurement release, then verify the original failing query, one alternate strength, the lab-backed spelling and negative identity/strength cases on the live storefront. A successful test is not a claim that customer search outcomes or external rankings have improved.
