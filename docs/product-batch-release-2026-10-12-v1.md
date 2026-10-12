# Current selling lot, COA availability and owner release v1

October 12, 2026. TryBiomod only. Owner request: product administration must control availability and show the current selling lot and its exact attached original COA.

## Behavior

- Product editor separates sale availability, selling lot, attached original and COA availability. Changing a lot clears the draft attachment; available COAs require an eligible original for the exact product and lot. Existing reviewed matching source associations can be disabled and re-enabled. Missing originals remain unavailable.
- Owners can deliberately release a product review hold for an identified replacement lot, with verified positive stock and a review reason. The prior flagged Wolverine 20 mg lot cannot be released through this control. Availability changes do not clear scientific identity/specification or search-publication review blocks. No held product is automatically published by this release.
- Private original PDFs remain private. Authorized product administrators can read the intact original through a protected endpoint with registry/hash verification; customer delivery remains subject to the original's existing sharing policy. No PDF is rewritten, renamed to conceal identity or copied into the public source repository.
- Current batch resolution feeds product pages, batch search/URLs, comparisons, educational links, structured data, llms text and original COA request eligibility. A disabled selection removes the current website link/results and stops automatic email eligibility; it does not recall a previously downloaded or publicly hosted report.
- A queued original cannot silently change when a product lot or attachment changes. It moves to review if its current association is no longer eligible. Accepted historical messages remain intact.
- Product saves reject stale versions and stale batch selections. Lot changes are rejected while inventory is reserved or paid/labeling orders await fulfillment. The reservation transaction also rejects a lot change between quoting and order creation.
- New order snapshots carry the offered lot/report and are fingerprinted through checkout. Admin, account and order summaries use the saved purchase snapshot; historical orders are not backfilled or rewritten.
- Maximum-per-order validation now supports the 200-unit limit shown in the owner’s editor screenshot. Editor/API/cart accept configured limits up to the existing inventory ceiling of 100,000; actual product stock/order limits still apply.
- Changes history records sanitized lot/report/availability and release-lot changes, with actor evidence; freeform review text is not copied to the audit history.

## Scope and evidence

Baseline: shared main and working HEAD `7b174968beb0f46594d8b120f30c725313d4c33b`; clean checkout and no divergence. Runtime snapshot captured 2026-10-12 22:41 UTC contains 49 overrides and 52 catalog products. No production product, price, lot, order, original registry or email settings are changed by deployment.

Migration `0023_product_batch_history.sql` replaces product-history triggers only; no backfill, product update or original-report change. Exact source, checks, live deployment, selected URLs, before/after nonsecret runtime fingerprints and remaining gaps are recorded in the external dated release receipt after verification.

## Verification boundaries

All mutations used by regression and browser tests run against isolated fixtures with external providers blocked. Live verification is read-only. No payment, postage purchase, email delivery, physical shipment or replacement-lot quality approval is claimed. Existing public links rely on their original external host; this change does not turn them into private email attachments or independently authenticate the laboratory's findings.
