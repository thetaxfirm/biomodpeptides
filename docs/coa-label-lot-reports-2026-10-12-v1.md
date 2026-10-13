# Label-lot COA reports v1

October 12, 2026. Owner instruction: the COA shown must match the lot printed on the vial label. Contributor: Claude. TryBiomod only. Baseline shared main `981fe9a`.

## Change

Four Vanguard reports for the exact lot printed on each vial label are now published. Each PDF is the unchanged original, hosted at `/certificates/` and checked by SHA-256.

| Product | Label lot | Report | Why this version |
| --- | --- | --- | --- |
| Run & Gun 10 mg | 501-10-0001 | V260304-6 020, 4/8/2026 | Only full report for the lot; all tests pass |
| KLOW 80 mg | 503-80-0001 | V260304-6 022, 5/10/2026 | Retest reissue; the 4/8 copy recorded a sterility failure later superseded |
| NAD+ 500 mg | 405-500-0001 | V260812-35 007, 8/27/2026 | Most recent report for the lot (the 4/8 V260304-6 009 is older) |
| Epitalon 50 mg | 407-50-0001 | V260304-6 016, 5/10/2026 | Complete two-page retest reissue; replaces the one-page 4/2 partial |

The previous ILS "001-B" placeholder reports for KLOW, NAD+ and Run & Gun stay in the source history and remain staff-only.

Code: `normalizedStrength` treats "50mg / vial" as 50mg and totals a same-unit blend ("5 mg/5 mg" is 10mg); the reconciliation check reads the report's own compound name (`reported_compound`) and accepts the laboratory's capitalization of the report recipient. Identity, strength, lot and hash checks are otherwise unchanged and still fail closed.

## Not published

These lots have no passing report on file, so they remain "Documentation pending": KPV 402-10-0001 (V260304-6 006: assay not detected, sterility fail), SLU-PP-332 705-05-0001 (V260812-35 006: below quantification), 5-Amino-1MQ 704-50-0001 (V260812-35 005: 5.53 mg against 50 mg), MOTS-C 40 mg 701-40-0001 (V260812-35 002: identity pending, sterility fail). Selank and Semax only have ILS "001-b"/"001-R" reports that do not carry the label lot. Sprays and softgels have raw-material reports only.

## Validation

`npm run check:release` (64 suites, including the new `tests/label-lot-reports-v1.cjs`) and `BIOMOD_DEPLOY=true npm run build` passed. `tests/product-research-details-v1.cjs` and `tests/tesamorelin-report-reconciliation-v1.cjs`, outside the gate, were updated for the new NAD+ state and pass. Live verification is recorded in the release log.
