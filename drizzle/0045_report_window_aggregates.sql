-- Anonymous category counts only. UTC daily history cannot be re-bucketed into local dates.
-- Minute buckets support IANA offsets without storing events, paths, people or orders.
-- All buckets retain the current UTC date plus 89 dates, under the existing daily caps.
CREATE TABLE IF NOT EXISTS traffic_minute (
  bucket INTEGER NOT NULL CHECK(typeof(bucket)='integer' AND bucket>=0 AND bucket%60000=0),
  page_group TEXT NOT NULL CHECK(page_group IN ('home','catalog','product','documents','guide','about','locations','contact','policy')),
  source_group TEXT NOT NULL CHECK(source_group IN ('search','ai','social','external_other','internal','direct_or_unavailable')),
  event_count INTEGER NOT NULL CHECK(typeof(event_count)='integer' AND event_count BETWEEN 1 AND 50000),
  PRIMARY KEY(bucket,page_group,source_group)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS shopping_minute (
  bucket INTEGER NOT NULL CHECK(typeof(bucket)='integer' AND bucket>=0 AND bucket%60000=0),
  stage TEXT NOT NULL CHECK(stage IN ('cart_add_confirmed','cart_view','checkout_signin_view','checkout_form_view','delivery_quote_confirmed','checkout_handoff_ready')),
  event_count INTEGER NOT NULL CHECK(typeof(event_count)='integer' AND event_count BETWEEN 1 AND 50000),
  PRIMARY KEY(bucket,stage)
) WITHOUT ROWID;
-- First successful collection time, not reconstructed historical coverage.
CREATE TABLE IF NOT EXISTS metrics_time_coverage (
  kind TEXT PRIMARY KEY CHECK(kind IN ('traffic','shopping')),
  started_at INTEGER NOT NULL CHECK(typeof(started_at)='integer' AND started_at>=0)
) WITHOUT ROWID;
