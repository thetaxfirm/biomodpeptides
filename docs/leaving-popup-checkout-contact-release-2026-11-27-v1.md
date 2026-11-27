# Leaving pop-up v2 and checkout contact step: release v1 (November 27, 2026)

Author: Claude. Owner direction, November 27, 2026: the pop-up must appear when a visitor is leaving, not when they add to cart; ask for an email for deals and secret sales; give no 10% at sign-up; and collect a guest's email and mobile number at the start of checkout, carried forward, without slowing the purchase. The owner reviewed three preview pictures and the written plan before any change, approved "build all of it", chose to keep INSIDER10 working for the visitors already shown it, and asked for the text-permission box to be added.

This follows docs/email-offer-release-2026-11-27-v1.md (the first pop-up, released earlier the same day).

## Why the first pop-up opened at "Add to cart"

On touch screens it opened 40 seconds into a visit whatever the visitor was doing. Reproduced on a local copy: it opened seconds after pressing Add to cart. On pointer screens, adding to cart did not open it, but a cursor crossing the top edge on the way to the cart icon would.

## Leaving pop-up

- Wording: "Get our secret sales. Private deals and restock alerts by email, before anyone else sees them." Button "Sign me up". After sign-up: "You're on the list. Watch your inbox for secret sales and private deals."
- No discount code: a sign-up creates, returns and applies nothing. INSIDER10 stays an ordinary stored promo and still works for anyone who has it; the owner can switch it off in Promo codes without affecting sign-ups.
- Pointer screens: the cursor leaves through the top of the window and stays out for 350ms. Coming back sooner cancels it.
- Touch screens, empty cart only: a fast flick back up (30% of the screen, 240px minimum, within 350ms) on a page read at least a screen and a half down, or returning after 3 seconds or more in another app or tab. The 40-second timer is removed. The back button is never intercepted (Google search spam policy since June 15, 2026).
- Never within 30 seconds of a cart change (kept across page loads), while typing, while a dialog, menu or picker is open, on cart/checkout/payment/account/sign-in/admin pages, for signed-in members, checkout guests, anyone who has already given an email, or staff.
- Unchanged: once per visit; closed means away for 30 days in that browser; consent wording; unsubscribe page.
- An email given in the pop-up is remembered for the browser session so checkout starts with it filled in.

## Checkout contact step (guests)

- First screen: Email address, Mobile number, "Email me private sales and deals" (starts ticked), "Text me deals too" (starts unticked, with the consent wording), Continue to delivery. Nothing new is asked: the phone box moved up from the bottom of the address.
- Saved on Continue, before the address, the research statement or any order exists. The page does not reload; the address opens underneath with the cursor in Full name.
- The contact folds to one line with a Change link. Change keeps the address form mounted. A changed number drops a delivery quote priced for the old one.
- The number carries into the delivery address as a hidden field, so the order, label and tracking email receive it as before. Type of research organization and the research statement now sit with the address. The guest record is still saved before the first quote, exactly as before.
- Returning on the same device (session cookie, up to 30 days) shows the saved contact.
- Signed-in members are unchanged: no contact step, phone box in the address.
- Unticked boxes in the checkout column get a visible edge. The store-wide unticked box is a pale 1px outline (#dedede on white), which is easy to miss for boxes a buyer has to find.

## Where the data lives

- Production D1 `biomod-peptides`, table `requests`, kind `checkout_contact`, owner `guest:<session id>`: email, number, each permission with its time, version and exact wording, first and last save time. No new table and no migration. The request inbox does not read this kind.
- Sale emails: a ticked box inserts into `email_signups` (source `/checkout`, version `checkout-email-v1`). An address already there, subscribed or unsubscribed, is left untouched, so the pre-ticked box can never re-subscribe someone.
- The main Contacts list and the shared CRM receive the email and number through the existing contact capture (source `order`, as guest checkout already used).
- Staff: Admin → Contacts → "Checkout contacts" lists email, mobile number, start date, sale emails, text permission and how far the order got, with a CSV (`/api/admin/contacts?format=checkout-csv`, reports access required). "Email sign-ups" and "Text sign-ups" are unchanged.
- Nothing sends an email or a text. The store has no texting service connected. Marketing texts may go only to numbers with Text permission = Yes, and each send needs the owner's approval.
- Privacy policy: one added paragraph on the checkout contact step and both permissions.

## Verification

- `npm run check:release`: TypeScript and 163 isolated suites passed, including the new `tests/checkout-contact-v1.cjs`, the updated `tests/email-offer-v1.cjs`, and `tests/checkout-owner-recovery-v1.cjs`, which runs the real Checkout component (contact first, carried forward, re-quoted when the number changes, members unchanged). Six other page tests received a one-line stub for the new component.
- The staff Contacts component is exercised through its real loading path with a fixture. The admin API returns 403 without a staff sign-in for both the report and the new CSV (local).
- Local production build, test-mode checkout, reserved example.com addresses and 555-01xx numbers, at 1280x800 and 375x812:
  - Pointer: brushing the top edge and returning within 120ms did not open the panel; leaving did. Within 30 seconds of Add to cart, on the same page and on the next page, leaving did not open it; at 45 seconds it did.
  - Touch: 48 seconds of doing nothing did not open it. With items in the cart, neither a flick nor returning opened it. With an empty cart, a slow scroll up did not, a flick did, one second away did not, 3.4 seconds away did.
  - Sign-up showed "You're on the list" with no code; the cart stayed at full price; checkout started with that email filled in.
  - Checkout: empty and short numbers were refused with the cursor in the number box; a valid contact was saved, folded to one line, and the address opened with the cursor in Full name and no phone box. It survived a reload. Change kept a typed name, and ticking the text box stored its version, wording and time. No sideways scrolling at phone width.
- Not verified by me: the signed-in admin screen (needs a staff sign-in), and a full guest delivery quote on the local copy (no carrier or tax keys there; the harness test covers that hand-off).
