# TryBiomod remaining eligible vial artwork audit v1

October 10, 2026. Read-only audit of all 15 eligible images other than Epitalon 50 mg and MOTS-C 40 mg, which the parent is already correcting. No repository, original certificate, inventory, source image, account or deployment changes were made.

**Finding: seven additional images require correction.** Glutathione 1500 mg and MOTS-c 10 mg contradict their matching-lot published purity results. KPV 10 mg has a purity claim without a published certificate. NAD+ 500 mg, Selank, Semax and Tesamorelin have claims that the available different-lot certificates do not verify. SS-31 50 mg already has no purity/HPLC claim; do not change it for this issue.

## Direct inspection and current page evidence

The actual catalog/imagePath mapping selected 14 brand-v37 SVGs and one SS-31 50 mg WebP. All 15 assets were rendered with Sharp into /tmp and inspected in both a full-vial sheet and a readable label-detail sheet. Glutathione, MOTS-c 10 mg and SS-31 50 mg were also inspected individually at source resolution. All label readings below are visual readings, not inferred from the template.

Ordinary live GETs with ?measurement=off at 2026-10-10T21:00:56-58Z returned HTTP 200 for all 15 product pages. Each referenced the exact mapped image. Separate live asset GETs returned HTTP 200 and SHA-256 matched the source bytes for every inspected image. Asset verification ran from 2026-10-10T21:01:44.747799+00:00 through 2026-10-10T21:01:45.623667+00:00. No browser collector or synthetic production event was used.

