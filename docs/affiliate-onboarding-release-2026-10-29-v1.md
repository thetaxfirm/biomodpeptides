# Affiliate onboarding, 1099 and contacts

Owner request, October 29, 2026: a link affiliates use to sign in and enter their SSN, address and a driver's license photo, then electronically sign the offer; owner-controlled offer terms (a code such as DRMATT10 giving customers 10% off online and in person, paying the partner 20% of the sale); a one-page "what you can say" document; stored uploads; a 1099; and a running list of every visitor email and phone.

## Theirs (supplied Biomod CRM) vs ours

| | Supplied CRM (`biomod-crm-main`, Supabase) | TryBiomod before | TryBiomod now |
| --- | --- | --- | --- |
| Partner sign-up link | `/apply`, then `/portal` | Invite-only `/account/affiliate` | Same link, now with setup steps |
| W-9 | Partner uploads a W-9 file, types last 4 | Not collected | Partner enters W-9 fields in the form; SSN/EIN AES-256-GCM encrypted, staff see last 4; owner-only reveal is logged |
| W-8BEN (non-US) | Yes | No | No (US partners only) |
| ID / driver's license | No | No | Phone camera photo, resized in browser, encrypted, owner-only view logged |
| Signature | Click-accept with IP hash | Click-accept | Drawn signature + typed legal name + ESIGN consent + W-9 perjury certification; packet SHA-256, IP, device, time; printable signed packet with integrity check |
| Offer terms | Rates per affiliate | Commission per partner; promo code created separately | One owner form: code, customer %, commission %, hold, payout method, online/in-person; code is created/repriced automatically |
| "What you can say" page | Content review queue | Short partner guide | Versioned one-page talking points with the partner's code and percent filled in; signed with the offer |
| In-person sales | No | No | Staff credit an in-person sale at the partner's signed rate |
| Payouts | Batches, processor records | Eligibility report only | Payout records (append-only, correcting entries) gated on a verified W-9 |
| 1099 | Year report + accountant CSV, $600 through 2025 / $2,000 from 2026 | None | Same thresholds; corporations flagged exempt; owner-only CSV with full TIN, logged |
| Contacts/CRM | Customers module | None | Contacts tab + CSV: accounts (captured at sign-up/sign-in), orders, contact forms, stock alerts, COA requests, affiliates, merged by email |

The DocuSeal/OpenSign/Documenso route was considered. Each needs its own server and database, and the SSN would then live in a second system. The built-in signature keeps one encrypted store and the same evidence those tools record (consent, signature image, timestamp, IP, device, document hash).

## Storage and access

Migration `0033_affiliate_onboarding.sql` is additive. Full tax numbers and license photos are ciphertext under the Worker secret `AFFILIATE_VAULT_KEY` (base64, 32 bytes). Without it, nothing sensitive is accepted. Losing the key makes stored numbers and photos unreadable, so it is also kept in the owner's macOS login keychain as "TryBiomod AFFILIATE_VAULT_KEY". Signatures, documents and payouts are immutable by trigger. Owner-only: offers, talking points, payouts, full TIN, license photos, 1099 CSV. Owners and managers: W-9 review, in-person credits. Contacts: report readers.

## Verification

- `npm run check:release`: TypeScript and 109 isolated suites, including `tests/affiliate-onboarding-v1.cjs`.
- Built Worker with local D1 (`tests/affiliate-onboarding-worker-v1.mjs`): full flow through approval, referral cookie, audited reveals, payout, 1099 CSV and contacts; no external calls.
- Isolated browser preview with synthetic data: W-9 form, phone-photo upload (3000px image resized to ~350 KB), drawn signature, signed packet, owner reveal/verify, Contacts tab; 375px width has no horizontal scroll.
- No real partner, SSN, license, order, email or payment was used.

Owner steps after deploy: publish the talking points (Admin, Affiliates), authorize the partner's email, send them https://trybiomod.com/account/affiliate, then Save offer for that partner. Have counsel/accountant confirm the talking points and 1099 threshold.

## Live record

- Source commit 204166f on main (author Ash Taha via Claude), pushed 2026-10-29 ~08:07 UTC; Cloudflare Worker `biomod-peptides` version e6593f2b-12c6-4d10-9291-4e7206b62828 at 08:09:35 UTC.
- `AFFILIATE_VAULT_KEY` secret set before the push (value not recorded; backup in the owner's keychain).
- Production D1 has all seven new tables. Read-only live checks: `/`, `/shop`, `/account/affiliate` 200; new onboarding, vault and contacts endpoints refuse signed-out and cross-origin requests.
- Change-history import run with `--remote`.
- Gap: no authenticated live check of the owner screens or a real partner submission; first real use is the owner's own walkthrough.
