# TryBiomod aggregate traffic measurement: technical handoff v1

Status: **Planned / not implemented.** Reviewed October 9, 2026. This document does not install measurement, change production, or establish a traffic baseline. Scope is TryBiomod only; BiomodPro remains deferred.

## Purpose and boundaries

Measure accepted public page-view events by broad page and referral category. Start with this one event type. Do not add cart, checkout, payment, person-level attribution or session tracking in this increment. Existing protected sales diagnostics remain separate. Counts are recorded events, not unique visitors, confirmed humans, conversions or attributable revenue.

Only fixed categories leave the browser. Do not transmit or persist product identity, raw page URL, URL parameters, search terms, referrer URL, user agent, IP address, customer/order/session identifiers or exact client timestamps. Do not create analytics cookies, browser-storage identifiers or fingerprints. Privacy minimization here is not permission to conceal held-product identities or alter public product disclosures. Preserve the existing publication holds and source records.

## Architecture and proposed files

- `lib/traffic-metrics.ts`: small shared enum definitions, pure validation, server-UTC windows, aggregate SQL and report contract. Avoid importing the full catalog into a new measurement bundle.
- `app/api/metrics/route.ts`: separate cookie-free public POST endpoint. Never route through store POST handling: `app/api/store/[action]/route.ts` currently calls `session()` and `rateLimit(action + IP)`, which creates shopping sessions and persists an IP-based key.
- `components/store/traffic-measurement.tsx`, mounted in `app/layout.tsx`: visible-page dispatch with in-memory deduplication and opt-out checks.
- A new numbered migration under `drizzle/`, plus `db/schema.ts`. **Recheck the latest migration number and collaborator changes immediately before implementation.** `0013` was the latest reviewed; do not reserve the next number in advance.
- A separate protected report endpoint and `components/store/traffic-diagnostics.tsx`, mounted within `components/store/admin.tsx`. Call `requireAdmin()` before validation or database access; no raw customer or order joins.
- `components/store/content.tsx`: factual measurement disclosure beside the existing privacy information. Do not claim the whole draft policy or site is compliance-certified.
- `tests/traffic-metrics-v1.cjs`: isolated SQLite, request-handler and client behavior coverage.

## Collection contract

Use a strict object containing only `{ event: "page_view", pageGroup, sourceGroup }`. Proposed page groups: `home`, `catalog`, `product`, `documents`, `guide`, `about`, `locations`, `contact`, `policy`. Do not accept arbitrary paths or an unrestricted other-page string. Validate real public route existence before dispatch; unknown product slugs and error pages must not count.

Proposed sources: `search`, `ai`, `social`, `external_other`, `internal`, `direct_or_unavailable`. Classify exact known hostnames in the browser, then discard the referrer. Use URL hostname parsing and explicit host/subdomain checks, never substring matching. Unknown or blank referrers are not proof of direct traffic; AI applications frequently omit referrers. Keep the fixed host map small and tested. Do not send UTM values or infer search queries.

On an initial document navigation, classify `document.referrer`. On later client-side navigation, use `internal`; the initial referrer must not be re-credited on every route. Emit at most once per completed visible navigation. Ignore hash-only changes, rerenders, remount duplication and prefetches. In-memory deduplication is limited to the current document, not a durable visitor ID. Do not retry failed submissions automatically, which risks duplicate counts.

## Request, privacy and QA safeguards

