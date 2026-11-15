# Text sign-up offer: release v1

November 14, 2026 (deployed November 15 UTC). Author: Claude. Owner direction: a visitor enters a number, presses a button, gets 10% off, and the store keeps the number. Automatic. No email asked.

## What changed (commit d0c8a3a)

- Cart page, Order Summary: "Get 10% off by text" with one mobile-number field and a "Get my code" button. The consent wording sits under the button and is saved with each sign-up (`lib/text-offer-wording.ts`, version `text-offer-v1`). Counsel has not reviewed the wording.
- The offer creates promo code `TEXT10` (10%) in Promo codes on the first sign-up. Switching that code off in Admin > Promo codes ends the offer.
- No text provider is connected yet, so the code is shown on screen and applied to the order (unless another code is already applied). The number is saved either way.
- When `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` are set as Worker secrets, the code is sent only by text, at most one text per number per day, and the response never contains the code.
- Sign-ups are stored in `requests` as kind `text_offer`, one row per number. No table was added and no migration runs.
- Admin > Contacts has a "Text sign-ups" list with a CSV download (`/api/admin/contacts?format=text-csv`).
- Limit: five tries per visitor per ten minutes, on top of the store-wide limit.
- `scripts/release-check.mjs` now prints the exit status and error code when a suite stops.

## Checks

- `npm run check:release`: TypeScript and 132 suites passed. New: `text-offer-v1`. Seven UI loaders stub the new component. Three earlier runs each stopped on a different unchanged suite directly after it printed PASS while the machine load average was above 25; each of those suites passed 5 of 5 times alone, and the next full run passed.
- `BIOMOD_DEPLOY=true npm run build`: passed.

## Live verification

- `POST /api/store/text-offer` with a short number returns HTTP 400 "Enter a 10-digit U.S. mobile number."
- `/cart` with one item shows the form and the consent wording in Order Summary.
- **Not verified live:** a completed sign-up. No number was submitted on production, so `TEXT10` does not exist until the first real sign-up.

## Known limit

Until a text provider is connected a number cannot be confirmed as real: any well-formed U.S. number shows the code.
