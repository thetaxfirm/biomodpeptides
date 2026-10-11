-- Operational correspondence only. Not traffic analytics. No report bytes or credentials.
CREATE TABLE IF NOT EXISTS coa_delivery_outbox (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('coa','request-alert')),
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','manual_review','duplicate')),
 reason TEXT NOT NULL,
 recipient TEXT,
 recipient_hash TEXT,
 dedupe_key TEXT,
 duplicate_of TEXT,
 document_hash TEXT,
 attachment_name TEXT,
 product_name TEXT,
 strength TEXT,
 lot TEXT,
 report_id TEXT,
 template_version TEXT NOT NULL,
 sender TEXT,
 reply_to TEXT,
 subject TEXT,
 body TEXT,
 payload_hash TEXT,
 idempotency_key TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 first_attempt_at INTEGER,
 next_attempt_at INTEGER NOT NULL,
 lease_token TEXT,
 lease_until INTEGER,
 provider_id TEXT,
 accepted_at INTEGER,
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL,
 UNIQUE(request_id,purpose)
);
CREATE UNIQUE INDEX IF NOT EXISTS coa_delivery_recipient_report ON coa_delivery_outbox(dedupe_key)
 WHERE purpose='coa' AND dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS coa_delivery_ready ON coa_delivery_outbox(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS coa_delivery_quota ON coa_delivery_outbox(purpose,first_attempt_at,recipient_hash);

-- Approved originals are private operational records, never public repository assets.
CREATE TABLE IF NOT EXISTS coa_original_reports (
 sha256 TEXT PRIMARY KEY NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
 data TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);
