# CAS correction and Oxy wording release, October 26, 2026 v1

Author: Claude, on the owner's instructions "fix the cas numbers now" and "not mention oxytocin, call it oxy". Source commit `c1de0ca` on main.

## CAS corrections

Every replacement was checked against PubChem and the CAS check digit.

| Product(s) | Was | Now | Reason |
|---|---|---|---|
| GLOW spray, KLOW spray, GLOW 70mg, KLOW 80mg, GHK-Cu 50mg, LUMEN | 49557-75-7 for GHK-Cu | 89030-95-5 | Old number is copper-free GHK |
| LUMEN (AHK-Cu) | 89030-95-5 | 682809-81-0 | Old number is GHK-Cu |
| DELTA, NOCTIS (Pinealon) | 147551-89-5 | 175175-23-2 | Old number fails the check digit |
| NOCTIS (melatonin) | missing on product page | 73-31-4 | Already in the batch record source |
| ERASER (tesofensine) | 457657-66-8 | 195875-84-4 | Old number not registered |
| SLU-PP-332 | 2245445-83-6 | 303760-60-3 | Old number fails the check digit |
| 5-Amino-1MQ | 331717-54-1 | 685079-15-6 (cation) | Old number fails the check digit; salt form still on hold |

Unchanged: Lipo-C (two invalid numbers, CAS hidden behind its specification hold until the supplier formula sheet). Specification holds and publication holds are unchanged.

## Oxy wording

Product names, identities, descriptions and batch-record fields for IGNITE and NOCTIS say "Oxy" instead of "oxytocin". The CAS number 50-56-6 is unchanged.

Not changed, on purpose:
- The IGNITE URL `/product/ignite-pt-141-oxytocin-spray` and its image filename. Runtime lot records are keyed by slug; renaming needs a redirect and a lot-record migration.
- The IGNITE product photo, which shows the physical label printed "PT-141 + OXYTOCIN". Editing it would make the photo differ from the bottle that ships.
- `lib/catalog-source-v1.json`, the original-site provenance file. It is not imported or served.

## Files and tests

- `lib/catalog-facts-v2.json`, `lib/coas-source-v1.json`, `lib/product-editorial-v1.json`.
- New `tests/catalog-cas-v1.cjs` (in the release gate): every product and batch CAS passes its check digit, GHK-Cu never uses 49557-75-7, corrected identifiers hold, and no product text says oxytocin.
- `tests/product-search-blend-strength-v1.cjs` queries updated to the Oxy wording.
- `npm run check:release`: TypeScript and 103 isolated suites passed.

## Live verification

Workers Builds and release-check succeeded for `c1de0ca`. Fresh live reads show the corrected CAS on GLOW spray, KLOW spray, LUMEN, DELTA, NOCTIS and ERASER, and zero visible "oxytocin" on those pages, IGNITE, `/`, `/shop` and `/testing`. The word remains only inside the IGNITE link URL and image filename, as noted above.
