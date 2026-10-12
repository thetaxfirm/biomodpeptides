# Administrator landing correction, October 12, 2026

Owner evidence: a signed-in approved administrator reached the personal account overview with My purchases after the dedicated /admin presentation release. The account route intentionally exposed personal records with management links, but the generic sign-in destination still led there. Author: Codex.

Approved administrators now redirect server-side from /account to /admin. Their storefront account icon points directly to /admin and is labelled Store administration. The Google callback selects /admin using the verified provider identity; ordinary customers retain /account/profile. Specific customer subpages remain owner-scoped. No administrator permissions, account records, order data, database bindings or passwords were changed. This does not establish which separate backend Chris may have been using.

Files: app/[...path]/page.tsx, app/auth/return/route.ts, components/store/header.tsx, tests/admin-landing-v1.cjs, scripts/release-check.mjs.

Fetched main before edits; clean base 593f646. Other checkouts and pending collaborator work preserved. TypeScript, all 35 isolated suites and the gated production build passed. New regression executes real page, header and OAuth callback with isolated identities: both owners, ordinary customer, lookalike email, explicit customer paths and failed authentication. No real sign-in, password reset email or order mutation was submitted.

Live verification follows publication. The available browser session is signed out, so real authenticated owner redirects remain a verification gap; isolated identities are not live logins.
