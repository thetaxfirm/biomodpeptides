# Guest checkout: release v1

November 14, 2026 (deployed November 15 UTC). Author: Claude. Owner direction: build a guest checkout that enrols the buyer automatically, with a research-professional statement.

## Why

Checkout required membership first: seven fields, a business type and email verification before sign-in. Aggregate funnel events for the 28 days to November 14: cart add 140, cart view 67, sign-in wall 42, checkout form 15, payment handoff 6.

## What changed (commit 7ad7472)

- `/checkout` no longer forces sign-in. A signed-out buyer sees one step: email plus the research statement. The statement (`lib/guest-checkout.ts`, version `research-professional-v1`) says the buyer is a research professional or buying for a research organization, is 21 or older, and that the products are for laboratory research use only, not for human or animal use, and will not be used or resold for that purpose. Counsel has not reviewed the wording.
- The guest is bound to the browser session (`guest:<session id>`), stored in `requests` as kind `guest_shopper`. No table was added and no migration runs.
- Each guest order records the exact statement text, version and the time it was agreed.
- Guests may use only: delivery quote, checkout, resume, payment page, payment status and their own order list. Profile, addresses, stock alerts, cart-conflict choice and all admin routes stay members-only. Presale items need a member account because presale limits are counted per member.
- After a guest's first paid order, the sign-in provider sends its usual verification email (random password, never shown; the buyer sets one with "Forgot password?"). When someone signs in with a verified email, guest orders placed with that email move to the account. An unpaid guest order stays put if the account already has an unpaid checkout.
- The delivery phone number joins the guest's contact record. A text-update opt-in is built and stored with its consent wording, but hidden (`SMS_UPDATES_READY = false`) until a text provider is connected.

## Checks

- `npm run check:release`: TypeScript and 131 suites passed. New: `guest-checkout-v1`. Fixtures updated for the guest lookup: shipping-settings-route-v1, hosted-payment-error-v1 (signed-out visitors are checked for a guest session, then stopped), and four UI loaders.
- `BIOMOD_DEPLOY=true npm run build`: passed.

## Live verification

- The deployed checkout bundle contains the guest form; `/checkout` signed out with an item in the cart shows the email and statement step.
- `/api/store/state` returns `guest: null` for a new visitor.
- `guest-start` refuses a bad or missing email with HTTP 400; `delivery` and `reconcile` without a member or guest return "Please sign in or continue as a guest."
- **Not verified live:** a complete guest order. No test email, order or payment was created on production. The first real guest order should be watched: order placed, payment confirmed, verification email received, order visible after sign-in.
