-- Affiliate onboarding: offer terms (code, customer discount, commission), the one-page
-- talking points, encrypted W-9 and ID records, signed offer packets, recorded payouts for
-- the 1099 report, in-person sale credits and the site contact list. No records are seeded.
ALTER TABLE affiliate_schedules ADD COLUMN code TEXT;
--> statement-breakpoint
ALTER TABLE affiliate_schedules ADD COLUMN discount_percent INTEGER CHECK(discount_percent IS NULL OR discount_percent BETWEEN 0 AND 90);
--> statement-breakpoint
ALTER TABLE affiliate_schedules ADD COLUMN channels TEXT NOT NULL DEFAULT 'online,in_person';
--> statement-breakpoint
ALTER TABLE affiliate_schedules ADD COLUMN talking_points_id TEXT;
--> statement-breakpoint
CREATE TABLE affiliate_documents (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('talking_points')), version TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 created INTEGER NOT NULL, actor TEXT NOT NULL, UNIQUE(kind,version)
);
--> statement-breakpoint
CREATE TRIGGER affiliate_documents_no_update BEFORE UPDATE ON affiliate_documents BEGIN SELECT RAISE(ABORT,'Publish a new document version.'); END;
--> statement-breakpoint
CREATE TRIGGER affiliate_documents_no_delete BEFORE DELETE ON affiliate_documents BEGIN SELECT RAISE(ABORT,'Document history is immutable.'); END;
--> statement-breakpoint
-- Full tax identifiers are AES-GCM ciphertext under the AFFILIATE_VAULT_KEY Worker secret.
CREATE TABLE affiliate_tax_profiles (
 owner TEXT PRIMARY KEY REFERENCES affiliate_members(owner), legal_name TEXT NOT NULL, business_name TEXT NOT NULL DEFAULT '',
 classification TEXT NOT NULL CHECK(classification IN ('individual','sole_proprietor','single_member_llc','llc_c','llc_s','llc_p','c_corp','s_corp','partnership','other')),
 tin_type TEXT NOT NULL CHECK(tin_type IN ('ssn','ein')), tin_cipher TEXT NOT NULL, tin_last4 TEXT NOT NULL CHECK(length(tin_last4)=4),
 address TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','verified','rejected')),
 review_note TEXT NOT NULL DEFAULT '', reviewer TEXT, reviewed INTEGER, created INTEGER NOT NULL, updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE affiliate_id_documents (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES affiliate_members(owner), side TEXT NOT NULL CHECK(side IN ('front','back')),
 mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')), bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, cipher TEXT NOT NULL,
 created INTEGER NOT NULL, archived INTEGER
);
--> statement-breakpoint
CREATE INDEX affiliate_id_documents_owner ON affiliate_id_documents(owner,created);
--> statement-breakpoint
-- A signed packet stores the exact text shown, its SHA-256, the drawn signature and the
-- signing context. It is the electronic signature record and cannot be changed.
CREATE TABLE affiliate_signatures (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES affiliate_members(owner), schedule_id TEXT NOT NULL UNIQUE REFERENCES affiliate_schedules(id),
 packet TEXT NOT NULL, packet_sha256 TEXT NOT NULL, typed_name TEXT NOT NULL, signature_png TEXT NOT NULL,
 consent TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', signed INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER affiliate_signatures_no_update BEFORE UPDATE ON affiliate_signatures BEGIN SELECT RAISE(ABORT,'Signatures are immutable.'); END;
--> statement-breakpoint
CREATE TRIGGER affiliate_signatures_no_delete BEFORE DELETE ON affiliate_signatures BEGIN SELECT RAISE(ABORT,'Signatures are immutable.'); END;
--> statement-breakpoint
-- Money is paid outside the store. These rows record what was paid, for statements and the 1099.
CREATE TABLE affiliate_payouts (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES affiliate_members(owner), amount_cents INTEGER NOT NULL CHECK(amount_cents<>0 AND amount_cents BETWEEN -100000000 AND 100000000),
 paid_on TEXT NOT NULL CHECK(paid_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'), method TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 actor TEXT NOT NULL, created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX affiliate_payouts_owner ON affiliate_payouts(owner,paid_on);
--> statement-breakpoint
CREATE TRIGGER affiliate_payouts_no_update BEFORE UPDATE ON affiliate_payouts BEGIN SELECT RAISE(ABORT,'Record a correcting entry instead.'); END;
--> statement-breakpoint
CREATE TRIGGER affiliate_payouts_no_delete BEFORE DELETE ON affiliate_payouts BEGIN SELECT RAISE(ABORT,'Record a correcting entry instead.'); END;
--> statement-breakpoint
-- In-person sales the partner's code brought in, credited by staff at the partner's rate.
CREATE TABLE affiliate_manual_sales (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES affiliate_members(owner), sold_on TEXT NOT NULL, basis_cents INTEGER NOT NULL CHECK(basis_cents BETWEEN 1 AND 100000000),
 commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000), code TEXT NOT NULL, note TEXT NOT NULL, actor TEXT NOT NULL, created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER affiliate_manual_sales_no_update BEFORE UPDATE ON affiliate_manual_sales BEGIN SELECT RAISE(ABORT,'Record a correcting entry instead.'); END;
--> statement-breakpoint
CREATE TABLE crm_contacts (
 email TEXT PRIMARY KEY COLLATE NOCASE, owner TEXT, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 sources TEXT NOT NULL DEFAULT '[]', first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX crm_contacts_last_seen ON crm_contacts(last_seen);
