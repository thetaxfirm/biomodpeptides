-- Store staff below the owner level. Owners stay in the STORE_ADMIN_EMAILS runtime setting.
CREATE TABLE IF NOT EXISTS staff (
 email TEXT PRIMARY KEY NOT NULL CHECK(email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
 name TEXT NOT NULL DEFAULT '',
 role TEXT NOT NULL CHECK(role IN ('manager','fulfillment','support')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL,
 updated_by TEXT NOT NULL
);
-- Append-only record of who granted, changed or removed access.
CREATE TABLE IF NOT EXISTS staff_audit (
 id TEXT PRIMARY KEY NOT NULL,
 actor TEXT NOT NULL,
 email TEXT NOT NULL,
 role TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_audit_created ON staff_audit(created);
