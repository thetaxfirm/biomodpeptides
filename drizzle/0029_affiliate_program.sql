-- No demo agreements, rates, accounts, tax documents or balances.
--> statement-breakpoint
CREATE TABLE affiliate_agreements (
 id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, title TEXT NOT NULL, body TEXT NOT NULL,
 commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
 hold_days INTEGER NOT NULL CHECK(hold_days BETWEEN 0 AND 365),
 minimum_payout_cents INTEGER NOT NULL CHECK(minimum_payout_cents >= 0),
 company TEXT NOT NULL, contact TEXT NOT NULL, payout_schedule TEXT NOT NULL, payout_methods TEXT NOT NULL,
 created INTEGER NOT NULL, actor TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER affiliate_agreements_immutable_update BEFORE UPDATE ON affiliate_agreements BEGIN SELECT RAISE(ABORT,'Publish a new agreement version.'); END;
--> statement-breakpoint
CREATE TRIGGER affiliate_agreements_immutable_delete BEFORE DELETE ON affiliate_agreements BEGIN SELECT RAISE(ABORT,'Agreement history must be retained.'); END;
--> statement-breakpoint
CREATE TABLE affiliate_members (
 owner TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, website TEXT NOT NULL, audience TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','suspended')),
 code TEXT UNIQUE, agreement_id TEXT NOT NULL REFERENCES affiliate_agreements(id),
 accepted INTEGER NOT NULL, reviewed INTEGER, reviewer TEXT, review_note TEXT NOT NULL DEFAULT '',
 created INTEGER NOT NULL, updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE affiliate_acceptances (
 owner TEXT NOT NULL, agreement_id TEXT NOT NULL REFERENCES affiliate_agreements(id), accepted INTEGER NOT NULL,
 PRIMARY KEY(owner,agreement_id)
);
--> statement-breakpoint
CREATE TABLE affiliate_events (
 id TEXT PRIMARY KEY, owner TEXT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX affiliate_events_owner ON affiliate_events(owner,created);
--> statement-breakpoint
CREATE TABLE affiliate_program_state (
 id INTEGER PRIMARY KEY CHECK(id=1), agreement_id TEXT REFERENCES affiliate_agreements(id), open INTEGER NOT NULL DEFAULT 0 CHECK(open IN (0,1))
);
--> statement-breakpoint
INSERT INTO affiliate_program_state(id,open) VALUES(1,0);
--> statement-breakpoint
CREATE TABLE affiliate_schedules (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES affiliate_members(owner), agreement_id TEXT NOT NULL REFERENCES affiliate_agreements(id),
 commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000), hold_days INTEGER NOT NULL CHECK(hold_days BETWEEN 0 AND 365),
 payout_methods TEXT NOT NULL, created INTEGER NOT NULL, actor TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE affiliate_schedule_state (owner TEXT PRIMARY KEY REFERENCES affiliate_members(owner), schedule_id TEXT NOT NULL REFERENCES affiliate_schedules(id));
--> statement-breakpoint
CREATE TABLE affiliate_schedule_acceptances (schedule_id TEXT PRIMARY KEY REFERENCES affiliate_schedules(id), owner TEXT NOT NULL, accepted INTEGER NOT NULL);
--> statement-breakpoint
CREATE TRIGGER affiliate_schedules_no_update BEFORE UPDATE ON affiliate_schedules BEGIN SELECT RAISE(ABORT,'Publish a new schedule.'); END;
--> statement-breakpoint
CREATE TRIGGER affiliate_schedules_no_delete BEFORE DELETE ON affiliate_schedules BEGIN SELECT RAISE(ABORT,'Schedule history is immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER affiliate_schedule_acceptances_no_update BEFORE UPDATE ON affiliate_schedule_acceptances BEGIN SELECT RAISE(ABORT,'Acceptance is immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER affiliate_schedule_acceptances_no_delete BEFORE DELETE ON affiliate_schedule_acceptances BEGIN SELECT RAISE(ABORT,'Acceptance is immutable.'); END;
-- Capture affiliate ownership and terms once, as the store creates an order.
-- Code assignment changes never reattribute historical orders.
--> statement-breakpoint
CREATE TABLE affiliate_order_terms (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), owner TEXT NOT NULL REFERENCES affiliate_members(owner),
 agreement_id TEXT NOT NULL REFERENCES affiliate_agreements(id), schedule_id TEXT NOT NULL REFERENCES affiliate_schedules(id), code TEXT NOT NULL,
 commission_bps INTEGER NOT NULL, hold_days INTEGER NOT NULL, basis_cents INTEGER NOT NULL,
 created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER affiliate_capture_order AFTER INSERT ON orders
WHEN json_valid(NEW.data)
BEGIN
 INSERT INTO affiliate_order_terms(order_id,owner,agreement_id,schedule_id,code,commission_bps,hold_days,basis_cents,created)
 SELECT NEW.id,m.owner,a.id,f.id,m.code,f.commission_bps,f.hold_days,
 CAST(json_extract(NEW.data,'$.subtotal') AS INTEGER)-CAST(json_extract(NEW.data,'$.discount') AS INTEGER),NEW.created
 FROM affiliate_members m JOIN affiliate_program_state s ON s.id=1 AND s.agreement_id=m.agreement_id
 JOIN affiliate_agreements a ON a.id=m.agreement_id
 JOIN affiliate_schedule_state ss ON ss.owner=m.owner
 JOIN affiliate_schedules f ON f.id=ss.schedule_id AND f.agreement_id=a.id
 JOIN affiliate_schedule_acceptances fa ON fa.schedule_id=f.id AND fa.owner=m.owner
 WHERE m.status='approved' AND m.code=json_extract(NEW.data,'$.promo.code')
 AND m.owner<>NEW.owner AND lower(trim(m.email))<>lower(trim(COALESCE(json_extract(NEW.data,'$.email'),'')))
 AND json_type(NEW.data,'$.subtotal')='integer' AND json_type(NEW.data,'$.discount')='integer'
 AND json_extract(NEW.data,'$.subtotal')>=json_extract(NEW.data,'$.discount')
 AND json_extract(NEW.data,'$.discount')>=0
 AND json_extract(NEW.data,'$.subtotal')<=100000000
 AND COALESCE(json_extract(NEW.data,'$.internalTest'),0)=0
 AND json_extract(NEW.data,'$.environment') IN ('live','authorizenet:live');
END;

--> statement-breakpoint
CREATE TRIGGER affiliate_acceptances_no_update BEFORE UPDATE ON affiliate_acceptances BEGIN SELECT RAISE(ABORT,'Affiliate history is immutable.'); END;

--> statement-breakpoint
CREATE TRIGGER affiliate_acceptances_no_delete BEFORE DELETE ON affiliate_acceptances BEGIN SELECT RAISE(ABORT,'Affiliate history is immutable.'); END;

--> statement-breakpoint
CREATE TRIGGER affiliate_events_no_update BEFORE UPDATE ON affiliate_events BEGIN SELECT RAISE(ABORT,'Affiliate history is immutable.'); END;

--> statement-breakpoint
CREATE TRIGGER affiliate_events_no_delete BEFORE DELETE ON affiliate_events BEGIN SELECT RAISE(ABORT,'Affiliate history is immutable.'); END;

--> statement-breakpoint
CREATE TRIGGER affiliate_order_terms_no_update BEFORE UPDATE ON affiliate_order_terms BEGIN SELECT RAISE(ABORT,'Affiliate history is immutable.'); END;

--> statement-breakpoint
CREATE TRIGGER affiliate_order_terms_no_delete BEFORE DELETE ON affiliate_order_terms BEGIN SELECT RAISE(ABORT,'Affiliate history is immutable.'); END;
--> statement-breakpoint
CREATE TABLE affiliate_payment_observations(order_id TEXT PRIMARY KEY REFERENCES affiliate_order_terms(order_id), recorded_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TRIGGER affiliate_payment_on_insert AFTER INSERT ON affiliate_order_terms BEGIN
 INSERT OR IGNORE INTO affiliate_payment_observations(order_id,recorded_at)
 SELECT id,updated FROM orders WHERE id=NEW.order_id AND status IN ('paid','labeling','shipped','delivered')
 AND NULLIF(TRIM(payment_ref),'') IS NOT NULL AND NULLIF(TRIM(notification_id),'') IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER affiliate_payment_on_update AFTER UPDATE ON orders BEGIN
 INSERT OR IGNORE INTO affiliate_payment_observations(order_id,recorded_at)
 SELECT NEW.id,NEW.updated FROM affiliate_order_terms WHERE order_id=NEW.id AND NEW.status IN ('paid','labeling','shipped','delivered')
 AND NULLIF(TRIM(NEW.payment_ref),'') IS NOT NULL AND NULLIF(TRIM(NEW.notification_id),'') IS NOT NULL;
END;
--> statement-breakpoint
CREATE TABLE affiliate_commission_reviews (
 order_id TEXT PRIMARY KEY REFERENCES affiliate_order_terms(order_id), state TEXT NOT NULL CHECK(state IN ('held','excluded','released')),
 net_cents INTEGER NOT NULL CHECK(net_cents>=0), reason TEXT NOT NULL, actor TEXT NOT NULL, updated INTEGER NOT NULL
);
