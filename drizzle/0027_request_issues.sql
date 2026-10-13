-- What each customer case was about and how it was resolved, so reply rules (SOPs) can be built per issue.
CREATE TABLE IF NOT EXISTS request_issues (
 request_id TEXT PRIMARY KEY NOT NULL,
 issue TEXT NOT NULL,
 resolutions TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(resolutions)),
 note TEXT NOT NULL DEFAULT '',
 updated INTEGER NOT NULL,
 updated_by TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_issues_issue ON request_issues(issue,updated);
--> statement-breakpoint
ALTER TABLE request_reply_style ADD COLUMN issue TEXT;
