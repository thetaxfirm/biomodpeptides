# Homepage product discovery, October 14, 2026

The homepage initially rendered 16 vial cards while the publication-reviewed group contained 17 products. Thymosin Alpha-1 10 mg was the only reviewed product without an initial homepage anchor. It was already linked from the shop and included in the sitemap, so this was a direct homepage discovery gap, not an orphan-page or indexing block.

HomeVials now orders the supplied catalog using the shared discovery policy and renders every eligible vial initially. The eligible count is derived from current props; only additional browsing is kept in component state. Load more retains 16-card increments for the remaining catalog. Smaller reviewed groups do not fill unused slots with held products. Product identity, availability, prices, inventory, purchase controls and publication holds remain governed by their existing sources. Only the homepage sitemap modification date changes to October 14.

## Source and scope

Base: 9595696a90b8d765489b45c1d4738056e1e252cd, including the intervening contributor's separate-preorder checkout changes. Source author/operator for this repair: Codex in the current owner-authorized TryBiomod traffic-growth task. Git author metadata is separate evidence and does not identify which person operated a shared account.

Changed files: components/store/home-vials.tsx, lib/sitemap-lastmod.ts, tests/product-discovery-v1.cjs and this release record. Affected URLs: / and /sitemap.xml; the newly visible product link is /product/thymosin-alpha-1-10mg. Shop, product pages, size links, cart and publication policy are preserved, with relevant shared behavior covered by the release gate.

## Validation and expected result

Focused rendered-HTML regression verifies all eligible product anchors, empty/small/16/17-item inputs, held-sale exclusion, prop changes, Load more increments and cap, runtime prices, size links and unchanged catalog records. The actual homepage route is rendered, not just a helper. Full production build passed TypeScript and 74 isolated suites. Tests use no customer data or real provider operations.

Before-change public HTML observation: /private/tmp/trybiomod-product-search-gap-2026-10-14-v1.json. Versioned private SEO evidence records the source SHA, exact-commit build checks, active Cloudflare deployment, live HTML and browser verification after publication. A local build alone is not production proof. Direct server binary-to-SHA attestation remains unavailable with existing provider access.

Expected metric: impressions and clicks for the Thymosin Alpha-1 product page and related nonbranded queries in subsequent complete Search Console periods. No traffic uplift, ranking change or causal attribution is claimed from this release. A separate local editorial pitch is prepared for owner approval; it is not an acquired backlink or published coverage.
