# TryBiomod eligible product audit v1

Date: October 10, 2026. Author: Codex product-audit agent. Scope: all 17 product URLs in the current live sitemap; read-only audit. Source baseline and fetched shared main: `3741498c81ddcb0fa168c2204f8f4b33d0dd66a8` (KIMC15 release). No production settings, inventory, artwork, certificates or publication holds were changed. Root agent is implementing measurement separately.

## Method and boundaries

The public sitemap contained 28 URLs including 17 products. Each product URL received one ordinary HTTP GET between 2026-10-10T20:32:50.918451+00:00 and 2026-10-10T20:32:56.807586+00:00. The response HTML, visible text, headings, links, canonical, robots and JSON-LD were parsed locally. The 14 distinct original PDF links each received one GET; all returned HTTP 200, `application/pdf`, PDF file signatures and no redirects. Home, shop and robots each received one read. One targeted live search reproduced the matcher defect below. These checks are not traffic, ranking or conversion evidence. No crawler impersonation, card action or customer data access occurred.

The PDF check confirms delivery of actual PDF bytes, not independent authenticity, laboratory validity, or agreement of every report value with the storefront. Documentation statuses below are the storefront disclosures observed live. The audit does not replace scientific specification review or current lot confirmation. Google indexed coverage and query demand were not remeasured in this audit. No external search result position is inferred from sitemap membership.

## Verified technical results

- All 17 product URLs: HTTP 200 with no redirects; one self-referencing canonical; `index, follow`; distinct product title and description; parseable Product JSON-LD and USD Offer. The schema price agrees with the displayed single-vial price on every page.
- All 17 Offers retain the newly deployed shipping and returns policy references. No invented reviews or rating counts were found in the product graphs.
- Sixteen products display in-stock offers. MOTS-c 10 mg is unavailable and its Offer says OutOfStock. Its 40 mg size is separately linked and available; no stock was changed.
- The live shop contains ordinary HTML links to all 17 eligible products. The initial homepage contains 16 eligible product links; Thymosin Alpha-1 is outside its first 16-item slice. This follows the owner-approved load-16 behavior and is not an orphan-page defect: the shop and related-product links expose it.
- Robots permits public crawling and disallows private checkout/account/admin paths. The sitemap location is correct.
- Ten products disclose matching-lot certificates; four disclose a different certificate lot; three disclose pending documentation. Fourteen PDF links are working. None were routed to the storefront homepage by the old-domain redirect.

## Complete product and document register

The title column is the exact current title before the common ` | Biomod Peptides` suffix. All rows have a Vial format. Prices are retail single-vial prices in USD, not wholesale prices or net receipts.

