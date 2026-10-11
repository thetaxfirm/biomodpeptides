# Shopping-stage measurement v1

October 10, 2026. Author: Codex. Base: `664b103`. Scope: TryBiomod only. This source increment extends aggregate page views with shopping stages; it does not establish traffic, sales, rankings or a visitor conversion rate. Production migration, release, activation and live observation are separate release steps, recorded by the release owner.

## Exact recording contract

The existing cookie-free `POST /api/metrics` accepts one of two strict shapes: the unchanged page-view shape, or `{ "event": "<allowed stage>" }`. A shopping event has exactly one property. The six permitted stages are:

| Stage | Meaning |
| --- | --- |
| `cart_add_confirmed` | One deliberate add operation received a successful store cart-write response. A single item, fixed pack, mixed pack or reorder is one operation, not one event per vial. Generic quantity edits, removals and refreshes are not additions. |
| `cart_view` | A loaded, visible, nonempty eligible cart was shown without a cart error or conflict. |
| `checkout_signin_view` | The sign-in screen was shown at checkout for a nonempty eligible cart. |
| `checkout_form_view` | The signed-in shopper's usable checkout form was shown. |
| `delivery_quote_confirmed` | A delivery response passed the existing stale-response guards and became the current quote. |
| `checkout_handoff_ready` | Checkout returned an accepted payment URL before navigation. This does not prove the hosted form opened, a charge happened or payment succeeded. |

There are no product, cart, account, order, quote, payment or session identifiers, names, emails, source categories, paths, URLs, queries, prices, amounts, payload error text or client timestamps in stage events. There is no public purchase/paid event. Do not attach the cart, form, quote or checkout API response to analytics.

## Browser boundary and deduplication

The shared client collector requires the exact HTTPS production origin, an enabled shopping flag, successful store readiness, a nonadministrator, a visible document and live enabled payment mode. Every relevant cart line must resolve to a currently publication-eligible product, including the active review-block check. Unknown products and carts mixing eligible and held products are skipped entirely. This does not change product availability, publication holds, order logic or product disclosure.

The document-scoped `measurement=off` opt-out persists through client navigation and remounts. GPC, DNT and webdriver exclusions are checked immediately before dispatch. There are no analytics cookies, storage IDs, fingerprints or journey identifiers. Current-document opt-out does not promise persistence after a full document reload. Anonymous staff and bots cannot be reliably identified.

View stages count once per completed visible navigation, not per render or StrictMode remount. Confirmed actions count at their operation boundary; repeated genuine actions can produce repeated events. Single-item pack delegation must not double count. The cart-write acknowledgement precedes store refresh, so a successful add followed by a failed refresh can still count as confirmed. Stale quote responses do not count. An action whose HTTP response was lost is unconfirmed to the browser, even if a server write occurred.

Dispatch is nonblocking, uses `credentials: omit`, `referrerPolicy: no-referrer`, no-store and small keepalive requests. There are no automatic retries or queues. Analytics failure must never change or interrupt commerce. The public endpoint validates the shape and request origin, not the authenticity of a person or shopping action; client policy checks do not turn counts into verified transactions.

## Server boundary and storage

`SHOPPING_MEASUREMENT_ENABLED` must be exactly `true`, with a valid nonfuture canonical UTC `SHOPPING_MEASUREMENT_STARTED_AT`. These settings are independent of page-view activation. Dates before shopping activation are unavailable, never borrowed from the older page-view baseline. Missing/invalid settings disable ingestion. A disabled flag preserves available historical reporting.

The existing endpoint keeps its streamed 256-byte bound, exact origin and same-origin header checks, JSON validation, GPC/DNT exclusions, no cookies/session helpers and generic errors. Do not move it into store POST handling: that path creates shopping sessions and records IP-based rate-limit keys. Do not log incoming payloads, headers, customer information or provider error details. Hosting transport/security logs are outside this feature's storage contract.

Migration `0015_aggregate_shopping.sql` adds `shopping_daily(day, stage, event_count)`, with a `(day,stage)` primary key and constrained dates, stages and integer counts. Six stages across 90 retained UTC dates permit at most 540 aggregate buckets. No per-event records or identity joins exist.

One atomic conditional upsert caps all shopping stages together at 50,000 accepted events per UTC day. The shopping and page-view caps are independent. This is an engineering ceiling, not a traffic estimate or complete abuse defense. Duplicate HTTP submissions can increase the aggregate; there is no identity or request-ID deduplication.

Both aggregate tables are cleaned in the same transaction, together with the existing cleanup-success metadata. Retain today and the preceding 89 UTC dates. The existing scheduled sweep at 09:00 UTC, ingestion and protected report reads invoke this same cleanup. A failure rolls back both deletions and records a best-effort nonidentifying failure status. The shared health row describes the combined sweep; deletion is not instantaneous at midnight.

## Protected report and UI

`GET /api/metrics/shopping-report?days=7|30|90` invokes `requireAdmin()` before inspecting query parameters, environment or storage. The Traffic administration tab also shows Shopping stages, with its own reporting-period selection and refresh. It reports stage counts for available complete UTC days, partial activation and today separately, shorter retained coverage, collection configuration, cap and cleanup health. Missing configuration/history and database failure remain unavailable. Empty measured buckets mean no accepted events recorded, not proof of no activity or uninterrupted collection.

Rows are independent event counts. Do not add them into visitor totals, divide them into conversion/abandonment percentages, infer a person's journey, or attribute revenue to a referrer. Existing protected sales/order diagnostics remain separate, with their original live/sandbox, internal-test and payment-evidence limits.

## Verification and release gate

- Isolated actual-handler/route and SQLite tests cover strict stage-only requests, header/privacy exclusions, independent activation and caps, concurrent cross-stage increments, exact retention boundaries and rollback, admin-first access, UTC reporting, missing history and generic failures.
- Actual dashboard hook tests cover stage meanings, complete and partial periods, 7/30/90 selection, loading/errors, refresh recovery, late responses and unavailable/paused cleanup states.
- The existing page-view backend and collector tests must remain passing. The built Worker test applies both migrations to isolated D1 and exercises real scheduled cleanup, both event types, opt-outs and both protected reports without commerce tables or external services.
- Client operation tests must exercise single/fixed/mixed/reorder additions, refresh failure after acknowledgement, visibility and eligibility, stale quotes, handoff and all shared opt-outs. Tests may use clearly isolated fixtures only, never synthetic production events, orders or payments.
- Apply migration 0015 before deploying this source: shared cleanup requires both tables. Build/type-check, inspect actual responsive controls, update the public privacy disclosure, then deploy with shopping collection disabled. Page-view flags must be preserved.
- Verify protected reporting and denial/no-write paths, then set the shopping flag and a fresh actual activation timestamp. Do not backdate it or inject production counts. Observe natural eligible events before claiming live ingestion was verified. Record exact release, binding and evidence separately.

Rollback: disable shopping ingestion using its flag. Preserve page-view measurement, commerce behavior, aggregate history and the joint retention sweep. No user password, administrator authorization, inventory, price, publication hold or payment state is changed by this increment.
