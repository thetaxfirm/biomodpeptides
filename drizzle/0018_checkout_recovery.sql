-- Private, operational recovery correspondence. Existing orders are not enrolled.
CREATE TABLE IF NOT EXISTS checkout_recovery (
 order_id TEXT PRIMARY KEY NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','review','skipped')),
 reason TEXT NOT NULL,
 recipient_hash TEXT NOT NULL,
 unsubscribe_token TEXT NOT NULL UNIQUE,
 payload TEXT NOT NULL,
 original_snapshot TEXT NOT NULL,
 savings INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 first_attempt_at INTEGER,
 next_attempt_at INTEGER NOT NULL,
 lease_until INTEGER,
 lease_token TEXT,
 provider_id TEXT,
 accepted_at INTEGER,
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS checkout_recovery_ready ON checkout_recovery(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS checkout_recovery_recipient ON checkout_recovery(recipient_hash,created);
CREATE TABLE IF NOT EXISTS checkout_recovery_suppression (
 recipient_hash TEXT PRIMARY KEY NOT NULL,
 created INTEGER NOT NULL
);
INSERT OR IGNORE INTO settings(key,value) VALUES('checkout_recovery_v1','{"enabled":false,"startsAt":null}');

CREATE TABLE IF NOT EXISTS checkout_recovery_checks (order_id TEXT PRIMARY KEY NOT NULL, next_check INTEGER NOT NULL);
