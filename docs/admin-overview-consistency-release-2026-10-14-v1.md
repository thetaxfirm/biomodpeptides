# Admin overview consistency repair, October 14, 2026

The Today administration page previously derived sales from fulfillment work buckets. A paid order placed on hold or reporting a carrier failure disappeared from its sales figures. It also filtered out normalized zero-stock products before building stock warnings.

The overview now counts saved live payment records independently of fulfillment holds, requires both stored payment evidence fields, and separates sandbox, unknown-environment and missing-evidence counts. It excludes orders flagged as internal tests and future-dated records. Gross recorded amounts use the order-created cohort; they are not net revenue, settlement or confirmation that unclassified orders are customers. The existing scan limit is 5,000 recent records. Legacy `orders` and `revenue` fields remain aliases for older already-open clients.

Product attention now consumes `productAvailability` from the same normalized catalog used by the storefront. Sold-out and zero-stock items appear, while publication holds, unavailable and coming-soon products keep their existing treatment. Pacific midnight now uses the offset before the DST transition. Historical orders, prices, stock, product publication, staff roles, credentials, provider settings and delivery behavior were not changed.

## Source and affected consumers

Reviewed shared main through `06c84ddd61fb4cb705b88c110565a640cf71eebe`, preserving all 31 intervening commits since `c373286`. Git author names and co-author trailers are evidence metadata, not proof of a particular human or model operator. The repair is recorded by this commit's Git metadata.

Affected source: `lib/admin-overview.ts`, `components/store/admin-overview.tsx`, `app/api/store/[action]/route.ts`; regressions: `tests/admin-overview-v1.cjs`, `tests/admin-overview-worker-v1.mjs`.

Affected URLs: `/admin` Today tab and protected `/api/store/admin-overview`. The internal SELECT now reads payment evidence but does not return references or order identities. Financial figures remain restricted to report-capable staff; owner and manager receive the same store facts. Public catalog and checkout consumers are unchanged.

## Validation

- Focused regression compares overview logic with actual sales-diagnostics SQL against isolated SQLite. Covers holds, carrier failures, saved environment aliases, missing evidence, test/future exclusions, rolling boundaries, DST and normalized catalog states.
- `BIOMOD_DEPLOY=true npm run build`: TypeScript, 74 isolated release suites, whitespace checks and production Worker build passed.
- `node tests/admin-overview-worker-v1.mjs`: actual compiled Worker and isolated D1 migrations passed for owner, manager, support, fulfillment, customer and anonymous access. Synthetic auth only; all other outbound calls blocked. Payment references excluded from responses; GETs preserve records.
- Independent final diff review found no actionable issue.

Deployment, post-release live observations and exact source/provider evidence are recorded in the versioned October 14 daily receipt under the approved BioMod-SEO-Sprint evidence folder. Do not treat these local checks alone as production verification. Provider acceptance, fulfillment labels and stored payment evidence do not prove inbox delivery, physical mailing or settled net revenue.
