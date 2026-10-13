-- Reply desk v1. Owner send approval, an explicitly chosen original report, and
-- private learning rows (AI draft vs. what the owner actually sent). No outbound transport runs here.
ALTER TABLE request_reply_drafts ADD COLUMN approved_at INTEGER;
--> statement-breakpoint
ALTER TABLE request_reply_drafts ADD COLUMN approved_by TEXT;
--> statement-breakpoint
ALTER TABLE request_reply_drafts ADD COLUMN ai_draft TEXT;
--> statement-breakpoint
ALTER TABLE request_reply_drafts ADD COLUMN coa_choice TEXT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS request_reply_learning (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL,
 customer_message TEXT NOT NULL,
 instruction TEXT NOT NULL,
 ai_draft TEXT NOT NULL,
 final_body TEXT NOT NULL,
 changed INTEGER NOT NULL CHECK(changed IN (0,1)),
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_reply_learning_recent ON request_reply_learning(created);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS request_reply_style (
 id TEXT PRIMARY KEY NOT NULL,
 rule TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS request_reply_bridge_seen (id INTEGER PRIMARY KEY CHECK(id=1), seen INTEGER NOT NULL);
--> statement-breakpoint
INSERT OR IGNORE INTO request_reply_bridge_seen(id,seen) VALUES(1,0);
