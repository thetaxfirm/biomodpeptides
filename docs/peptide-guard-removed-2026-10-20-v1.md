# Peptide wording guard removed (October 20, 2026) v1

## Request

The owner asked on October 20, 2026 to remove the guard test that blocked the word "peptide"
in public store copy. The guard came from the October 17 rename to Biomod Research Supply
Company (docs/no-peptide-wording-release-2026-10-17-v1.md).

## Change

- Deleted `tests/no-peptide-wording-v1.cjs` and its entry in `scripts/release-check.mjs`.
- Removed the duplicate "no peptide wording" assertion from `tests/product-description-v1.cjs`.
  Its dosing, use and effect-claim checks and its HEAT-name check are unchanged.
- Kept `tests/product-research-details-v1.cjs`, which checks the factual point that NAD+ is a
  cofactor and not a peptide.

## What did not change

No page, copy, title, schema or llms.txt text changed. The live site still reads
"Biomod Research Supply Company" and "research compounds". This only allows future copy to use
the word again.

## Verification

- `npm run check:release`: TypeScript and 99 isolated suites passed.
- `BIOMOD_DEPLOY=true npm run build` passed before push; Workers Builds deploys main.
