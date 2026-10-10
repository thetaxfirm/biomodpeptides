-- Aggregate categories only: no per-request rows, identifiers, URLs, or headers.
CREATE TABLE IF NOT EXISTS traffic_daily (
  day TEXT NOT NULL CHECK(day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d',day,'+0 days') IS NOT NULL AND strftime('%Y-%m-%d',day,'+0 days')=day),
  page_group TEXT NOT NULL CHECK(page_group IN ('home','catalog','product','documents','guide','about','locations','contact','policy')),
  source_group TEXT NOT NULL CHECK(source_group IN ('search','ai','social','external_other','internal','direct_or_unavailable')),
  event_count INTEGER NOT NULL CHECK(typeof(event_count)='integer' AND event_count BETWEEN 1 AND 50000),
  PRIMARY KEY(day,page_group,source_group)
);
-- A single operational row. These are cleanup times, never visitor timestamps.
CREATE TABLE IF NOT EXISTS traffic_metrics_health (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_attempt INTEGER NOT NULL CHECK(typeof(last_attempt)='integer' AND last_attempt>=0),
  last_success INTEGER CHECK(last_success IS NULL OR (typeof(last_success)='integer' AND last_success>=0)),
  last_failure INTEGER CHECK(last_failure IS NULL OR (typeof(last_failure)='integer' AND last_failure>=0)),
  last_status TEXT NOT NULL CHECK(last_status IN ('ok','failed'))
);
