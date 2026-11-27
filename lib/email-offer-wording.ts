// Email sign-up offer wording and timing, shared by the browser panel and the server.
// Kept apart from lib/email-offer.ts so the browser bundle carries no server code.
export const EMAIL_OFFER_CODE = 'INSIDER10';
export const EMAIL_OFFER_PERCENT = 10;
/** Bump when the wording changes, so each sign-up records exactly what was agreed to. */
export const EMAIL_CONSENT_VERSION = 'email-offer-v1';
export const EMAIL_CONSENT_TEXT = 'By signing up you agree to receive marketing emails from Biomod about private sales, discounts and restocks. Unsubscribe anytime. We never share your email.';
/** A closed or completed panel stays away this long in that browser. */
export const EMAIL_OFFER_QUIET_MS = 30 * 24 * 3600000;
/** Touch screens have no exit signal, so the panel waits for this much browsing instead. */
export const EMAIL_OFFER_TOUCH_DELAY_MS = 40000;
/** Never interrupt buying, accounts, sign-in or staff pages. */
export const emailOfferBlockedPath = (path: string) =>
  /^\/(?:cart|checkout|payment|account|admin|login|register|forgot-password|reset-password|auth|affiliates?|verify)(?:\/|$)/.test(path);
