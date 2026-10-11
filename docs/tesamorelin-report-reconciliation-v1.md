# Tesamorelin matching-lot report reconciliation v1

Prepared October 10, 2026 (Pacific) / October 11, 2026 (UTC). Author: Codex. Scope: TryBiomod product 755, `tesamorelin-10mg`, listed lot `301-10-0001`. Draft implementation; production release is not claimed here.

## Evidence and reason for the association

The listed Tesamorelin 10 mg product previously pointed to ILS report `COA-2026-956704`, lot `001-B`, with 99.76% purity and 10.43 mg measured content. Those results did not match the listed lot. The original imported record and ILS document remain unchanged in `lib/coas-source-v1.json`; the ILS report remains a separate historical document.

The [AlphaGrade report library](https://alphagradepeptides.com/research-peptide-coa-library/) also links an [original-format Vanguard certificate](https://alphagradepeptides.com/wp-content/uploads/2026/09/biomod-tesamorelin-10mg-coa.pdf). An ordinary download returned HTTP 200 and `application/pdf`, 207,934 bytes. Both pages were text-extracted and visually reviewed by the implementing and coordinating agents. The document names BIOMOD PEPTIDES, Tesamorelin, 10 mg, lot `301-10-0001`, report `V260304-6 012`, reported April 2, 2026. These printed identifiers support the association with the listed product lot.

SHA-256 of the unchanged downloaded PDF:
`74b2229680929a30771287e4ae1caa838e6749e550a184d55fc68e97628d92fb`

This is a supplier-hosted laboratory document, not a direct laboratory authentication or verification of presently shipped stock. The report does not print the merchant SKU, CAS, manufacturing date or expiration date. Those fields are not inferred from it. The original PDF remains at its source URL; it is not rewritten or repackaged.

## Values preserved from the certificate

| Test | Reported result | Method | Reported LOQ |
| --- | --- | --- | --- |
| Chromatographic purity | 96.28% + 0.18% | HPLC-UV/VIS | Not listed |
| Assay | 9.92 mg | HPLC-UV/VIS | Not listed |
| Arsenic | 0.02 ppm | ICP-MS | 0.01 ppm |
| Cadmium | ND | ICP-MS | 0.01 ppm |
| Lead | 0.03 ppm | ICP-MS | 0.02 ppm |
| Mercury | ND | ICP-MS | 0.005 ppm |
| Endotoxins | Pass - <5.00 EU/mg* | LAL | Not listed |
| Sterility | Pass - No Growth Detected | USP <71> | Not listed |

The purity field prints a plus sign, not a plus/minus symbol. That notation is retained without interpretation. Page 2 run ID is `260402`; ND means Non-Detect. The report uses LOQ column headings but separately defines LOD as Limit of Quantification. The original notation remains visible in the source and is explained in the extracted notes.

The report-specific endotoxin footnote is retained and explicitly separated from any general human-use limit. The report limits findings to the tested portion of the submitted sample; the laboratory did not select the sample and does not establish its authenticity or representativeness of the associated lot. No clinical safety, approval, whole-lot sterility or universal pass threshold is inferred. The accreditation-scope reference is retained without claiming independently verified accreditation.

## Implementation and guardrails

- `lib/coas-reconciliations-v1.json` holds the versioned association, provenance, source hash, extracted results and scope notes.
- `lib/testing.ts` applies that association only while the source product ID, slug, listed lot and prior document match, and the catalog identity/size and new certificate recipient/identity/amount/lot agree. Future changes fail closed to the underlying source record. All unrelated records remain unchanged.
- `BatchDetails` visibly identifies the supplier-hosted source, submitted-sample limitation, reconciliation date and need to confirm the lot supplied with an order. The extracted-results viewer includes every listed result, metal LOQ and source limitation.
- Product, testing, batch, search and structured-data consumers use the same current record. The old report ID does not masquerade as the new current report. The testing header distinguishes the historical import from later per-record updates.
- No price, inventory, product identity, specification, artwork, publication eligibility, authentication or payment behavior is changed. A matching-lot status describes document association, not product approval.

## Validation

The focused test exercises the real overlay, existing source preservation, future identity/size/lot changes, actual product/testing/batch component rendering, report search, schema fields and the certificate-open handler with isolated fixtures and blocked network. Existing batch-search, testing-discovery, search-readable-facts, product-research-details, product-schema-identifiers and llms-indexnow suites are the relevant regression checks. Record execution results in the release work log; this document does not claim deployment.
