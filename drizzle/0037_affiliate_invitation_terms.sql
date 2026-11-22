-- Invitation terms (owner, Nov 21 2026): when the owner invites a partner they set the name the
-- partner is agreeing to (LUPE10), what the partner's customers get and what the partner earns.
-- The terms wait on the invitation and become the partner's offer the moment they apply.
-- Additive only: invitations saved before this keep working with no terms. No records are seeded.
ALTER TABLE affiliate_invitations ADD COLUMN name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE affiliate_invitations ADD COLUMN code TEXT;
--> statement-breakpoint
ALTER TABLE affiliate_invitations ADD COLUMN discount_percent INTEGER CHECK(discount_percent IS NULL OR discount_percent BETWEEN 1 AND 90);
--> statement-breakpoint
ALTER TABLE affiliate_invitations ADD COLUMN commission_bps INTEGER CHECK(commission_bps IS NULL OR commission_bps BETWEEN 0 AND 10000);
--> statement-breakpoint
ALTER TABLE affiliate_invitations ADD COLUMN hold_days INTEGER CHECK(hold_days IS NULL OR hold_days BETWEEN 0 AND 365);
--> statement-breakpoint
ALTER TABLE affiliate_invitations ADD COLUMN payout_methods TEXT;
--> statement-breakpoint
ALTER TABLE affiliate_invitations ADD COLUMN channels TEXT;
--> statement-breakpoint
-- One code names one invitation, so two partners can never be promised the same one.
CREATE UNIQUE INDEX affiliate_invitations_code ON affiliate_invitations(code) WHERE code IS NOT NULL;
--> statement-breakpoint
-- Every invitation email the owner sends from administration, with what the mail provider said.
-- A row is claimed before the provider is called, so two clicks cannot send two emails.
CREATE TABLE affiliate_invitation_emails (
 id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE,
 status TEXT NOT NULL CHECK(status IN ('sending','accepted','failed','unknown')),
 provider_id TEXT, subject TEXT NOT NULL, actor TEXT NOT NULL, created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX affiliate_invitation_emails_email ON affiliate_invitation_emails(email,created);
