# Search visibility and sales diagnostics v3

October 8, 2026. This release extends the verified v2 fixes without changing prices, stock, product identity, payment processing, branding or public page structure outside the existing COA guide.

## COA guide

The existing `/quality-standard` page now explains how to match a certificate to a product lot, distinguish purity from assay, retain units and qualifiers, and understand published document status. The example links to the actual BPC-157 record for lot `201-10-0001`, Vanguard Laboratory report `V260304-6 010`. The original PDF was retrieved again and its displayed fields and sample limitations checked. No certificate was edited and no whole-batch, clinical or regulatory approval claim was added.

The guide references FDA Q7A section 11.4 only for certificate contents, explicitly in its API-manufacturing context. It does not claim Biomod certification. Search title and description now describe the guide clearly; the footer link is “How to read a COA.” Publication eligibility and the ten specification holds remain unchanged.

## Sales diagnostics

A protected Admin → Diagnostics tab reports aggregates over existing records. It uses the existing `requireAdmin` authorization and `Cache-Control: no-store`; it adds no schema, tracking, visitor identifier or third-party analytics service.

- Fixed windows cover the last 7 or 30 complete UTC days, excluding today.
- Orders are grouped by creation date, environment and current status. Live, sandbox and unknown environments remain separate. Known cancelled/failed states are retained; arbitrary states become unknown.
- “Payment recorded” requires a paid/fulfillment status plus both payment and verification references. Gross includes tax and delivery and does not subtract refunds. It is not daily completed sales or net revenue.
- Quote and support activity counts records, not people. Repeated delivery quotes are not unique checkout visits. Failed quotes are not recorded.
- Outstanding payment records and unresolved cart choices cover all dates and are not labeled abandonments or active shoppers.
- Customer-versus-internal-test classification remains unknown. Session records are not used as a traffic denominator.

The reporting endpoint returns only aggregate fields. It does not return names, addresses, email addresses, order IDs, payment references, session IDs, raw request JSON or IP addresses.

## External links

`backlink-audit-v1.md` documents three verified opportunities and a conditional directory correction. `backlink-corrections-v1.md` contains exact unsent requests for the Las Vegas Peptide Therapy, AlphaGrade and Estly editors. Publisher contact channels and owner send authorization are required before outreach. Existing sponsored/nofollow treatments and historical COA PDFs must be preserved.

## Validation

The SQL and real route/auth tests cover UTC date boundaries, malformed legacy JSON, payment evidence, cancelled/failed states, environment separation, unauthorized access, no-store responses, aggregate privacy, failures and empty records. TypeScript, focused lint and relevant SEO regressions passed.

Browser checks exercised the actual diagnostics component in an explicitly labeled isolated test fixture: 7/30-day selection, disclosure, failed-load retry and empty results. All tables fit the 350 px content width at a 390 px viewport. This was not a production sales report. The COA guide's batch link opened the correct record, its contact link prefilled the intended subject, keyboard focus remained visible, and phone layout had no horizontal overflow.

## Remaining evidence

Real-customer versus internal-test order classification, a completed owner-performed payment check, approved final policy text, and manufacturer/lab specifications for held products remain outstanding. Search Console is verified under the approved Ash account, but search data/indexing must be allowed to accumulate. This release does not establish product rankings or explain absent sales from hosting hits alone.

## Production verification

Published Cloudflare Worker version `2879ecab-fc71-4aa5-b21a-2d0a8061aae0`. The guide renders on the live domain with the correct laboratory and report reference. The anonymous diagnostics request is denied and marked no-store, with no aggregate fields returned. All 24 sitemap URLs, 16 product offers and ten specification holds passed the live audit; all 50 products retain the prior names, strengths, SKUs, prices, pack prices, stock and purchase availability. No authenticated production report or live paid purchase was performed in this release.