- Default disabled. Require an explicit production environment flag and exact HTTPS production origin. Canonical `trybiomod.com` only initially; do not enable preview, localhost, workers.dev or legacy generated-site hosts. A future www-origin allowance requires an explicit tested decision.
- Require matching `Origin` and `Sec-Fetch-Site: same-origin`, JSON content type, no unexpected URL parameters, and a small streamed body limit (256 bytes is sufficient). Reject missing/foreign origins and unknown properties before database access. No CORS allowance.
- Send with `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`. The endpoint must not call shopping-session helpers or return `Set-Cookie`. Never read cookies or IP headers for metrics.
- Skip collection when `navigator.globalPrivacyControl === true` or `Sec-GPC: 1` is present. This is a deliberate conservative collection rule. GPC expresses a sale/sharing preference and has incomplete browser availability; its absence is not affirmative consent. [MDN GPC documentation](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/globalPrivacyControl)
- Also honor `navigator.doNotTrack === '1'` or `DNT: 1` when present. DNT is deprecated and nonstandard; it is an additional exclusion, never the sole privacy mechanism. [MDN DNT documentation](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/doNotTrack)
- Exclude account, admin, cart, checkout, payment, login/reset/auth, API, preview and error paths. Wait for existing store readiness and skip known administrators. Anonymous staff visits cannot be identified reliably without tracking; document that limitation.
- Provide a documented explicit QA opt-out that persists for the current document only; recognize `navigator.webdriver`. All agent/live verification visits must opt out. Do not make repeated production visits to raise reported counts.
- No request payloads, headers or exception details in application logs. Platform transport/security logs are outside this feature's storage contract; do not claim IP data never reaches the hosting provider.
- Ingestion must never interrupt shopping. Return 204 for accepted or deliberately ignored events, generic validation errors for malformed input, and a generic 503 for storage failure. Never treat failure as a successful recorded event.

## Bounded storage and retention

One daily aggregate table is sufficient: server UTC day, page-group enum, source-group enum, integer count, composite primary key. Apply database constraints to all dimensions. With nine page groups, six source groups and 90 date buckets, the maximum planned cardinality is 4,860 rows. No event log or per-request record is necessary.

Use an atomic conditional upsert to cap total accepted daily events globally at a documented threshold, initially proposed at 50,000. This is an engineering limit, not a traffic estimate. Check the cap and increment in one SQL statement/transaction to prevent concurrent overshoot. Expose `capReached` in the protected report. A cap limits accepted counts; it does not prevent request costs or sophisticated bots. Origin headers, user-agent filters and webdriver checks can be spoofed. Do not reuse the IP-persisting `rateLimits` table. Any ephemeral burst throttle is best-effort only.

Retain the current UTC date plus the preceding 89 dates. Delete older buckets on accepted writes and protected report reads, and implement a verified scheduled cleanup for dormant periods. The current `vinext/server/fetch-handler` configuration has no reviewed scheduled handler. Resolve and test that integration before promising timed deletion. Request-triggered cleanup alone must be described as deletion on the next recording/report, not guaranteed 90-day removal. Record the cleanup execution time and failure state using non-identifying operational metadata. A scheduled daily sweep has a defined interval; do not claim instantaneous expiry at midnight.

## Protected reporting and deployment acceptance

The report includes collection enabled/configuration status, measurement start time, reporting window, completed UTC-day buckets, retained coverage, cap status and cleanup health. Show partial today separately if included at all. Dates before activation are unavailable. Empty buckets mean no accepted events recorded, not proof of no visitors. A database failure is unavailable, never an empty report or zero. Explain opt-outs, blocked scripts, missing referrers and imperfect bot exclusion. Keep aggregate sales records and owner-classified internal test orders separate.

Before activation, test the complete recording path using an isolated local database. Verify strict body/host checks, all opt-outs, no cookie creation, private/404 exclusions, navigation deduplication, UTC boundaries, atomic cap concurrency, exact retention boundaries, admin authorization before reads, and generic failures. Inspect persisted columns and captured test requests for forbidden data. Build and type-check alongside the existing store regressions.

Deploy disabled first, verify migration and protected reporting, then activate only after safeguards and cleanup are proven. Production verification must use QA exclusions or an explicitly non-recording validation path. Do not seed production counts, manufacture referrals, perform purchases, or delete mixed customer/test aggregate buckets afterward. Verify the deployed client and denial/no-write behavior without changing totals; use naturally occurring eligible activity for the first production recording observation. Until then report that live ingestion awaits natural-event verification. Record commit, deployment, activation time, safeguards tested and any missing evidence in the sprint log.

Rollback: disable ingestion with the production flag, retain the aggregate table for authorized reporting/retention, and preserve collaborator edits. No ranking, sales or AI-visibility improvement may be claimed from installing measurement alone.
