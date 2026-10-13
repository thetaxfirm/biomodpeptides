# Current-inventory COA matching v1

Owner instruction, October 12, 2026: use only COAs that match the inventory being sold. TryBiomod only. Baseline shared main: `0048c8b16af9ea7f76a456b2facbec0476a68dd4`. Main was fetched and aligned, and the checkout was clean before this work. Codex prepared this contribution; Git authors and provider accounts remain separately attributed.

The server no longer preserves a legacy mismatched report in public product data or selects it as a default attached report. Public report availability requires a reviewed exact product identity, strength, format and current inventory lot association with COA visibility enabled. Private originals retain their current exact associations and owner-reviewed delivery checks. No product lots, inventory, prices, report files, historical orders or customer requests are changed by this release.

Public rendering additionally checks nonempty exact equality among the current lot, recorded certificate lot and PDF batch number. A forged matched flag, disabled COA, blank lot or old document reference cannot render a report link, embedded PDF, results, date, report reference or source note. Product pages, batch library and lot routes, search identifiers, quality guide and structured data use this rule. Historical source reports remain preserved for protected staff review and cannot be selected as available for a different lot. The obsolete public mismatch filter is removed; missing exact documents have pending status and a COA inquiry path.

## Verified pre-release evidence

Anonymous live catalog: 52 products, 16 matching public COAs, three matching private originals, five exposed mismatched reports and 28 without an exact available report. The five old report links were KLOW 80mg, NAD+ 500mg, Run & Gun 10mg, Selank 10mg and Semax 10mg. Existing private registry metadata contains no exact replacement originals for those five. No original is invented or relabelled.

## Validation

TypeScript and all 61 isolated release suites passed, as did the production build. Six focused public rendering/search/reconciliation suites and the existing private reply/COA-delivery tests passed. The actual built Worker was tested with isolated D1, synthetic records and intercepted providers: five mismatched source reports and a forged available flag never reached public state; valid current-lot/private associations, protected original review, stale quotes and historical order immutability remain verified.

After publishing, verify all five affected public products plus a matching original; compare prices, quantities, identity, strength, availability and selling lots with the pre-release public snapshot. Record exact commit/build/deployment, current coverage, browser checks and any gaps in the versioned external release receipt. Run the append-only Changes-page importer. This source note alone does not establish deployment.
