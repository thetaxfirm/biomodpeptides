# "Peptide" wording restored: release v1

November 15, 2026. Author: Claude. Owner instruction, November 14: "start loading peptide everywhere so people can find us." This supersedes the October 17 and October 23 instructions to remove the word.

## What changed

- Titles and descriptions (`lib/seo-policy.ts`): home "Buy Research Peptides Online | Biomod | TryBiomod"; shop "Buy Peptides for Research Online"; FAQ "How to Buy Research Peptides"; COA guide "How to Read a Peptide COA"; supplier guide "Choosing a Research Peptide Supplier"; compound index "Peptide Reference: CAS and MW"; collections index "Shop Research Peptides by Area".
- Product pages: a vial whose compound is a peptide is titled "Buy <name> Peptide Vial" and described as a "research peptide". `isPeptideVial` uses the reviewed list in `lib/product-search.ts` plus single compounds with a published sequence. NAD+, blends, sprays, softgels and supplies are not called peptides. When a description would pass 160 characters, the alias list is kept and the words "research peptide" are dropped.
- Headings and copy: home h1 "Buy research peptides." and its button; shop heading; "All research peptides and compounds" index; FAQ buying section; both guides' h1; collection titles and "Browse all research peptides" links; research notes on product pages say "peptide" again where the cited literature does.
- Structured data: Organization gains alternateName "Biomod Peptides"; llms.txt says "research peptide vials (formerly Biomod Peptides, biomodpeptides.com)".
- Sitemap: `siteLastmod` is November 15.

## Unchanged on purpose

- The store name stays Biomod Research Supply Company.
- The softgel marks stay "RUO Softgel" (a trademark question).
- Catalog identity names (Emideltide, Prezatide Copper, Ala-Glu-Asp-Gly) and COA data files.
- No dosing, handling or human-use wording; the collections and compound-reference tests still forbid it.
- HEAT products stay name-only.

## Open risk recorded for the owner

The owner has not said what the card processor was told the store sells. The wording was removed in October; if that was at the processor's request, this release reverses it.

## Checks

- `npm run check:release`: TypeScript and 132 suites passed. Updated expectations: search-buy-intent, description-aliases, editorial-vial-links, collections, compound-reference.
- `BIOMOD_DEPLOY=true npm run build`: passed.
