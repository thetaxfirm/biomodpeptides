# Label-purity COA reports v1

October 12, 2026. Owner instruction: the labels claim 98% purity or better; show the better report for the label lot where one exists. Contributor: Claude. TryBiomod only. Follows `coa-label-lot-reports-2026-10-12-v1.md`.

| Product | Label lot | Report now shown | Purity | Replaces |
| --- | --- | --- | --- | --- |
| Epitalon 50 mg | 407-50-0001 | Freedom Diagnostics BIOM2604200371, reported 04/22/2026 | 99.49%, 51.78 mg | Vanguard V260304-6 016 (97.05%) |
| Tesamorelin 10 mg | 301-10-0001 | Freedom Diagnostics BIOM2604200372, reported 04/22/2026 | 99.92%, 11.52 mg | Vanguard V260304-6 012 (96.28%) |
| NAD+ 500 mg | 405-500-0001 | Vanguard V260304-6 009 30-day frozen stability report, 5/11/2026 | NAD+ 98.02% (Day 30), total >99.80%, 643 mg | Vanguard V260812-35 007 (94.59%, 8/27/2026) |

Sources: the Freedom reports are the attachments to the April 24, 2026 "Lab Reports 04/20/2026" email (also filed in Dropbox `BIOMOD/_From Desktop 2026-07/19 frozen/04_Website COA`); the NAD+ report is `BIOMOD/_From Desktop 2026-07/19 frozen/NAD.pdf`. Each PDF is hosted unchanged under `/certificates/` and checked by SHA-256. The NAD+ record keeps both printed columns (Day 0 97.18%, Day 30 98.02%). The Freedom reports cover identity, purity and net content only; the Vanguard 30-day report covers purity and quantity only.

The replaced documents are removed from the reconciliation file and their hosted copies deleted; the September source history keeps the original Vanguard links for Epitalon.

No report at 98% or better was found for Glutathione 703-1500-0001 (Vanguard V260812-35 004, 96.01%) or MOTS-c 10 mg 409-10-0001 (Vanguard 97.07%, Freedom BIOM2604200367 97.10%). They keep their current matching-lot reports.

`tests/label-lot-reports-v1.cjs` now also asserts every published purity on these associations is at least 98%. `tests/tesamorelin-report-reconciliation-v1.cjs` targets the Freedom report and finds the Tesamorelin document by its reconciliation rather than by position.
