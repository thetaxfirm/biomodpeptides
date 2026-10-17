-- Owner request, October 16, 2026: the reply desk sends from contact@trybiomod.com.
-- Rebuilds request_reply_drafts so the sender check also allows the new mailbox; earlier rows keep research@biomodpeptides.com.
-- Drafts not yet sent move to the new sender. Triggers and index are recreated unchanged after the copy, so the copy writes no audit events.
CREATE TABLE request_reply_drafts_new (
 id TEXT PRIMARY KEY NOT NULL,
 request_id TEXT NOT NULL UNIQUE,
 revision INTEGER NOT NULL CHECK(revision>=1),
 status TEXT NOT NULL CHECK(status IN ('queued','preparing','ready','needs_review','sending','sent','cancelled')),
 mode TEXT NOT NULL CHECK(mode IN ('ai','staff')),
 sender TEXT NOT NULL CHECK(sender IN ('research@biomodpeptides.com','contact@trybiomod.com')),
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
, approved_at INTEGER, approved_by TEXT, ai_draft TEXT, coa_choice TEXT);
--> statement-breakpoint
INSERT INTO request_reply_drafts_new(id,request_id,revision,status,mode,sender,recipient,subject,proposed_body,instruction,body,prepared_by,request_hash,coa_json,ready_id,model,reason,attempts,lease_token,lease_until,send_locked_at,send_body_hash,provider_message_id,provider_thread_id,sent_at,created,updated,approved_at,approved_by,ai_draft,coa_choice) SELECT id,request_id,revision,status,mode,sender,recipient,subject,proposed_body,instruction,body,prepared_by,request_hash,coa_json,ready_id,model,reason,attempts,lease_token,lease_until,send_locked_at,send_body_hash,provider_message_id,provider_thread_id,sent_at,created,updated,approved_at,approved_by,ai_draft,coa_choice FROM request_reply_drafts;
--> statement-breakpoint
DROP TABLE request_reply_drafts;
--> statement-breakpoint
ALTER TABLE request_reply_drafts_new RENAME TO request_reply_drafts;
--> statement-breakpoint
CREATE INDEX request_reply_draft_queue ON request_reply_drafts(status,lease_until,created);
--> statement-breakpoint
CREATE TRIGGER request_reply_drafts_preserve_delete BEFORE DELETE ON request_reply_drafts BEGIN SELECT RAISE(ABORT,'Reply preparation history must be preserved'); END;
--> statement-breakpoint
CREATE TRIGGER audit_request_reply_drafts_insert AFTER INSERT ON request_reply_drafts BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),COALESCE((SELECT source FROM change_context WHERE id=1),'system'),COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),'request_reply.prepare','request_reply',NEW.id,'Customer reply prepared for owner review','succeeded',json_array(json_object('field','Status','before',NULL,'after',NEW.status),json_object('field','Revision','before',NULL,'after',NEW.revision),json_object('field','Draft mode','before',NULL,'after',NEW.mode)));
END;
--> statement-breakpoint
CREATE TRIGGER audit_request_reply_drafts_update AFTER UPDATE ON request_reply_drafts
WHEN OLD.status IS NOT NEW.status OR OLD.revision IS NOT NEW.revision OR OLD.mode IS NOT NEW.mode
BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),COALESCE((SELECT source FROM change_context WHERE id=1),'system'),COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),'request_reply.update','request_reply',NEW.id,'Customer reply workflow updated','succeeded',(SELECT json_group_array(json_object('field',a.key,'before',a.value,'after',b.value)) FROM json_each(json_object('Status',OLD.status,'Revision',OLD.revision,'Draft mode',OLD.mode)) a JOIN json_each(json_object('Status',NEW.status,'Revision',NEW.revision,'Draft mode',NEW.mode)) b ON a.key=b.key WHERE a.value IS NOT b.value));
END;
--> statement-breakpoint
UPDATE request_reply_drafts SET sender='contact@trybiomod.com' WHERE status NOT IN ('sent','sending');
