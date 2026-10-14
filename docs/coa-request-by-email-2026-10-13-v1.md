# COA "Request by email", October 13, 2026

Scope: trybiomod.com. Author: Claude, at the owner's request: "can we say request by email, and they put email and we send link to site with COA instantly?" and "let's say they want to buy reta, they can just put email and then COA will be emailed to them."

This intentionally reverses, for this one path only, the October 12 rule (c00dba3) that every customer COA reply waits for owner review in Jarvis. Other customer replies still go through the reply desk.

## Behavior

Products whose COA is "available on request" (today HEAT-R 20mg, HEAT-R 30mg, HEAT-T, C-HEAT, C-HEAT-S) show "Request by email" with an email field in place of the contact-form link. Submitting sends the customer, immediately, an email with a private link to the original COA for the product's current lot. No attachment, no compound name.

Safeguards: only the original report the store already matches to the product's current lot (`exactCoaReport` rules) can be linked; products without one send nothing. The link is `/api/coa-file/<id>.<secret>`; only a SHA-256 of the secret is stored, it expires after 30 days, works only if the email was accepted by the mail provider, and the PDF hash is re-verified on every open (noindex, no-store). Rate limits: 8 per IP and 4 per email address per 10 minutes. Each request is recorded in `requests` as kind `coa_link` (email, product, lot, report, open count) for staff review in D1.

## Verification

Gate: TypeScript and 72 suites. Production build passed. New built-Worker test `coa-link-worker-v1.mjs` with synthetic non-laboratory PDFs and an intercepted mail provider: instant email and link, served bytes equal the original's hash, tampered/unknown/expired/unsent links refused, no-COA product sends nothing, validation, origin guard, provider failure, per-email rate limit.

Affected: product and testing pages with on-request COAs; `/api/coa-link`, `/api/coa-file/[token]`. No migration.
