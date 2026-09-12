# Search publication controls and unresolved review items

Prepared September 12, 2026. These are implementation controls and review notes, not a legal opinion or a guarantee of Google eligibility.

## Implemented

- Unique server-rendered page titles and factual descriptions; canonical URLs without search/filter parameters.
- Open Graph and Twitter metadata derived from the same product facts shown to visitors. Product social images use the original supplied product asset.
- `noindex, nofollow` in HTML metadata and `X-Robots-Tag` responses on the preview. Protection remains active on any hostname other than the exact configured production origin even if publication flags are enabled.
- Crawlable public HTML so crawlers can read noindex directives. Robots disallows private account, cart, checkout, payment, authentication and API paths. Robots alone is not treated as an access control.
- Sitemap contains only explicitly eligible pages and reviewed products after the public launch gate opens. It is empty while indexing is disabled. No fake automatic last-modified dates.
- Real 404 responses for unknown pages, products, account sections and batch records. Legacy About/COA/affiliate paths redirect to their corresponding pages.
- Organization, WebSite, WebPage and visible product breadcrumb structured data only on eligible public pages. No Product/Offer/Review/AggregateRating/MedicalBusiness/LocalBusiness/FAQ rich-result markup, Merchant feed or advertising submission.
- A read-only Search administration tab reports configuration, sitemap size and each product's publication hold. It uses the existing authenticated administrator allowlist.
- Raw imported promotional descriptions are retained only as source provenance; the storefront, public API and metadata now use `catalog-facts-v2.json`. NOCTIS and ZENITH container quantities display as pending confirmation.
- Three new studio illustrations use real BPC-157, AZURE and FORGE packaging references. They are labeled as AI illustrations and do not replace the original product images or laboratory reports.

## Launch configuration

Set server runtime configuration only after confirming the actual public-domain deployment and completing business/product review:

| Setting | Meaning |
| --- | --- |
| `SEO_PUBLIC_ORIGIN` | Exact HTTPS origin: `https://biomodpeptides.com` or `https://www.biomodpeptides.com`. No paths, credentials, query strings or alternate hosts. |
| `SEO_PUBLIC_LAUNCH_APPROVED` | Literal `true` records the decision to publish the reviewed website. |
| `SEO_INDEXING_ENABLED` | Literal `true` enables indexing only when the origin and launch approval also pass. |
| `SEO_REVIEWED_PRODUCT_SLUGS` | Comma-separated exact slugs reviewed for organic publication. No wildcard. An allowlist entry cannot override a source-conflict hold in code. |

The default is closed. Changing these settings does not change the Site audience, enable checkout, certify product legality, create a Merchant feed or submit the site to Google. The public domain currently has an existing website; domain cutover and redirects need an intentional migration plan before this rebuild replaces it. Do not bulk-redirect unrelated old product URLs to the homepage.

After the public domain is connected, verify the exact host's metadata, canonical URLs, sitemap and response headers, then verify ownership in Search Console and submit the sitemap. Keep preview and secondary hosts noindex or authenticated. Monitor Search Console indexing and manual actions through an authorized account. No monitoring automation has been installed.

## Product and marketing review

Review the actual product classification, label, intended use, sales practices and complete marketing presentation. Neutral SEO wording and a research-use disclaimer do not establish lawful intended use. Do not add human-benefit, dosing, reconstitution, treatment, weight-loss or clinical-result pages to attract search traffic.

- AZURE packaging explicitly says dietary supplement and cognitive support. That conflicts with the research-only site presentation and requires a product/label/marketing decision. The original claim was not digitally erased from the packaging to disguise the issue. Its product page cannot enter the SEO allowlist while this hold exists.
- HEAT-R and HEAT-T records do not state full compound identities. HEAT-R 20mg also has a conflicting 30mg summary. No identity was inferred from CAS numbers. These pages remain held.
- LUMEN has unresolved astaxanthin quantity descriptions. NOCTIS has 110/111mg and ZENITH 100/20mg source conflicts. Their publication holds remain.
- All other products still require individual review before allowlisting, including consumer-style formats, investigational compounds and semaglutide blends.
- Six certificate lots do not match the listed product lot; twenty-four products lack certificate PDFs. Results remain tied to the specific available report. Do not interpret certificates as universal safety, sterility, efficacy, regulatory approval or certification claims.
- Shipping, return, terms and privacy pages remain out of the sitemap until business/legal terms and actual service configuration are finalized.

## Locations source reconciliation

The public [Locations page](https://biomodpeptides.com/locations/) lists Las Vegas at 6625 S Valley View Blvd, Suite D420, Las Vegas NV 89118 and St. George area at 422 W Lamond Circle, Washington UT 84780. It labels them Live but also carries a coming-soon statement. [Terms of Sale](https://biomodpeptides.com/terms-of-sale/) lists suite D418. No verified visiting hours, public phone, retail entrance or pickup policy was located.

The new Locations page lists the streets/cities, asks visitors to contact the team, and omits the disputed suite. Dallas and Los Angeles remain clearly planned. There are no invented local-business entities, opening hours, map pins, medical clinics or city doorway pages. Location search eligibility stays held until the owner confirms current details.

## Policy sources reviewed

- [Google Search spam policies](https://developers.google.com/search/docs/essentials/spam-policies): no cloaking, scaled low-value content, keyword stuffing or doorway pages. Same content is served to people and crawlers.
- [Google generative AI content guidance](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content): AI can assist useful content; mass generation without added value may violate spam policy.
- [Google structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies): markup must represent actual visible content; technical validity does not guarantee a rich result.
- [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing): a crawler must be able to read a noindex directive; robots blocking alone is insufficient.
- [Merchant free-listing healthcare policy](https://support.google.com/merchants/answer/12079605?hl=en) and [Shopping ads healthcare policy](https://support.google.com/merchants/answer/6150151?hl=en): product/channel/country restrictions are separate from ordinary web search. No listing or advertising eligibility is assumed.
- [FDA concerns about unapproved GLP-1 products](https://www.fda.gov/drugs/drug-alerts-and-statements/fdas-concerns-unapproved-glp-1-drugs-used-weight-loss) and [Peptide Partners warning letter, August 24, 2026](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/peptide-partners-llc-735063-08242026): research labels do not override evidence of human-drug intended use. This is not a finding against Biomod.
- [FTC health-products guidance](https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance): objective health claims need appropriate substantiation; implied claims and the overall presentation matter.
