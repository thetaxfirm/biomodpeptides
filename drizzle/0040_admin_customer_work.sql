-- Operational request ownership and append-only reward adjustments. No existing customer values change.
CREATE TABLE IF NOT EXISTS request_work (
 request_id TEXT PRIMARY KEY NOT NULL REFERENCES requests(id),
 assignee TEXT,
 next_action TEXT NOT NULL DEFAULT '',
 due_at INTEGER,
 resolution TEXT NOT NULL DEFAULT '',
 triage TEXT NOT NULL DEFAULT 'unreviewed' CHECK(triage IN ('unreviewed','customer','vendor')),
 version INTEGER NOT NULL DEFAULT 1,
 updated INTEGER NOT NULL,
 updated_by TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_work_due ON request_work(assignee,due_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS requests_status_created ON requests(status,created DESC,id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS requests_email ON requests(lower(trim(json_extract(data,'$.email'))));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_customer_email ON orders(lower(trim(json_extract(data,'$.email'))),created DESC,id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rewards_owner_created ON rewards(owner,created DESC,id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reward_adjustments (
 request_key TEXT PRIMARY KEY NOT NULL,
 reward_id TEXT NOT NULL UNIQUE REFERENCES rewards(id),
 actor TEXT NOT NULL,
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS rewards_no_update BEFORE UPDATE ON rewards BEGIN SELECT RAISE(ABORT,'Reward entries are immutable. Add a correcting entry.'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS rewards_no_delete BEFORE DELETE ON rewards BEGIN SELECT RAISE(ABORT,'Reward entries are immutable. Add a correcting entry.'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_adjustments_no_update BEFORE UPDATE ON reward_adjustments BEGIN SELECT RAISE(ABORT,'Reward attribution is immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS reward_adjustments_no_delete BEFORE DELETE ON reward_adjustments BEGIN SELECT RAISE(ABORT,'Reward attribution is immutable.'); END;
