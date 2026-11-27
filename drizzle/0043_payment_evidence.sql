-- First receipt observation for NEW payment transitions only. Never backfill old orders from updated/created.
CREATE TABLE IF NOT EXISTS order_payment_observations (
 order_id TEXT PRIMARY KEY NOT NULL REFERENCES orders(id),
 recorded_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS order_payment_observe_insert AFTER INSERT ON orders
WHEN NEW.status IN ('paid','labeling','shipped','delivered')
 AND NULLIF(TRIM(NEW.payment_ref),'') IS NOT NULL AND NULLIF(TRIM(NEW.notification_id),'') IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO order_payment_observations(order_id,recorded_at) SELECT NEW.id,CAST(strftime('%s','now') AS INTEGER)*1000 WHERE NOT EXISTS(SELECT 1 FROM order_payment_observations WHERE order_id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS order_payment_observe_update AFTER UPDATE ON orders
WHEN NEW.status IN ('paid','labeling','shipped','delivered')
 AND NULLIF(TRIM(NEW.payment_ref),'') IS NOT NULL AND NULLIF(TRIM(NEW.notification_id),'') IS NOT NULL
 AND NOT (OLD.status IN ('paid','labeling','shipped','delivered') AND NULLIF(TRIM(OLD.payment_ref),'') IS NOT NULL AND NULLIF(TRIM(OLD.notification_id),'') IS NOT NULL)
BEGIN
 INSERT OR IGNORE INTO order_payment_observations(order_id,recorded_at) SELECT NEW.id,CAST(strftime('%s','now') AS INTEGER)*1000 WHERE NOT EXISTS(SELECT 1 FROM order_payment_observations WHERE order_id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS order_payment_observations_no_update BEFORE UPDATE ON order_payment_observations BEGIN SELECT RAISE(ABORT,'First payment observation is immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS order_payment_observations_no_delete BEFORE DELETE ON order_payment_observations BEGIN SELECT RAISE(ABORT,'First payment observation is immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS order_payment_observations_no_replace BEFORE INSERT ON order_payment_observations
WHEN EXISTS(SELECT 1 FROM order_payment_observations WHERE order_id=NEW.order_id AND recorded_at!=NEW.recorded_at)
BEGIN SELECT RAISE(ABORT,'First payment observation is immutable.'); END;
