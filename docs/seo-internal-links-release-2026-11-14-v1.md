# Spray collection, sibling links and store data: release v1

November 14, 2026. Author: Claude. Owner request: improve TryBiomod search visibility. TryBiomod only.

## What the audit found

A crawl of all 82 sitemap pages found no technical faults: every page 200 and indexable, one h1, unique titles and descriptions within length, valid structured data, self-canonical.

Three gaps:

- Every spray page linked the same three sprays (APEX, EQUIL, FLUX) and every softgel page the same three softgels, one of them a held product (AZURE). GLOW, IGNITE, KLOW and SOLARA sprays and Acetic Acid each had one inbound internal link; ERASER, NEXUS and SCULPTOR had two.
- There was no landing page for sprays. Softgels have /softgels.
- /locations lists three open stores with street addresses but published no store structured data.

## What changed

- `lib/collections.ts`: new collection `/collections/research-sprays` (eight published sprays; NOCTIS and ZENITH stay held). Marked `byFormat`, so it carries no compound reference table. Spray product pages link it from the "buy" question.
- `components/store/catalog.tsx`: all categories use `relatedResearchProducts`, the rotation vials already used. Each published spray and softgel is now linked from at least two sibling pages and no page links a held product.
- `lib/store-locations.ts`, `lib/seo.ts`: /locations publishes three `Store` nodes with name and postal address only. No hours, phone, ratings or planned cities.
- No price, stock, claim, product name or held product changed. No "peptide" wording added.

## Checks

- `npm run check:release`: TypeScript and 130 suites passed (new: store-locations-schema-v1; extended: collections-v1, product-discovery-v1).
- `BIOMOD_DEPLOY=true npm run build`: passed.

## Live verification

- Commit 5d7e4d0 pushed to main; Workers Builds served it on trybiomod.com.
- Sitemap: 83 URLs. /collections/research-sprays is 200, `index, follow`, and links eight products.
- /product/glow-spray links IGNITE, KLOW, SOLARA and the spray collection; /product/softgel-eraser-tesofensine links BIONIC, NEXUS and SCULPTOR (no held product).
- /locations structured data lists BIOMOD Las Vegas (89118), St. George (84780) and El Paso (79938).
- IndexNow resubmitted after the release.

## Not measured yet

No ranking or traffic change is claimed. Expected signals: the spray pages and the spray collection appear in Bing and Google indexes; Search Console shows the Store items on /locations.

## Open, owner decisions

- The site never uses the word "peptide" (owner decision, Oct 23). Searches containing that word ("buy peptides", "research peptides", "BPC-157 peptide") cannot match these pages well. This is the largest on-page limit on non-brand traffic.
- Claude's web search still returns no trybiomod.com page, including for the brand name. Independent links and listings are the missing signal. Google Business Profiles for the three stores need the owner's sign-in.

## Later the same day: Bing verified, sitemaps resubmitted, indexing requested

- Bing Webmaster Tools (owner's account, signed in by the owner): the property had sat unverified since October 15. Bing reported it could not read `BingSiteAuth.xml`, although the file answers 200 to bingbot user agents. Commit bb7575e adds the same two keys as `msvalidate.01` meta tags on the home page; Bing verified on the next attempt. Keep both tags and the XML file.
- Bing sitemap: last read November 7 with 64 URLs. Resubmitted November 15 (UTC); status "Processing". The live sitemap has 83.
- Google Search Console (domain property, already verified): sitemap resubmitted; last read November 14 with 82 pages. Page indexing report: 53 indexed, 242 not indexed (204 excluded by noindex, 25 redirects, 4 not found, 9 discovered but not indexed).
- Indexing requested in Search Console for /collections/research-sprays ("Discovered, currently not indexed") and /locations (last crawled November 4 while it was still noindex). Both were added to the priority crawl queue.
- Checks for bb7575e: `npm run check:release` (TypeScript and 130 suites) and the production build passed; both meta tags confirmed in the live home page HTML.

## Checkout finding (read-only production aggregates, no customer details recorded here)

In the five weeks to November 14, 29 checkouts worth about $6,980 reached the payment page and were not paid, against about $8,300 paid. Of 34 card attempts with saved payment details, 12 were declined. Four of those were approved by the card issuer and then rejected by the store's own Authorize.net filters (Enhanced CCV Handling twice, Enhanced AVS Handling twice). The three orders in `review` are declined cards, not fraud holds. Nine recovery emails were sent and none led to a paid order. Filter settings live in the Authorize.net Merchant Interface and were not changed.
