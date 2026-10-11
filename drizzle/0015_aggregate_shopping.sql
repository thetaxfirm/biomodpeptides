-- Aggregate stages only. Never store product, person, order or payment identifiers.
CREATE TABLE IF NOT EXISTS shopping_daily (
  day TEXT NOT NULL CHECK(day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d',day,'+0 days') IS NOT NULL AND strftime('%Y-%m-%d',day,'+0 days')=day),
  stage TEXT NOT NULL CHECK(stage IN ('cart_add_confirmed','cart_view','checkout_signin_view','checkout_form_view','delivery_quote_confirmed','checkout_handoff_ready')),
  event_count INTEGER NOT NULL CHECK(typeof(event_count)='integer' AND event_count BETWEEN 1 AND 50000),
  PRIMARY KEY(day,stage)
);
