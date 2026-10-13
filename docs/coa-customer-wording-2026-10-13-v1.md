# Customer-facing COA wording v1

October 13, 2026. Owner instruction: remove unflattering wording from the batch library and say "update" for anything missing or pending; the page should not read as if most products lack COAs. Contributor: Claude. TryBiomod only.

## Change

- Status labels (`statusLabels` in `lib/testing.ts`, also used for `coa_status` in the public catalog): "Lab report available", "Printed COA included with order", "COA available on request", "Update in progress". Replaces "Matching-lot certificate", "Original COA available on request" and "Documentation pending".
- Batch documents: the count tiles are "Products with lab reports" (lab report online or printed COA in the box), "Lab reports online" and "Printed COAs in the box"; selecting a tile again clears it. Products with a report list first. The "Documentation pending" tile and filter, the September 11 import line and the "Pending documentation is not a completed test" footnote are removed.
- Batch record panel (batch page and product pages): Lot, Report lot, Report date, Purity, Measured content and Report reference when a report exists; otherwise the lot and "The lab report for this lot is being updated. Ask us anytime for the latest documentation." The "Not listed / Not reported / Not verified for this lot" placeholders and "Confirm the lot supplied with your order" are gone; the product page note reads "Match this lot to the label on your vial."
- Same wording in the quality guide, the shop and research FAQs, the per-product documentation answer and the press release. Per-record source notes for the five label-lot reconciliations now name the laboratory and lot only.

Counts at release: 24 products with lab reports (19 online, 5 printed in the box) of 52 records. No report, lot or availability data changed.

## Tests

Wording assertions in the gated suites and in `batch-search`, `testing-discovery`, `tesamorelin-report-reconciliation` and `product-research-details` follow the new text; negative checks assert the removed lines stay absent. `tests/product-research-details-v1.cjs` already failed on main 4176d62 at its heading-count and shop-heading checks (lines 64 and 347), unrelated to this change; its COA assertions pass with those two lines bypassed locally.

## Release

Commit fb54b09, built on main 4176d62 (`check:release`: 69 suites; production build passed). Cloudflare version e841fa96-1672-4de0-84ef-9dee6df0254e deployed 2026-10-13 from that build. Live, read-only: `/testing` shows 24 / 19 / 5 tiles, 52 records with all 24 reported products before the 28 "Update in progress" records; the "Printed COAs in the box" tile filters to 5 and toggles back to 52; a pending record panel reads "The lab report for this lot is being updated. Ask us anytime for the latest documentation."; phone width (375 px) lays out cleanly. `/product/kpv-10mg`, `/product/tesamorelin-10mg`, `/quality-standard` and `/faq` contain none of the removed phrases.
