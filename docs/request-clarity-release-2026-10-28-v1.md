# Clearer customer requests and replies: October 28, 2026

Operator: Codex. Scope: trybiomod.com protected `/admin?tab=requests` reply desk. Starting source: `410e74aea1c1c7e853542d376160b0f703a60c9d`, clean and equal to fetched shared main before editing.

The COA request form collects an email address and vial lot. Its server-generated review note was displayed as though the customer had written it. The reply desk now labels this as a website form request, shows the product page and exact lot entered, and explicitly says no written message was included. Actual incoming messages remain unchanged. The original stored record remains under collapsed internal details.

The latest request appears immediately above an editable reply box. One status line replaces the repeated waiting summaries. “Ask for a label photo” fills a short draft locally; it does not save, prepare, or send an email. Replacing an existing draft can be undone. AI help, report attachments, earlier correspondence, internal case notes and extra actions remain accessible behind separate disclosures. Phone layout gives the recipient a full-width row.

Affected source: `components/store/request-inbox.tsx`, `components/store/request-inbox.module.css`, `tests/request-desk-v1.cjs`, and the existing `tests/reply-simple-v1.cjs` expectation for collapsed COA tools. No database migration, settings change or historic-record rewrite. Exact report/lot validation, role permissions, owner approval, conflict checks, existing draft persistence and provider behavior are preserved. The stopped change-history importer was not run.

Verification: focused request-desk regressions and TypeScript passed. Browser interactions used the actual component and isolated fictional records with no email connection: blank Send disabled, photo draft insertion, Undo restoring prior text, attachment disclosure, and 390px phone layout without horizontal overflow. Customer-origin text and later inbound email are covered separately from form-generated context. Full release gate, production build, exact source/check/deployment mapping and read-only production checks are recorded in the release verification receipt. No live form, customer reply, report email, or provider delivery test was performed.

Protected live interaction requires an authenticated session. A sign-in page does not count as a verified authenticated reply screen; any remaining authentication gap stays explicit in the receipt.
