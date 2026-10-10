# Separate administrator password setup

Date: 2026-10-10
Author: Codex
Base commit: edf31bf
Scope: TryBiomod only.

## Owner request
Preserve Chris and add ash@biomodcompounds.com as a separate administrator, with owner-controlled password setup.

## Configuration
Production STORE_ADMIN_EMAILS now includes chris@biomodcompounds.com and ash@biomodcompounds.com. Existing password records were not changed. ORDER_NOTIFY_EMAILS explicitly retains the prior Chris recipient so adding an administrator does not expand order email distribution. Readback verified both values and all 23 other existing bindings unchanged. No credentials are recorded here. Deployment keeps runtime variables.

## Implementation
The existing recovery route sends a possession-verifying setup link for an exact allowlisted administrator address and may create that provider account. Other customer addresses use normal recovery. The response is generic; no password or authenticated session is supplied by the request. Admin access still requires a verified provider identity. The admin sign-in page links to Set or reset your admin password. Password entry and submission remain the account owner's action.

Affected files: lib/auth.ts; app/api/store/[action]/route.ts; components/store/account.tsx; tests/admin-password-setup-v1.cjs.
Affected URLs: /admin; /forgot-password?returnTo=%2Fadmin; /reset-password; /api/store/auth-recover.

## Validation
Passed isolated admin setup and authorization tests, auth-return tests, promo analytics tests, order receipt tests, TypeScript check, production build and whitespace checks. Existing origin and rate-limit safeguards remain in place. No test ordered a product, contacted the live auth provider or sent customer email.

## Release boundary
Production deployment and one owner-requested setup email are verified after main sync. Mailbox delivery, the provider's email link and successful password creation require the owner to complete setup. A generic accepted email request is not proof of delivery or completed account setup.
