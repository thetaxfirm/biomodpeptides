# Customer email voice release, 2026-10-24 (v1)

Owner request (Oct 24 2026): customer emails read badly. Rules: never embarrass the customer, no
research-use line in the body (the signature footer carries it), routine emails are not signed with
Ash's name, VIPs (partners, business buyers, people met at shows) get a personal founder reply.

## Shipped
- Commit `586348c` on main, Cloudflare "Workers Builds: biomod-peptides" completed successfully.
- `lib/customer-context.ts`: AI reply jobs carry the customer's last 5 orders (staff wording, never
  "declined") and a VIP signal (company email domain, partnership/wholesale/expo words).
- Requests list shows a star with the VIP reason.
- `lib/win-back.ts`: templates no longer say "didn't go through"; only the founder note is signed Ash.
- `lib/checkout-recovery.ts`: automatic reminder rewritten ("Your order is still saved, and we added
  an extra 7.5% off…"), signed "BioMod", research-use notice kept in the footer.
- Jarvis (separate repo) uses the new `customer` field and the new voice rules in its writer.

## Evidence
- `npm run check:release`: TypeScript and 102 isolated suites passed, incl. new `tests/email-voice-v1.cjs`.
- `BIOMOD_DEPLOY=true npm run build` passed.
- Live: `experience-DhOOlvRK.js` contains the VIP marker strings.

## Gaps
- Authenticated admin view not opened (no staff login); star verified in the live bundle only.
- Tracking and COA-link templates were already short and were left unchanged.
