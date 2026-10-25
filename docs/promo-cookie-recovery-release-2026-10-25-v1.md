# Preserve saved promo codes during settings read failures

October 25, 2026. Change authored by Codex during the authorized TryBiomod daily consistency review. Reviewed on shared main through dda628ba088781e66ae1e3329cad3648e4d4f3e7; pending collaborator files in the older SEO checkout were preserved.

## Problem and behavior

When a custom promo cookie was resolved during a transient settings database read failure, storedPromotions silently returned an empty list. The store route interpreted that as a successful read proving the code was invalid, then deleted the cookie. A subsequent successful read could not recover the customer's saved code.

The cookie resolver now requests read-error propagation. A failed read preserves the cookie while refusing an unverifiable custom discount for that response. Built-in codes remain usable. A successful complete read still rejects and removes a code that no longer exists. Pricing callers retain their existing fail-closed behavior; no code, percentage, product price or historical order was changed.

## Validation

The regression executes the actual currentPromoCode function with the real stored-promo reader and an isolated database failure. It failed before the fix (deleted true) and passed afterward. It also covers built-ins during outage, removed codes after a successful empty read, and custom-code resolution after recovery.

- npm run check:release: TypeScript and 102 isolated suites passed.
- BIOMOD_DEPLOY=true npm run build: release gate and production build passed.
- No production database outage was induced, custom code created, cart/purchase submitted or provider send performed.

Deployment commit/version and live read-only verification belong in the dated external sprint receipt after publishing. Protected aggregate access was separately denied with HTTP 403 during this run; that account-access gap is not evidence of an application database outage or a customer incident.
