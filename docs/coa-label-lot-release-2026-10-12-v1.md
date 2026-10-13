# Label-lot COA release, October 12, 2026

Author: Claude, at the owner's request ("match the COA to label, that is a must"). Source note: `coa-label-lot-reports-2026-10-12-v1.md`.

## Change

Commit a41fc3f. Run & Gun (501-10-0001), KLOW 80 mg (503-80-0001), NAD+ 500 mg (405-500-0001) and Epitalon 50 mg (407-50-0001) now show the Vanguard report for the lot printed on the vial label. Each lot was read from the printed label artwork (February 19, 2026 label files) and matches the store's listed lot. Matching-lot certificates on `/testing`: 16 before, 19 after (Epitalon was already matched and now shows the complete May 10 report instead of the one-page April 2 partial).

## Verification

- `npm run check:release`: TypeScript and 64 suites passed (new `label-lot-reports-v1.cjs`). `BIOMOD_DEPLOY=true npm run build` completed on the rebased tree including 26e4303.
- Cloudflare version 3d3f6c9f-0f5b-47a5-ae28-1d197d188aac deployed 2026-10-13T05:38Z. The next deployment (05:39:42Z, shipping services 5a3283e/9ac0cd0) was built on top of a41fc3f; live state still shows 19 afterward. GitHub Website consistency run 38352536505 (9ac0cd0, includes a41fc3f) succeeded; the a41fc3f run was cancelled as superseded.
- Live, read-only: `/api/store/state` reports 19 Matching-lot certificate, 30 Documentation pending, 3 Original COA available on request. Each of the four products shows listed lot = certificate lot and its `/certificates/` PDF URL. All four PDFs return 200 `application/pdf` with SHA-256 equal to the Vanguard originals (3c58e133, 19fedb5d, 7cea36d6, 433474a2). `/testing` renders 52 / 19 / 30. The KLOW product page certificate dialog opens the hosted PDF (lot 503-80-0001, reported 5/10/2026); no console errors.
- Change history import ran; commit a41fc3f and version 3d3f6c9f are recorded.

## Open items

- No passing report for the label lot: KPV 402-10-0001, SLU-PP-332 705-05-0001, 5-Amino-1MQ 704-50-0001, MOTS-C 40 mg 701-40-0001. These stay "Documentation pending".
- HEAT-T and C-HEAT-S have passing May 10 retest reissues but are not in the private original registry, so they still read "Documentation pending" rather than "Printed COA included with order". Registering them is an owner admin action.
- Selank and Semax labels carry LYO-028-2608-02 and LYO-029-2608-01; only ILS "001-b"/"001-R" reports exist. Sprays and softgels have raw-material reports only.