| Product title | Retail | Stock | Displayed SKU | Documentation disclosure | Listed lot / certificate lot | Original PDF |
| --- | ---: | --- | --- | --- | --- | --- |
| [AOD 9604 10mg Research Vial](https://trybiomod.com/product/aod-9604-10mg) | $49.00 | In stock | BM-LYO-015 | Matching-lot certificate | 406-10-0001 / 406-10-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/AOD-9604_10-mg.pdf) |
| [BPC-157 10mg Research Vial](https://trybiomod.com/product/bpc-157-10mg) | $35.00 | In stock | BM-LYO-010 | Matching-lot certificate | 201-10-0001 / 201-10-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/BPC-157_10-mg.pdf) |
| [DSIP 10mg Research Vial](https://trybiomod.com/product/dsip-10mg) | $40.00 | In stock | BM-LYO-019 | Matching-lot certificate | 410-10-0001 / 410-10-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/DSIP_10-mg.pdf) |
| [Epitalon 50mg Research Vial](https://trybiomod.com/product/epitalon-50mg) | $69.00 | In stock | BM-LYO-016 | Matching-lot certificate | 407-50-0001 / 407-50-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/Epithalon_50mg_55c88823.pdf) |
| [Glutathione 1500mg Research Vial](https://trybiomod.com/product/glutathione-reduced-l-glutathione) | $59.00 | In stock | BM-EXT-004 | Matching-lot certificate | 703-1500-0001 / 703-1500-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/GLUTATHIONE.pdf) |
| [Kisspeptin 10mg Research Vial](https://trybiomod.com/product/kisspeptin-10mg) | $50.00 | In stock | BM-LYO-008 | Matching-lot certificate | 404-10-0001 / 404-10-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/Kisspeptin_10-mg.pdf) |
| [KPV 10mg Research Vial](https://trybiomod.com/product/kpv-10mg) | $49.00 | In stock | BM-LYO-006 | Documentation pending | 402-10-0001 / Not listed | Not published |
| [MOTS-c 10mg Research Vial](https://trybiomod.com/product/mots-c-10mg) | $35.00 | Out of stock | BM-LYO-018 | Matching-lot certificate | 409-10-0001 / 409-10-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/MOTS-C_10-mg.pdf) |
| [MOTS-C 40mg Research Vial](https://trybiomod.com/product/mots-c-40mg) | $100.00 | In stock | BM-LYO-018-40 | Documentation pending | 701-40-0001 / Not listed | Not published |
| [NAD+ 500mg Research Vial](https://trybiomod.com/product/nad-500mg) | $59.00 | In stock | BM-LYO-009 | Lot needs confirmation | 405-500-0001 / 001-B | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/NAD-500mg.pdf) |
| [PT-141 10mg Research Vial](https://trybiomod.com/product/pt-141-10mg) | $39.00 | In stock | BM-LYO-007 | Matching-lot certificate | 403-10-0001 / 403-10-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/PT-141_10-mg.pdf) |
| [SELANK 10mg Research Vial](https://trybiomod.com/product/selank) | $40.00 | In stock | BM-LYO-028 | Lot needs confirmation | LYO-028-2608-02 / 001-b | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/Selank-10mg.pdf) |
| [SEMAX 10mg Research Vial](https://trybiomod.com/product/semax) | $40.00 | In stock | BM-LYO-029 | Lot needs confirmation | LYO-029-2608-01 / 001-R | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/Semax-10mg.pdf) |
| [SS-31 10mg Research Vial](https://trybiomod.com/product/ss-31-10mg) | $40.00 | In stock | BM-LYO-017 | Matching-lot certificate | 408-10-0001 / 408-10-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/SS-31_10-mg.pdf) |
| [SS-31 50mg Research Vial](https://trybiomod.com/product/ss-31-50mg) | $110.00 | In stock | Not provided | Documentation pending | Not listed / Not listed | Not published |
| [Tesamorelin 10mg Research Vial](https://trybiomod.com/product/tesamorelin-10mg) | $70.00 | In stock | BM-LYO-012 | Lot needs confirmation | 301-10-0001 / 001-B | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/TESAMORELIN-10mg.pdf) |
| [Thymosin Alpha-1 10mg Research Vial](https://trybiomod.com/product/thymosin-alpha-1-10mg) | $60.00 | In stock | BM-LYO-005 | Matching-lot certificate | 401-10-0001 / 401-10-0001 | [200 PDF](https://biomodpeptides.com/wp-content/uploads/2026/05/Thymosin-Alpha-1_10-mg.pdf) |

## Actionable findings, ordered by user impact

### 1. A common product query gives an empty storefront result

The actual `lib/product-search.ts` matcher was exercised without modifying source. `BPC157 10mg` finds the BPC-157 listing, but `BPC157 peptide`, `SS31 50mg peptide` and `MOTS C 40mg peptide` return no products. The category was renamed Research Compounds, and the matching word list does not recognize peptide as a contextual category term for most peptide listings. Generic `peptides` returns only DSIP because its expanded identity contains the word Peptide.

Live reproduction: [BPC157 peptide](https://trybiomod.com/shop?q=BPC157%20peptide) returned HTTP 200 with “No products match these filters.” on October 10, 2026. This is a verified on-site search defect, not evidence about Google ranking. All 17 exact product-name/strength/research-vial queries passed in the current source matcher.

Recommended implementation: normalize documented shopping vocabulary and approved aliases while preserving molecular identity, product form and exact numeric strengths. Do not label NAD+ as a peptide, or bypass any publication hold. Verify name-plus-peptide queries, generic peptide browsing, non-peptide identity searches, incorrect strengths and blend/individual distinctions. `epithalon` also returns no matches even though the published original certificate filename uses Epithalon; confirm this alias from the original record before adding it.

### 2. Two inspected artwork claims disagree with the evidence disclosed beside them

The live Product graphs reference `/products/epitalon-50mg-brand-v37.svg` and `/products/mots-c-40mg-brand-v37.svg`. Their source assets embed raster vial art; extraction and visual inspection show `>98% HPLC` on each label. The remaining SVG overlays occupy only the logo area (y=510–598), so they do not cover the purity text near the bottom of the label.

- [Epitalon 50 mg](https://trybiomod.com/product/epitalon-50mg) discloses a matching-lot purity result of **97.05% + 0.18%**. The inspected artwork says **>98% HPLC**. Those are contradictory claims on the same product.
- [MOTS-c 40 mg](https://trybiomod.com/product/mots-c-40mg) says **Documentation pending** and **Purity: Not verified for this lot**, while its inspected artwork says **>98% HPLC**. The current published record does not support that artwork claim.

Both exact live SVG URLs returned HTTP 200 and byte-matched the visually inspected source files. SHA-256: Epitalon `540a64d51c523870f47f73b77c2e31e71a5973fd61b7557f09e2cb0db793759e`; MOTS-c 40 mg `1ef227ef4a338078c764e699f5baefe9a7c4b1c7a6c4f18f70d966b54b76cf15`. This was a targeted inspection of two images, not an assertion that all 17 label images were visually audited.

Recommended correction: replace unsupported promotional artwork claims using evidence-faithful artwork, while preserving the original unmodified COAs and explicit lot-status disclosure. Do not cosmetically modify certificates, replace a measured value with a marketing threshold, or relabel pending documentation as passing. Check the remaining eligible vial images for the same repeated template claim before declaring the entire image set corrected.

### 3. Seven eligible products need original matching documentation, not rewritten copy

KPV 10 mg (lot 402-10-0001), MOTS-c 40 mg (701-40-0001) and SS-31 50 mg (no listed lot) have no published original certificate. NAD+ 500 mg, Selank, Semax and Tesamorelin expose different listed and certificate lots in the table above. The current pages correctly disclose this. A buyer cannot establish which original report supports the supplied lot from those public records alone.

Required evidence to close: current supplied lot, unmodified lab-issued report for that exact lot, and reconciliation with the published SKU/quantity specification. Preserve the present truthful warnings until that evidence is received. This is a likely buyer-confidence barrier, not measured proof of a lost sale. Do not alter stock or publication status solely from this audit.

### 4. SS-31 50 mg has a visible identifier gap

The page says `SKU: Not provided`; its Product schema sets `sku: "5027"`, the internal product ID fallback in `lib/seo.ts`. This is not a verified owner-assigned SKU. Confirm an authoritative SKU and lot rather than inventing one. Alternatively, omit the optional SKU property while no SKU exists, leaving the stable Product ID intact. Do not create a new inventory item or rewrite a product ID to address this display gap.

### 5. The product-specific content is mostly a shared ordering template

All 17 pages expose the same two question headings: what is included in a vial/pack and what documentation is available. These answers are useful and factual, but the description is generally an identity-plus-quantity sentence with generic research-use prose. This does not provide the richer product-specific clarification previously requested for MOTS-c and SS-31.

Recommended content work after documentation reconciliation: source-backed identity/alias clarification; explicit distinctions between listed vial contents and lab measured content; available sizes with separate lot evidence; and references to the exact original report. Add handling/storage/SDS information only from authoritative product records. Avoid human-use instructions, unsupported efficacy/absorption claims and repetitive keyword expansion. Product search query/page performance is not yet available here, so this is a content-quality opportunity rather than a proven ranking cause.

## Frozen eligible-product query cohort for subsequent measurement

These are exact-name/strength/research-vial strings derived from the current live Product names. They freeze a consistent cohort for future Search Console/query checks; they do not claim that users have searched them or that they currently rank. Track branded modifiers separately.

- AOD 9604 10mg Research Vial
- BPC-157 10mg Research Vial
- DSIP 10mg Research Vial
- Epitalon 50mg Research Vial
- Glutathione 1500mg Research Vial
- Kisspeptin 10mg Research Vial
- KPV 10mg Research Vial
- MOTS-c 10mg Research Vial
- MOTS-C 40mg Research Vial
- NAD+ 500mg Research Vial
- PT-141 10mg Research Vial
- SELANK 10mg Research Vial
- SEMAX 10mg Research Vial
- SS-31 10mg Research Vial
- SS-31 50mg Research Vial
- Tesamorelin 10mg Research Vial
- Thymosin Alpha-1 10mg Research Vial

## Preservation and handoff

No edits to BiomodPro, held product identities, publication policy, stock, prices, storefront code, certificates or artwork. Existing untracked SS-31/Wolverine inventory drafts remain untouched. The only durable change from this audit is this versioned report. The parent agent owns any implementation, release validation and shared-main sync.

Temporary public-response evidence was saved under `/tmp/trybiomod-product-audit-2026-10-10-v1/` for the parent agent: `audit.json`, `links.json`, individual HTTP bodies/headers and the single live search response. Temporary paths are evidence working files, not durable customer-facing deliverables. No customer records or credentials are included.
