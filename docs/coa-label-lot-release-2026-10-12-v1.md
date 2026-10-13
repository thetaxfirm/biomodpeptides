# Label-lot COA release, October 12, 2026

Author: Claude, at the owner's request ("match the COA to label, that is a must"). Source note: `coa-label-lot-reports-2026-10-12-v1.md`.

## Change

Commit a41fc3f. Run & Gun (501-10-0001), KLOW 80 mg (503-80-0001), NAD+ 500 mg (405-500-0001) and Epitalon 50 mg (407-50-0001) now show the Vanguard report for the lot printed on the vial label. Each lot was read from the printed label artwork (February 19, 2026 label files) and matches the store's listed lot. Matching-lot certificates on `/testing`: 16 before, 19 after (Epitalon was already matched and now shows the complete May 10 report instead of the one-page April 2 partial).

## Verification

- `npm run check:release`: TypeScript and 64 suites passed (new `label-lot-reports-v1.cjs`). `BIOMOD_DEPLOY=true npm run build` completed on the rebased tree including 26e4303.
- Cloudflare version 3d3f6c9f-0f5b-47a5-ae28-1d197d188aac deployed 2026-10-13T05:39:42Z (correction: an earlier draft of this log misattributed this deployment to the shipping release). GitHub Website consistency run 38352536505 (9ac0cd0, includes a41fc3f) succeeded; the a41fc3f run was cancelled as superseded.
- Live, read-only: `/api/store/state` reports 19 Matching-lot certificate, 30 Documentation pending, 3 Original COA available on request. Each of the four products shows listed lot = certificate lot and its `/certificates/` PDF URL. All four PDFs return 200 `application/pdf` with SHA-256 equal to the Vanguard originals (3c58e133, 19fedb5d, 7cea36d6, 433474a2). `/testing` renders 52 / 19 / 30. The KLOW product page certificate dialog opens the hosted PDF (lot 503-80-0001, reported 5/10/2026); no console errors.
- Change history import ran; commit a41fc3f and version 3d3f6c9f are recorded.

## Open items

- No passing report for the label lot: KPV 402-10-0001, SLU-PP-332 705-05-0001, 5-Amino-1MQ 704-50-0001, MOTS-C 40 mg 701-40-0001. These stay "Documentation pending".
- HEAT-T and C-HEAT-S have passing May 10 retest reissues but are not in the private original registry, so they still read "Documentation pending" rather than "Printed COA included with order". Registering them is an owner admin action.
- Selank and Semax labels carry LYO-028-2608-02 and LYO-029-2608-01; only ILS "001-b"/"001-R" reports exist. Sprays and softgels have raw-material reports only.

## Follow-up release: label purity (commit 592127c)

Owner instruction: labels claim 98% or better; show the better report for the label lot. Epitalon now shows Freedom Diagnostics BIOM2604200371 (99.49%), Tesamorelin BIOM2604200372 (99.92%), NAD+ the Vanguard 30-day frozen report V260304-6 009 (98.02%). Details: `coa-label-purity-reports-2026-10-12-v1.md`.

- `npm run check:release` (65 suites) and `BIOMOD_DEPLOY=true npm run build` passed on main 96274f8 plus this commit.
- Cloudflare version 867322b5-a235-49b0-bf16-4322b44fcf26 deployed 2026-10-13T05:50:23Z from 592127c. This deployment also carries shipping services 5a3283e/9ac0cd0 (no migration; their own release log records their checks).
- Live, read-only: 19 Matching-lot certificate. Epitalon 99.49% / BIOM2604200371, Tesamorelin 99.92% / BIOM2604200372, NAD+ >99.80%; 98.02% / V260304-6 009. The three new PDFs return 200 with SHA-256 matching the originals (48ba37b0, 111fca0d, 0220a332); the two replaced hosted PDFs return 404. Tesamorelin product page shows lot 301-10-0001, 99.92%, 11.52 mg; no console errors.
- Still below 98% with no better report on file: Glutathione 703-1500-0001 (96.01%), MOTS-c 409-10-0001 (97.07%; Freedom 97.10%).
