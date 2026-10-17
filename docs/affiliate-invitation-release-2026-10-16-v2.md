# Private affiliate enrollment

Owner directed publishing the agreement and opening applications only for recipients the business invites. Owner confirmed BM Trade LLC as the contracting entity. Version 2026-10-16.2 names that company and states invitation-only access. The previously proposed company name was not published.

Removed the public footer and general account-navigation affiliate links. The private `/account/affiliate` URL requires a verified signed-in account. The API returns no agreement to a nonmember without an active invitation for that account's email. Application inserts repeat the invitation gate in SQL. Forwarding the URL does not confer access. Existing members retain their private records; staff suspend membership separately from revoking an unused invitation.

Owners authorize/revoke invitation emails in `/admin?tab=affiliates`, then manually send the private URL. No email was sent or new recipient invited by this release. Agreement text is delivered through protected API reads, not embedded in public JavaScript. Commission, hold and payment method remain individual accepted schedules; the $500 minimum and 30-day payment cycle remain unchanged. Contract contact uses the working designated address ash@ashtahamd.com while TryBioMod mailbox recovery remains unresolved.

Verification: production build with TypeScript and 90 isolated suites; compiled Worker/local D1 workflow; client-bundle agreement-text absence; isolated browser clicks for invitation authorization and revocation. Live activation and deployment identity recorded separately after deployment. No customer orders, payments, tax forms or emails created in testing.
