# Calendar report windows

Implementation prepared November 27, 2026. Release status and deployment evidence belong in the release record; this document does not claim deployment.

Sales, financial summaries, promotion attribution, Today sales cards, traffic and shopping reports share a validated IANA reporting timezone. UTC remains the default. Custom first and last dates are inclusive calendar labels, converted once to exact first-inclusive/end-exclusive instants. Completed dates precede today in that timezone, with at most 366 dates. Legacy `days` parameters keep their existing defaults and allowed presets. Custom dates cannot be combined with `days`.

The timezone selection belongs to the browser, not a store-wide business-setting write. No order timestamps are moved. Today operational queues remain current; selected report dates affect sales comparisons only. Sales, financial and promotion CSV exports identify the selected timezone, inclusive dates and exact UTC instant boundaries. Original store payment observations and provider-reported settlement batch dates are separate evidence and coverage measures.

## Traffic storage and coverage

Migration `0045_report_window_aggregates.sql` adds constrained anonymous minute category counts to the existing daily tables. Minute buckets contain only the server minute, existing category enums and an integer count. They contain no event log, visitor/request identifier, product, order, path, referrer, client timestamp or customer information. A two-row operational table records the first successful minute collection for traffic and shopping separately. Request shape, opt-outs, no-cookie behavior and independent activation settings are unchanged.

Daily and minute increments run in one transaction. The existing global limit of 50,000 accepted events per UTC date applies independently to traffic and shopping. A rejected increment cannot add a minute bucket or begin coverage. Repeated HTTP submissions still may count repeatedly; no identity or request deduplication has been introduced. Minute tables use composite primary keys without separate row IDs. At most 50,000 populated minute rows can be created per accepted UTC date per measurement kind, with fewer rows when events share a minute/category. Existing daily category cardinality remains unchanged.

Daily and minute tables retain the current UTC date and preceding 89 UTC dates. All four deletions and success metadata share the existing cleanup transaction, invoked by ingestion, protected reports and the daily sweep. Failure metadata is best effort. Deletion is not instantaneous at midnight.

Historical UTC reports continue reading their original daily aggregates. Other timezones use minute counts only from their actual first recorded coverage; old daily totals are never converted, backfilled, or represented as zero local activity. A local date partly outside measurement activation, minute collection coverage or UTC retention is excluded from completed totals and shown separately when it overlaps the request. Missing history has null totals. Current-day context is separate on presets and omitted from historical custom reports. All caps and retention labels remain explicitly UTC, even when report dates are local. Collection gaps, failures and blocked scripts can still reduce counts; coverage does not certify uninterrupted collection.

## Release and verification

Apply migration 0045 before deploying the runtime that uses shared cleanup. Existing activation flags and timestamps remain unchanged. Rolling back to the earlier runtime preserves existing daily tables; it stops minute collection, so any later reactivation must account for the resulting coverage gap rather than imply uninterrupted minute history.

Isolated tests cover DST 23/25-hour dates, half-hour transitions, 45-minute offsets, custom boundary inclusion/exclusion, legacy UTC history, unavailable pre-rollout local history, partial coverage, UTC retention cuts, UTC caps across local dates, authorization before validation/storage, anonymous schema bounds, transactional rejection and rollback. The mutation test deliberately includes the exclusive final minute and proves the boundary regression fails. Production recording must be observed naturally, never seeded with QA events.
