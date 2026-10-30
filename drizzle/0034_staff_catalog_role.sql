-- Adds the Catalog staff role (owner request, Oct 30 2026): products, prices, sales and lot/COA links only.
-- SQLite cannot change a CHECK constraint in place, so the staff table is rebuilt with the same
-- columns and rows, then its change-history triggers (from 0020) are recreated unchanged.
-- No staff rows are added, removed or changed, and no change event is written for the copy.
CREATE TABLE staff_v2 (
 email TEXT PRIMARY KEY NOT NULL CHECK(email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
 name TEXT NOT NULL DEFAULT '',
 role TEXT NOT NULL CHECK(role IN ('manager','fulfillment','support','catalog')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL,
 updated_by TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO staff_v2(email,name,role,active,created,updated,updated_by) SELECT email,name,role,active,created,updated,updated_by FROM staff;
--> statement-breakpoint
DROP TABLE staff;
--> statement-breakpoint
ALTER TABLE staff_v2 RENAME TO staff;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_staff_insert AFTER INSERT ON staff
WHEN 1
BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),
 COALESCE((SELECT source FROM change_context WHERE id=1),'system'),
 COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),
 COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),
 COALESCE((SELECT action FROM change_context WHERE id=1),'staff.insert'),'staff',CAST(NEW.email AS TEXT),
 COALESCE((SELECT summary FROM change_context WHERE id=1),'Staff created' || ' (' || NEW.email || ')'),'succeeded',CASE WHEN (SELECT json_group_array(json_object('field',a.key,'before',a.value,'after',b.value)) FROM json_each(json_object('Role',NULL,'Active',NULL)) a JOIN json_each(json_object('Role',NEW.role,'Active',NEW.active)) b ON a.key=b.key WHERE a.value IS NOT b.value)='[]' THEN '[{"field":"Other stored fields","before":"Not copied","after":"Changed; private values are not recorded"}]' ELSE (SELECT json_group_array(json_object('field',a.key,'before',a.value,'after',b.value)) FROM json_each(json_object('Role',NULL,'Active',NULL)) a JOIN json_each(json_object('Role',NEW.role,'Active',NEW.active)) b ON a.key=b.key WHERE a.value IS NOT b.value) END);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_staff_update AFTER UPDATE ON staff
WHEN 1 AND (json_object('Role',OLD.role,'Active',OLD.active) IS NOT json_object('Role',NEW.role,'Active',NEW.active) OR OLD.name IS NOT NEW.name)
BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),
 COALESCE((SELECT source FROM change_context WHERE id=1),'system'),
 COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),
 COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),
 COALESCE((SELECT action FROM change_context WHERE id=1),'staff.update'),'staff',CAST(NEW.email AS TEXT),
 COALESCE((SELECT summary FROM change_context WHERE id=1),'Staff changed' || ' (' || NEW.email || ')'),'succeeded',CASE WHEN (SELECT json_group_array(json_object('field',a.key,'before',a.value,'after',b.value)) FROM json_each(json_object('Role',OLD.role,'Active',OLD.active)) a JOIN json_each(json_object('Role',NEW.role,'Active',NEW.active)) b ON a.key=b.key WHERE a.value IS NOT b.value)='[]' THEN '[{"field":"Other stored fields","before":"Not copied","after":"Changed; private values are not recorded"}]' ELSE (SELECT json_group_array(json_object('field',a.key,'before',a.value,'after',b.value)) FROM json_each(json_object('Role',OLD.role,'Active',OLD.active)) a JOIN json_each(json_object('Role',NEW.role,'Active',NEW.active)) b ON a.key=b.key WHERE a.value IS NOT b.value) END);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_staff_delete AFTER DELETE ON staff
WHEN 1
BEGIN
 INSERT INTO change_events(id,occurred_at,recorded_at,source,actor,actor_type,action,entity_type,entity_id,summary,status,changes)
 VALUES(lower(hex(randomblob(16))),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),
 COALESCE((SELECT source FROM change_context WHERE id=1),'system'),
 COALESCE((SELECT actor FROM change_context WHERE id=1),'Unattributed database change'),
 COALESCE((SELECT actor_type FROM change_context WHERE id=1),'unknown'),
 COALESCE((SELECT action FROM change_context WHERE id=1),'staff.delete'),'staff',CAST(OLD.email AS TEXT),
 COALESCE((SELECT summary FROM change_context WHERE id=1),'Staff removed' || ' (' || OLD.email || ')'),'succeeded',CASE WHEN (SELECT json_group_array(json_object('field',a.key,'before',a.value,'after',b.value)) FROM json_each(json_object('Role',OLD.role,'Active',OLD.active)) a JOIN json_each(json_object('Role',NULL,'Active',NULL)) b ON a.key=b.key WHERE a.value IS NOT b.value)='[]' THEN '[{"field":"Other stored fields","before":"Not copied","after":"Changed; private values are not recorded"}]' ELSE (SELECT json_group_array(json_object('field',a.key,'before',a.value,'after',b.value)) FROM json_each(json_object('Role',OLD.role,'Active',OLD.active)) a JOIN json_each(json_object('Role',NULL,'Active',NULL)) b ON a.key=b.key WHERE a.value IS NOT b.value) END);
END;
