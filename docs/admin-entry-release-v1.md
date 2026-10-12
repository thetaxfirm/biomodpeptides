# Dedicated TryBiomod admin entry, October 12, 2026

Owner request: a specific administration page, separate from customer sign-in. Author: Codex.

The canonical entry remains https://trybiomod.com/admin. It now has its own compact header, administrator sign-in wording, shared-store explanation, password recovery and browser title. Customer registration and Google customer-login links are omitted on admin-directed sign-in. Ordinary customer login remains available. The authenticated dashboard identifies the store and signed-in account. No auth permissions, storage, inventory, orders, payment settings or provider configuration changed.

Affected source: app/layout.tsx, components/store/store-chrome.tsx and its CSS module, components/store/account.tsx, components/store/admin.tsx, lib/seo-policy.ts, tests/account-load-recovery-v1.cjs.

Shared main was fetched and matched b080199 before editing and again before release. The existing dirty SEO checkout and collaborator drafts were not edited. Production metadata confirmed both approved owner addresses in the shared admin allowlist before release. Source admin reads are store-wide rather than customer-owned reads. Neither owner's authenticated view has been freshly verified.

Validation: TypeScript and all 34 isolated release suites passed, including updated real AuthPage assertions for admin-only wording, no registration link, safe recovery return and unchanged customer destinations. The gated production build completed. /admin retains private noindex policy and does not enter the sitemap. No real login, recovery email, order or payment was submitted. Live UI/deployment verification follows publication; authenticated comparison with Chris remains pending his exact admin URL and authorized sign-in.
