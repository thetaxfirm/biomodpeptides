-- Website update requests (owner request, Nov 24 2026).
-- An authorized staff member describes a change to pictures, lab reports or wording and attaches
-- the files. The change is carried out from the owner's desk under docs/site-updates-lane-v1.md
-- and the outcome is written back here. Owners see every request and every outcome.
-- No customer data lives in these tables.

-- Who may send requests. Owners always may; everyone else needs an active row here AND an
-- active staff row. Rows are switched off, never deleted, so the grant history stays readable.
CREATE TABLE IF NOT EXISTS site_update_access (
 email TEXT PRIMARY KEY NOT NULL CHECK(email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 updated INTEGER NOT NULL,
 updated_by TEXT NOT NULL
);
--> statement-breakpoint
-- Status. draft: files still uploading. new: waiting to be worked. question: waiting on the
-- requester. needs_owner: outside the lane, waiting on an owner.
CREATE TABLE IF NOT EXISTS site_updates (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE CHECK(length(id)=36),
 requester TEXT NOT NULL CHECK(requester = lower(trim(requester)) AND length(requester) BETWEEN 3 AND 254),
 kind TEXT NOT NULL CHECK(kind IN ('picture','coa','wording','other')),
 product_id INTEGER,
 product_name TEXT NOT NULL DEFAULT '' CHECK(length(product_name) <= 200),
 lot TEXT NOT NULL DEFAULT '' CHECK(length(lot) <= 40),
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 4000),
 status TEXT NOT NULL CHECK(status IN ('draft','new','working','question','needs_owner','done','cancelled')),
 owner_ok INTEGER NOT NULL DEFAULT 0 CHECK(owner_ok IN (0,1)),
 owner_ok_by TEXT NOT NULL DEFAULT '',
 result TEXT NOT NULL DEFAULT '' CHECK(length(result) <= 4000),
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS site_updates_status ON site_updates(status, updated);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS site_updates_requester ON site_updates(requester, created);
--> statement-breakpoint
-- The conversation on a request: follow-ups from the requester, decisions from an owner,
-- and what was done ('claude' = the owner's desk assistant working the request).
CREATE TABLE IF NOT EXISTS site_update_notes (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
 update_id TEXT NOT NULL REFERENCES site_updates(id),
 author TEXT NOT NULL CHECK(length(author) BETWEEN 1 AND 254),
 author_type TEXT NOT NULL CHECK(author_type IN ('staff','owner','claude')),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS site_update_notes_update ON site_update_notes(update_id, created);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS site_update_files (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
 update_id TEXT NOT NULL REFERENCES site_updates(id),
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 180),
 content_type TEXT NOT NULL CHECK(length(content_type) BETWEEN 1 AND 100),
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 16777216),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
 chunks INTEGER NOT NULL CHECK(chunks BETWEEN 1 AND 64),
 uploaded_by TEXT NOT NULL,
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS site_update_files_update ON site_update_files(update_id, created);
--> statement-breakpoint
-- A file is stored in pieces because one database value holds at most 2 MB. Pieces are written
-- before the file record, so a record exists only for a completely stored file; that is why this
-- table carries no foreign key.
CREATE TABLE IF NOT EXISTS site_update_file_chunks (
 file_id TEXT NOT NULL CHECK(length(file_id)=36),
 seq INTEGER NOT NULL CHECK(seq BETWEEN 0 AND 63),
 data BLOB NOT NULL CHECK(length(data) BETWEEN 1 AND 1048576),
 PRIMARY KEY(file_id, seq)
);
