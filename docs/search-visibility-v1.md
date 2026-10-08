# Search visibility release, 8 October 2026

## Verified problem

The production homepage instructed search engines to use `noindex, nofollow`. The sitemap was empty. Production-origin validation accepted the old domain but not TryBiomod, and the production SEO publication settings were absent. Google Search Console independently confirmed that its 6 October homepage crawl was excluded by a noindex meta tag.

This blocks organic discovery; it does not establish the complete cause of low sales. Payment configuration reports live, but a real end-to-end payment was not placed. Account registration and email verification precede checkout and may cause friction. Visitor counts, acquisition quality and completed-sale conversion rates remain unmeasured. Hosting requests are not unique human shoppers.

## Published changes

- Explicit production-only publication settings for TryBiomod, retained in deployment configuration.
- 34 canonical sitemap pages, including 26 vial product pages whose public compound identities are disclosed. Product identity/classification/specification holds remain in place for other pages. HEAT pages are not included in organic promotion under concealed identities.
- Product titles contain the actual name and container strength. Structured Product/Offer data uses current server-side catalog prices and stock, without invented ratings or health claims. Offers are omitted when current catalog retrieval cannot be verified.
- Server-rendered catalog prices now use the same catalog source as the store, removing static-price discrepancies before hydration.
- Search accepts punctuation variations, reordered terms, strengths, CAS and SKU; ranks exact names first. Numeric strengths are not fuzzy-matched. A visible clear-search action recovers empty results.
- Exact legacy category/article paths permanently redirect to relevant current pages. Unknown pages retain genuine 404 responses.
- Search/filter URLs stay noindex with crawlable links; private/account/checkout URLs remain noindex/nofollow. Tracking-only query parameters canonicalize to the public page.
- Google URL-prefix ownership verified for https://trybiomod.com/ using the owner-approved Ash account. The verification file must remain published.

## Backlinks

Published on Biomod Pro: direct footer link to the BIOMOD batch-record library, plus an updated quality-page COA link. These are useful links between related sites, not independent third-party endorsements. Both links verified live after Vercel deployment.

Existing independent mention to review: https://lasvegaspeptidetherapy.com/biomod-peptides-las-vegas/. Request that the publisher update old-domain references to the matching current pages only if ownership/contact authorization is established. No outreach was sent, no paid placements purchased, and no directory or review profiles fabricated.

Next earned-link work: confirm the real retail location and its eligible business profile; update profiles the business actually controls; seek links from real labs, suppliers and industry partners only where the relationship and destination are accurate. Keep the old domain redirects active. Do not mass-create keyword doorway pages, alter certificates, hide chemical identities, buy ranking links or invent reviews.

## Validation

- Production build and TypeScript passed.
- Search and SEO policy tests passed, including strength isolation and publication exclusions.
- All 34 live sitemap pages returned the expected indexing metadata and canonical URL; all 26 product offers matched the public catalog price (catalog cents converted to USD).
- All 50 public product records compared equal before and after deployment; no price or inventory changes.
- Live browser search for BPC157 10mg returned BPC-157 first and the correctly named Wolverine blend second; purchase controls became enabled after cart/session initialization.
- Known legacy category and location article routes returned permanent 308 redirects. Private and search-response headers retain their intended indexing protections.

## Measurement and next decisions

Search Console's new performance/indexing reports are processing. The sitemap was submitted; initial Google fetch status needs verification before calling sitemap ingestion successful. Google live URL inspection independently confirmed the repaired homepage is available to Google and can be indexed. The homepage indexing request was accepted into the priority crawl queue. Sitemap submission and live technical eligibility are not proof that Google has indexed or ranked a page.

Use docs/product-search-targets-v1.csv as a page/query measurement sheet, not a claim of keyword volume or ranking. Measure organic impressions, clicks, query/page position, product-view-to-cart, cart-to-checkout, payment failure, and completed paid orders with tests excluded. Resolve real-order versus test-order classification before reporting conversion. Page one is an objective, never a promised result.

## Primary references

- https://developers.google.com/search/docs/specialty/ecommerce
- https://developers.google.com/search/docs/appearance/structured-data/product-snippet
- https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
- https://developers.google.com/search/docs/essentials/spam-policies
