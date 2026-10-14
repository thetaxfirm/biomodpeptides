-- Replies sent outside the desk: found in a connected mailbox by Jarvis, or marked by staff (phone, text).
CREATE TABLE IF NOT EXISTS request_external_replies (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('mailbox','manual')),
 account TEXT NOT NULL,
 message_id TEXT,
 sent_at INTEGER NOT NULL,
 body TEXT NOT NULL,
 preview INTEGER NOT NULL DEFAULT 0 CHECK(preview IN (0,1)),
 recorded_by TEXT NOT NULL,
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_external_replies_request ON request_external_replies(request_id,sent_at);
