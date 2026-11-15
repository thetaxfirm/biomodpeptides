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

## Same day, second release: one page (commit f629d42)

Owner feedback: guest checkout looked unusual for this market, and a customer had called the checkout a bad experience.

Competitor check, November 14 (cart and checkout pages viewed in a browser; no order placed):

- realpeptides.co allows guest checkout on one page: delivery address, email, business phone, a required "Business type / industry" choice and a 21+ confirmation, then delivery and payment.
- peptideplugs.com shows no products until the visitor completes a short form: first name, business name, research category, email (confirmed with a 4-digit code) and a research-use checkbox. No password.

Both qualify the buyer as a research customer; neither asks for a password before the first order.

What changed:

- The separate guest step is gone. Signed-out buyers get one checkout page: email, type of research organization (the same five choices as the membership form), delivery address and phone, the research statement as the only agreement box, then Calculate and pay. Members see the page as before.
- The organization type is saved with the statement on each guest order.
- State is a dropdown (50 states, DC and the three military codes) instead of a typed two-letter code.
- The guest is saved when Calculate is pressed, so nothing typed is reset. `guest-start` now requires the organization type.
- Funnel stages (form view, quote, handoff) count guests as well as members. `checkout_signin_view` is no longer emitted from checkout.

Checks: `npm run check:release` (TypeScript, 131 suites; checkout-owner-recovery-v1 and shopping-measurement-client-v1 updated for the signed-out guest form) and the production build passed. Live: `/checkout` signed out with one item in the cart shows the single page with all fields; no order, email or payment was created.
