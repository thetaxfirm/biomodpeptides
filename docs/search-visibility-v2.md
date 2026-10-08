# Store search and checkout repairs, 8 October 2026

## Verified search status

Google Search Console verified the production URL-prefix property under the owner-approved account. The homepage's prior Google crawl was excluded by noindex; a fresh Google live test now says the page can be indexed. The homepage indexing request was accepted. Google subsequently read the first sitemap successfully and discovered all 34 submitted URLs. Search performance reports are still processing. Google Manual actions and Security issues both reported No issues detected. There is no verified first-page ranking or conversion-rate result yet.

## Repaired customer paths

Live verification showed canonical /shop already displaying 31 products: its parent route supplies research-compounds correctly. The Shop component itself retained an obsolete research-peptides fallback, so an unrecognized category link could display no products. That fallback now uses the current research-compounds category. Separate softgel and spray filters are preserved. An initial component-only audit overstated this as a canonical-page failure; the complete route check corrected that finding.

Build a Pack now uses the same normalized search as the store. Product-name punctuation, word order and exact strengths work consistently without fuzzy numeric matches.

New-customer checkout lost its destination when the buyer switched to registration or password recovery. Validated return paths now survive those links and same-browser email verification through a one-hour HttpOnly cookie. The existing authentication provider landing URLs and verification requirements remain intact. The initial account-state request shows a loading state instead of falsely claiming that accounts are coming soon. Cart payment copy reflects live, sandbox or unavailable mode. Shipping copy no longer claims setup is pending and correctly states the free-shipping threshold after discounts and before tax.

Returning members previously lost a newly selected browser cart when the saved account cart loaded. The new import flow preserves both choices and asks which cart to use when they differ. Identical carts are not doubled. Imports revalidate packs and inventory; stale choices cannot overwrite a cart changed in another tab. Logout rotates the browser session. Cart ownership records protect new sessions across expired authentication and direct account changes. Existing legacy sessions with fully expired authentication and no ownership record cannot be retrospectively attributed; no blanket deletion of those guest carts was performed. Payment and inventory reservation safeguards remain intact.

The inventory regression test also required a fixture repair: it selected the first product override instead of the exact BPC fixture. Scoping the query and fixture update to that product makes the existing settlement assertions pass without modifying production inventory logic.

## Product specification reconciliation

A deeper source audit found conflicting or invalid legacy identifiers. These are not evidence that a batch contains a different compound. They are evidence that the storefront cannot responsibly assert the existing identifiers as verified.

The raw source catalog is retained unchanged. Unverified CAS values are withheld from current presentation and search, with explicit product-specific notes. TB500's unsupported full-length claim is replaced by its declared TB-500 name and a sequence-confirmation notice. Product names, strengths, SKUs, prices and inventory are otherwise preserved.

The following 10 product pages are temporarily outside organic publication until the manufacturer or laboratory specification is reconciled. The current sitemap contains 16 product pages plus 8 general pages. This is an outstanding part of the full product-ranking objective, not a smaller replacement objective.

| Product | Evidence and required confirmation |
| --- | --- |
| SLU-PP-332 | Legacy CAS fails checksum and differs from Cayman's SLU-PP-332 registry entry. Confirm material specification. |
| 5-Amino-1MQ | Legacy CAS fails checksum; confirm salt and counterion. |
| Lipo-C w/B12 | Two legacy component identifiers fail checksum; confirm composition and physical format for the stated 10 mL vial. |
| GHK-Cu | Legacy CAS identifies copper-free GHK; confirm copper complex and form. |
| TB500 | Legacy full-length identity conflicts with fragment CAS; confirm peptide sequence. |
| GLOW, KLOW | Reconcile GHK-Cu identifier and TB-500 sequence for each blend. |
| Wolverine | Confirm the TB-500 component's sequence. |
| CJC-1295 No DAC | Reconcile legacy registry entry with the declared No DAC material; do not guess a replacement CAS. |
| Run & Gun | Reconcile the CJC No DAC component and obtain a certificate matching the listed lot. |

Primary references used to identify conflicts, not to certify Biomod lots:

- [Cayman SLU-PP-332](https://www.caymanchem.com/product/41719/slu-pp-332)
- [Cayman GHK specification](https://cdn.caymanchem.com/cdn/insert/27168.pdf)
- [Sigma Copper Tripeptide-1 entry](https://www.sigmaaldrich.com/US/en/product/astatechinc/ateh9806626f)
- [FDA material discussing Thymosin Beta-4 fragment](https://www.fda.gov/media/193349/download)
- [NLM deposited CJC registry record](https://pubchem.ncbi.nlm.nih.gov/substance/249820120)
- [Cayman No DAC specification](https://cdn.caymanchem.com/cdn/insert/32704.pdf)

## Remaining evidence needed

- Manufacturer/lab specification for the flagged products, including exact sequence or salt/form where applicable. Name-only COAs do not establish full-length versus fragment identity.
- Identify real customer purchases versus tests before computing sales conversion. Do not divide hosting request counts by orders and call it a customer conversion rate.
- No conversion-funnel instrumentation is installed. Search Console measures Google discovery, not checkout abandonment. Any future analytics rollout must align with the actual privacy policy and avoid sending product-order details or customer data to new third parties without authorization.
- Public terms and privacy pages still identify themselves as drafts. Approved final policy text is needed; do not silently reclassify draft legal copy as approved. The old terms link now points back through the domain redirect.
- Provider reconciliation and an owner-performed live purchase are required before claiming an end-to-end payment test. Do not release unresolved payment/inventory locks to make conversion statistics look better.

## Backlink work

The Biomod Pro quality-page and footer links to the batch-record library are live. They are relevant sister-site links, not independent endorsements. The identified external directory mention needs publisher authorization before editing or outreach. No ranking links, fake reviews or mass directory submissions were purchased or created.

## Verification scope

- Actual cart, checkout and account components were exercised in an isolated local browser fixture: current-cart, saved-cart and empty-cart selections sent the expected scoped choice and refreshed the view. A rejected stock selection kept both carts visible; retry after a failed state load restored password recovery with the checkout destination intact.
- Desktop choice buttons shared the same vertical position. At a 390 px phone viewport, both columns fit within 18 px page gutters and the actions remained readable.
- The fixture uses test-only state and API responses. This establishes UI behavior; it is not an authenticated production purchase or a payment result.

## Production release verification

Published Cloudflare Worker version `a14148ab-8e0f-407e-a6c6-b3ca2b71dac6`. Production build, TypeScript, SEO/search/specification/auth/cart/payment and inventory regression checks passed. All 24 live sitemap URLs passed canonical/indexing checks; all 16 Product offers matched live catalog prices. The 10 specification-held pages remain noindex and emit no Product promotion. Tracking-only product URLs retain canonical Product data; search, account and checkout remain excluded. Exact names, strengths, SKUs, prices, pack prices, inventory and purchase availability match the pre-release snapshot for all 50 products.

Live browser pack search for `BPC157 10mg` returns BPC-157 and the correctly named Wolverine 10 mg blend. Live login-to-registration-to-login links retain `/checkout`. Google's earlier successful sitemap read still shows 34 discovered URLs; the currently published 24-URL set awaits its next read.
