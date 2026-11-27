// Leaving pop-up wording and timing, shared by the browser panel and the server.
// Kept apart from lib/email-offer.ts so the browser bundle carries no server code.
// Owner, Nov 27 2026: no discount code is given at sign-up. INSIDER10 stays a working stored promo
// for the visitors who were shown it earlier that day; nothing here creates, shows or applies it.
export const EMAIL_OFFER_TITLE = 'Get our secret sales';
export const EMAIL_OFFER_LEAD = 'Private deals and restock alerts by email, before anyone else sees them.';
export const EMAIL_OFFER_DONE = 'Watch your inbox for secret sales and private deals.';
/** Bump when the wording changes, so each sign-up records exactly what was agreed to. */
export const EMAIL_CONSENT_VERSION = 'email-offer-v1';
export const EMAIL_CONSENT_TEXT = 'By signing up you agree to receive marketing emails from Biomod about private sales, discounts and restocks. Unsubscribe anytime. We never share your email.';
/** A closed or completed panel stays away this long in that browser. */
export const EMAIL_OFFER_QUIET_MS = 30 * 24 * 3600000;
/** The cursor has to be on the page this long before leaving counts. */
export const EMAIL_OFFER_ARM_MS = 4000;
/** The cursor has to stay out of the page this long, so brushing the top edge on the way to the cart icon does not count. */
export const EMAIL_OFFER_EXIT_HOLD_MS = 350;
/** After adding to or changing the cart, the panel stays away this long. */
export const EMAIL_OFFER_CART_QUIET_MS = 30000;
/** A trip to another app or tab has to last this long to count as leaving and coming back. */
export const EMAIL_OFFER_AWAY_MS = 3000;

export type ScrollSample = { t: number; y: number };
/**
 * Phones have no "about to close" signal. The usual stand-in is a fast flick back toward the top
 * after reading down the page: at least 30% of the screen (240px minimum) within 350ms, on a page
 * the visitor had scrolled at least a screen and a half down. `samples` are oldest first.
 */
export function flickedUp(samples: ScrollSample[], viewportHeight: number, deepestScroll: number): boolean {
  if (samples.length < 2 || !(viewportHeight > 0) || deepestScroll < viewportHeight * 1.5) return false;
  const last = samples[samples.length - 1], need = Math.max(240, viewportHeight * 0.3);
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > 350) break;
    if (samples[i].y - last.y >= need) return true;
  }
  return false;
}
/** Never interrupt buying, accounts, sign-in or staff pages. */
export const emailOfferBlockedPath = (path: string) =>
  /^\/(?:cart|checkout|payment|account|admin|login|register|forgot-password|reset-password|auth|affiliates?|verify)(?:\/|$)/.test(path);
