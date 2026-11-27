# Email sign-up panel release v1 (November 27, 2026)

Author: Claude. Owner request: visitors who are about to leave and have not registered are asked for an email to hear about private sales and discounts. The owner approved the plan in chat and chose a 10% code and a 40-second trigger on phones.

## What visitors see

- Pointer screens: a compact centered panel when the cursor leaves through the top of the window, armed after 4 seconds on the page. Phones and tablets: a sheet along the bottom edge after 40 seconds of browsing in the visit.
- Only for visitors who are not signed in, not a checkout guest and not staff. Never on cart, checkout, payment, account, sign-in, affiliate, verify or admin pages.
- At most once per visit. Closing it keeps it away for 30 days in that browser; signing up keeps it away for a year.
- Copy: "10% off your first order / Plus first word on private sales and restocks." The code INSIDER10 (10%) is shown and applied to the cart unless another code is already applied. The owner can end the offer by switching INSIDER10 off in Promo codes.

## Where the data lives

- Production D1 `biomod-peptides`, new table `email_signups` (migration 0039): email, sign-up time, page path, consent version and exact wording, unsubscribe token, unsubscribed time.
- Admin → Contacts → "Email sign-ups" with a CSV download (`/api/admin/contacts?format=email-csv`, staff with reports access only).
- One-click unsubscribe page `/api/email-offer/unsubscribe?token=…`. Opening it changes nothing; the button does. The row is kept and marked, so the address is never mailed again.
- The browser stores only the "closed or finished" note (localStorage `bm-email-offer-quiet`) and per-visit timers (sessionStorage).
- Privacy policy has a new paragraph describing this (updated November 27, 2026).
- Nothing sends email. Campaigns need the owner's approval for each send and must include the unsubscribe link.

## Verification

- `tests/email-offer-v1.cjs` (added to the release gate): address checks, consent record, bot trap, re-sign-up, unsubscribe, off switch, staff list, blocked pages and wiring. `npm run check:release` passed with 143 suites. Focused ESLint and tsc passed.
- Local production build on a placeholder D1 (reserved example.com address): the desktop exit trigger, an empty-field error, a successful sign-up (row saved with /shop and email-offer-v1; code applied), staying closed after close, the phone bottom sheet on a product page, and no panel on /cart.
- Live verification follows below.

## Live result

- Commit f59b6e3; the "Website consistency" GitHub check passed; the Worker deployed at 2026-11-27T07:07Z.
- Production D1 `email_signups` exists with 0 rows (read-only count). `/api/email-offer/unsubscribe` serves the branded page (HTTP 400 for an invalid token, as designed).
- On https://trybiomod.com/shop, signed out, the desktop exit trigger opened the panel, which matches the local render. No live sign-up was submitted, so the production list holds no test data.
