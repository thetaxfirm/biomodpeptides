# Explicit administrator sign-in route, October 12, 2026

Owner requested a specific sign-in page followed by the backend. Author: Codex. Base: 1446630, fetched main and clean working tree before editing. Existing collaborator work in other checkouts remains untouched.

Canonical sign-in: https://trybiomod.com/admin/login. Dashboard: https://trybiomod.com/admin. Signed-out dashboard visits redirect to the specific sign-in route, preserving the requested dashboard tab. Signed-in approved administrators visiting the sign-in route go straight to their safe admin destination. Non-admin identities gain no privileges. Admin password-recovery back links now use the dedicated sign-in path. Both routes use the admin header and noindex policy. Public customer login and personal records remain separate.

Affected: app/[...path]/page.tsx, components/store/experience.tsx, components/store/store-chrome.tsx, components/store/account.tsx, lib/auth-return.ts, lib/seo-policy.ts, and their auth/landing regression tests. No runtime settings, passwords, catalog, orders or database changes.

Validation: TypeScript, all 35 isolated release suites and gated production build passed. Additional route assertions cover preserving a selected admin tab and rejecting external/customer/sign-in-loop destinations. No live login or recovery request submitted. Live deployment verification follows; authenticated owner completion still requires the user's signed-in browser.
