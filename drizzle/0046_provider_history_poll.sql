-- Durable pagination and short leases for read-only provider history polling.
-- Checkpoints contain only page numbers, commit hashes and provider pagination cursors.
CREATE TABLE IF NOT EXISTS provider_history_poll (
 source TEXT PRIMARY KEY NOT NULL,
 checkpoint TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint)),
 lease_id TEXT NOT NULL,
 lease_until INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 updated INTEGER NOT NULL
);
