-- Private request correspondence. No outbound transport runs from this migration.
CREATE TABLE IF NOT EXISTS request_reply_drafts (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL UNIQUE,
 revision INTEGER NOT NULL CHECK(revision>=1),
 status TEXT NOT NULL CHECK(status IN ('queued','preparing','ready','needs_review','sending','sent','cancelled')),
 mode TEXT NOT NULL CHECK(mode IN ('ai','staff')),
 sender TEXT NOT NULL CHECK(sender='research@biomodpeptides.com'),
 recipient TEXT NOT NULL,
 subject TEXT NOT NULL,
 proposed_body TEXT NOT NULL,
 instruction TEXT NOT NULL,
 body TEXT NOT NULL,
 prepared_by TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 coa_json TEXT NOT NULL CHECK(json_valid(coa_json)),
 ready_id TEXT,
 model TEXT,
 reason TEXT,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 lease_token TEXT,
 lease_until INTEGER,
 send_locked_at INTEGER,
 send_body_hash TEXT,
 provider_message_id TEXT,
 provider_thread_id TEXT,
 sent_at INTEGER,
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_reply_draft_queue ON request_reply_drafts(status,lease_until,created);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS request_reply_messages (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('incoming','outgoing')),
 body TEXT NOT NULL,
 created INTEGER NOT NULL,
 provider_message_id TEXT NOT NULL,
 provider_thread_id TEXT,
 sender TEXT NOT NULL,
 recipient TEXT NOT NULL,
 attachment_hash TEXT,
 reply_job_id TEXT,
 reply_revision INTEGER,
 ready_id TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_reply_message_thread ON request_reply_messages(request_id,created);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_reply_message_original ON request_reply_messages(recipient,attachment_hash,direction);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_messages_no_replace BEFORE INSERT ON request_reply_messages WHEN EXISTS(SELECT 1 FROM request_reply_messages WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Sent and received reply messages are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_messages_immutable_update BEFORE UPDATE ON request_reply_messages BEGIN SELECT RAISE(ABORT,'Sent and received reply messages are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_messages_immutable_delete BEFORE DELETE ON request_reply_messages BEGIN SELECT RAISE(ABORT,'Sent and received reply messages are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_drafts_preserve_delete BEFORE DELETE ON request_reply_drafts BEGIN SELECT RAISE(ABORT,'Reply preparation history must be preserved'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_request_reply_drafts_insert AFTER INSERT ON request_reply_drafts BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),COALESCE((SELECT source FROM change_context WHERE id=1),'system'),COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),'request_reply.prepare','request_reply',NEW.id,'Customer reply prepared for owner review','succeeded',json_array(json_object('field','Status','before',NULL,'after',NEW.status),json_object('field','Revision','before',NULL,'after',NEW.revision),json_object('field','Draft mode','before',NULL,'after',NEW.mode)));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_request_reply_drafts_update AFTER UPDATE ON request_reply_drafts
WHEN OLD.status IS NOT NEW.status OR OLD.revision IS NOT NEW.revision OR OLD.mode IS NOT NEW.mode
BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),COALESCE((SELECT source FROM change_context WHERE id=1),'system'),COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),'request_reply.update','request_reply',NEW.id,'Customer reply workflow updated','succeeded',(SELECT json_group_array(json_object('field',a.key,'before',a.value,'after',b.value)) FROM json_each(json_object('Status',OLD.status,'Revision',OLD.revision,'Draft mode',OLD.mode)) a JOIN json_each(json_object('Status',NEW.status,'Revision',NEW.revision,'Draft mode',NEW.mode)) b ON a.key=b.key WHERE a.value IS NOT b.value));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_request_reply_messages_insert AFTER INSERT ON request_reply_messages BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),COALESCE((SELECT source FROM change_context WHERE id=1),'system'),COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),'request_reply.message_recorded','request_reply',NEW.request_id,'Customer conversation message recorded','succeeded',json_array(json_object('field','Direction','before',NULL,'after',NEW.direction)));
END;

--> statement-breakpoint
-- Every eligibility read is bound to the same registry/batch generation at send lock.
-- This counter contains no private metadata. Concurrent changes require a new review.
CREATE TABLE IF NOT EXISTS request_reply_coa_guard (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL CHECK(revision>=0));
--> statement-breakpoint
INSERT OR IGNORE INTO request_reply_coa_guard(id,revision) VALUES(1,0);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_guard_coa_original_reports_insert AFTER INSERT ON coa_original_reports BEGIN UPDATE request_reply_coa_guard SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_guard_coa_original_reports_update AFTER UPDATE ON coa_original_reports BEGIN UPDATE request_reply_coa_guard SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_guard_coa_original_reports_delete AFTER DELETE ON coa_original_reports BEGIN UPDATE request_reply_coa_guard SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_guard_product_overrides_insert AFTER INSERT ON product_overrides WHEN json_extract(CASE WHEN json_valid(NEW.data) THEN NEW.data ELSE '{}' END,'$.batch') IS NOT NULL BEGIN UPDATE request_reply_coa_guard SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_guard_product_overrides_update AFTER UPDATE ON product_overrides WHEN json_extract(CASE WHEN json_valid(OLD.data) THEN OLD.data ELSE '{}' END,'$.batch') IS NOT json_extract(CASE WHEN json_valid(NEW.data) THEN NEW.data ELSE '{}' END,'$.batch') BEGIN UPDATE request_reply_coa_guard SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_guard_product_overrides_delete AFTER DELETE ON product_overrides WHEN json_extract(CASE WHEN json_valid(OLD.data) THEN OLD.data ELSE '{}' END,'$.batch') IS NOT NULL BEGIN UPDATE request_reply_coa_guard SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_guard_coa_delivery_outbox_insert AFTER INSERT ON coa_delivery_outbox WHEN NEW.purpose='coa' BEGIN UPDATE request_reply_coa_guard SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_guard_coa_delivery_outbox_update AFTER UPDATE ON coa_delivery_outbox WHEN OLD.purpose='coa' OR NEW.purpose='coa' BEGIN UPDATE request_reply_coa_guard SET revision=revision+1 WHERE id=1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS request_reply_guard_coa_delivery_outbox_delete AFTER DELETE ON coa_delivery_outbox WHEN OLD.purpose='coa' BEGIN UPDATE request_reply_coa_guard SET revision=revision+1 WHERE id=1; END;