| Product label, read directly | Exact purity text in image | Current page / original record evidence | Assessment |
| --- | --- | --- | --- |
| [AOD 9604 / 10 MG](https://trybiomod.com/product/aod-9604-10mg) | `>98% HPLC` | Matching lot 406-10-0001; page purity `>99.80% + 0.18%`; original record method HPLC-UV/VIS. | Numerically consistent with the disclosed matching-lot result; not an independent certification. |
| [BPC-157 / 10 MG](https://trybiomod.com/product/bpc-157-10mg) | `>98% HPLC` | Matching lot 201-10-0001; page purity `>99.80% + 0.18%`; original record method HPLC-UV/VIS. | Numerically consistent with the disclosed matching-lot result; not an independent certification. |
| [DSIP / 10 MG](https://trybiomod.com/product/dsip-10mg) | `>98% HPLC` | Matching lot 410-10-0001; page purity `98.69% + 0.18%`; original record method HPLC-UV/VIS. | Numerically consistent with the disclosed matching-lot result; not an independent certification. |
| [GLUTATHIONE / 1500 MG](https://trybiomod.com/product/glutathione-reduced-l-glutathione) | `>98% HPLC` | Matching lot 703-1500-0001; page purity `96.01% + 0.18%`; HPLC-UV/VIS in original record. | Contradiction: remove unsupported threshold. |
| [KISSPEPTIN / 10 MG](https://trybiomod.com/product/kisspeptin-10mg) | `>98% HPLC` | Matching lot 404-10-0001; page purity `>99.80% + 0.18%`; original record method HPLC-UV/VIS. | Numerically consistent with the disclosed matching-lot result; not an independent certification. |
| [KPV / 10 MG](https://trybiomod.com/product/kpv-10mg) | `>98% HPLC` | Documentation pending; listed lot 402-10-0001; Purity: Not verified for this lot. | Unsupported claim: no published matching certificate. |
| [MOTS-c / 10 MG](https://trybiomod.com/product/mots-c-10mg) | `>98% HPLC` | Matching lot 409-10-0001; page purity `97.07% + 0.18%`; HPLC-UV/VIS in original record. | Contradiction: remove unsupported threshold. |
| [NAD+ / 500 MG](https://trybiomod.com/product/nad-500mg) | `>98% HPLC` | Page says Not verified for this lot; listed 405-500-0001 vs certificate 001-B. Different-lot extracted HPLC result 99.45% does not verify the listed lot. | Unsupported for listed lot. |
| [PT-141 / 10 MG](https://trybiomod.com/product/pt-141-10mg) | `>98% HPLC` | Matching lot 403-10-0001; page purity `99.54% + 0.18%`; original record method HPLC-UV/VIS. | Numerically consistent with the disclosed matching-lot result; not an independent certification. |
| [SELANK / 10 MG](https://trybiomod.com/product/selank) | `>98% HPLC` | Page says Not verified for this lot; listed LYO-028-2608-02 vs certificate 001-b. Different-lot extracted HPLC result 99.38% does not verify the listed lot. | Unsupported for listed lot. |
| [SEMAX / 10 MG](https://trybiomod.com/product/semax) | `>98% HPLC` | Page says Not verified for this lot; listed LYO-029-2608-01 vs certificate 001-R. Different-lot extracted HPLC result 99.18% does not verify the listed lot. | Unsupported for listed lot. |
| [SS-31 / 10 MG](https://trybiomod.com/product/ss-31-10mg) | `>98% HPLC` | Matching lot 408-10-0001; page purity `99.62% + 0.18%`; original record method HPLC-UV/VIS. | Numerically consistent with the disclosed matching-lot result; not an independent certification. |
| [SS-31 / 50 MG](https://trybiomod.com/product/ss-31-50mg) | None: blank below 50 MG | Documentation pending; listed lot Not listed; Purity: Not verified for this lot. | No claim present; retain this absence. |
| [TESAMORELIN / 10 MG](https://trybiomod.com/product/tesamorelin-10mg) | `>98% HPLC` | Page says Not verified for this lot; listed 301-10-0001 vs certificate 001-B. Different-lot extracted HPLC result 99.76% does not verify the listed lot. | Unsupported for listed lot. |
| [THYMOSIN ALPHA-1 / 10 MG](https://trybiomod.com/product/thymosin-alpha-1-10mg) | `>98% HPLC` | Matching lot 401-10-0001; page purity `>99.80% + 0.18%`; original record method HPLC-UV/VIS. | Numerically consistent with the disclosed matching-lot result; not an independent certification. |

## Exact affected mapped files and rendered inputs

- `public/products/glutathione-reduced-l-glutathione-brand-v37.svg` -> `/tmp/trybiomod-vial-artwork-audit-v1/glutathione-reduced-l-glutathione.png`
- `public/products/kpv-10mg-brand-v37.svg` -> `/tmp/trybiomod-vial-artwork-audit-v1/kpv-10mg.png`
- `public/products/mots-c-10mg-brand-v37.svg` -> `/tmp/trybiomod-vial-artwork-audit-v1/mots-c-10mg.png`
- `public/products/nad-500mg-brand-v37.svg` -> `/tmp/trybiomod-vial-artwork-audit-v1/nad-500mg.png`
- `public/products/selank-brand-v37.svg` -> `/tmp/trybiomod-vial-artwork-audit-v1/selank.png`
- `public/products/semax-brand-v37.svg` -> `/tmp/trybiomod-vial-artwork-audit-v1/semax.png`
- `public/products/tesamorelin-10mg-brand-v37.svg` -> `/tmp/trybiomod-vial-artwork-audit-v1/tesamorelin-10mg.png`

## Original certificate check: percent versus notation

Both originals were freshly downloaded without alteration and their complete first pages were rendered and inspected. The Glutathione certificate is report V260812-35 004, lot 703-1500-0001, released August 27, 2026; its Chromatographic Purity row visually prints **96.01% + 0.18%**, method HPLC-UV/VIS. The MOTS-C certificate is report V260304-6 018, lot 409-10-0001, reported April 8, 2026; its purity row visually prints **97.07% + 0.18%**, same method.

**Preserve the reported 96.01% and 97.07% values separately from the following + 0.18% notation.** The visible glyph is a plus sign, not plus/minus. The inspected purity rows do not define that notation as a confidence interval or authorize treating it as extra purity. Do not sum it into the measured value, silently convert it to ±, or replace either result with >98%. Confirmation of the notation belongs with the issuing lab. This audit identifies a marketing-artwork inconsistency; it does not relabel the reports as passing or failing.

The report footnotes limit results to the tested sample portion and say the lab did not select the samples or confirm their authenticity/representativeness for the associated lot. Matching lot numbers and numerical consistency therefore are not independent authentication of the supplied product. No certificate artwork or lab text was modified.

Original sources: [Glutathione PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/GLUTATHIONE.pdf), [MOTS-C 10 mg PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/MOTS-C_10-mg.pdf). Unaltered downloaded copies, first-page renders and full extracted text are in the evidence directory.

## Evidence files

- `/tmp/trybiomod-vial-artwork-source-v1.json`: actual current catalog mappings and original extracted result rows.
- `/tmp/trybiomod-vial-artwork-audit-v1/contact-sheet-v1.png`: all 15 full vials.
- `/tmp/trybiomod-vial-artwork-audit-v1/label-contact-sheet-v1.png`: readable purity regions of all 15.
- `/tmp/trybiomod-vial-artwork-audit-v1/live-page-evidence-v1.json`: fresh visible batch records and image-path checks.
- `/tmp/trybiomod-vial-artwork-audit-v1/live-image-evidence-v1.json`: all 15 live/source hashes.
- `/tmp/trybiomod-vial-artwork-audit-v1/glutathione-coa-v1.pdf` and `mots-c-10mg-coa-v1.pdf`: unaltered original bytes; adjacent PNG/text derivatives for reading.

Scope limit: this completes this specific purity-label check across the 15 remaining eligible assets. It does not certify all packaging text, other assets, the parent’s two in-progress replacement images, or unreviewed products. Seven numerically consistent labels are not claimed to be scientifically or regulatorily approved.
