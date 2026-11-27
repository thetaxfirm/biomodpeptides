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
CREATE INDEX IF NOT EXISTS requests_email ON requests(lower(trim(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.email'))));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_customer_email ON orders(lower(trim(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.email'))),created DESC,id DESC);
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
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_request_work_insert AFTER INSERT ON request_work BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),NEW.updated,NEW.updated,COALESCE((SELECT source FROM change_context WHERE id=1),'system'),COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),'request.work','request',NEW.request_id,'Request assignment and next action recorded','succeeded',json_array(json_object('field','Assignee','before',NULL,'after',NEW.assignee),json_object('field','Triage','before',NULL,'after',NEW.triage)));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_request_work_update AFTER UPDATE ON request_work BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),NEW.updated,NEW.updated,COALESCE((SELECT source FROM change_context WHERE id=1),'system'),COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),'request.work','request',NEW.request_id,'Request assignment, next action or resolution updated','succeeded',json_array(json_object('field','Assignee','before',OLD.assignee,'after',NEW.assignee),json_object('field','Triage','before',OLD.triage,'after',NEW.triage),json_object('field','Due date','before',OLD.due_at,'after',NEW.due_at)));
END;
