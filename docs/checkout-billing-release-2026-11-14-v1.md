# Checkout billing wording and billing lock switch: release v1

November 14, 2026. Author: Claude. Owner direction: a card must be billed to the delivery address.

## What changed (commit 79bb8d9)

- Checkout note under the pay button: the card must be billed to the delivery address; customers shipping elsewhere are sent to the contact form before ordering.
- `AUTHORIZENET_LOCK_BILLING=true` hides the billing form on the Authorize.net hosted page, so the delivery address is the only billing address. **Off by default and not set in production.** Authorize.net's documentation does not say whether a hidden `billTo` still reaches the address check (AVS). If it does not, the store's AVS filter could decline every card. Turn it on only with the owner ready to place one real order, then read that order's saved payment check: an AVS result of "Street and ZIP match" confirms it; "Address information unavailable" means switch it off again.
- A Zelle option for other delivery addresses was started and withdrawn by the owner the same day. The draft module is on local branch `claude/zelle-parked-v1`, not released.

## Checks

`npm run check:release` (TypeScript, 130 suites; payments-authorizenet-v1 extended for the lock) and the production build passed. Live: the new checkout wording is in the deployed checkout bundle. No payment was attempted.

## Funnel reading (aggregate events, 28 days to Nov 14; events, not people)

cart add 140, cart view 67, sign-in wall 42, checkout form 15, delivery quote 7, payment handoff 6. Checkout requires an account: seven fields, a business type and email verification before sign-in. No guest checkout.
