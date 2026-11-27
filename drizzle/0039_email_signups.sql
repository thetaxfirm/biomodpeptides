-- Email sign-ups (owner request, Nov 27 2026): a visitor who is not signed in leaves their email to hear
-- about private sales and discounts, and gets a 10% code. One row per address. The exact consent
-- wording is stored with each row. Unsubscribing keeps the row and sets unsubscribed_at, so the
-- address is never mailed again and the history stays readable.
CREATE TABLE IF NOT EXISTS email_signups (
 email TEXT PRIMARY KEY NOT NULL CHECK(email = lower(trim(email)) AND length(email) BETWEEN 6 AND 254),
 source_path TEXT NOT NULL DEFAULT '/',
 consent_version TEXT NOT NULL,
 consent_text TEXT NOT NULL,
 unsubscribe_token TEXT NOT NULL UNIQUE CHECK(length(unsubscribe_token) = 36),
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL,
 unsubscribed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_signups_created ON email_signups(created);
