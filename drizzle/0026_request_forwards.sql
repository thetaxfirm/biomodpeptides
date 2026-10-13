-- Internal forwards of a customer request to a BioMod staff member or owner. Private; no customer email is sent.
CREATE TABLE IF NOT EXISTS request_forwards (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL,
 to_email TEXT NOT NULL,
 by_email TEXT NOT NULL,
 note TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','accepted','failed')),
 provider_id TEXT,
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_forwards_request ON request_forwards(request_id,created);
