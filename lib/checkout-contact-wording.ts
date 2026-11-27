// Checkout contact step wording and phone helpers, shared by the checkout form and the server.
// Kept apart from lib/checkout-contact.ts so the browser bundle carries no server code.

/** The sale-email box starts ticked. Bump the version when the wording changes. */
export const CHECKOUT_EMAIL_OPTIN_VERSION = 'checkout-email-v1';
export const CHECKOUT_EMAIL_OPTIN_TEXT = 'Email me private sales and deals';

/** The text box starts unticked: marketing texts need the buyer's own tick. Bump the version when the wording changes. */
export const CHECKOUT_TEXT_CONSENT_VERSION = 'checkout-text-v1';
export const CHECKOUT_TEXT_CONSENT_LABEL = 'Text me deals too';
export const CHECKOUT_TEXT_CONSENT_NOTE = 'By ticking this box you agree to receive automated marketing texts from Biomod at this number. Consent is not a condition of purchase. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help.';
/** Exactly what the buyer agreed to, stored with each permission. */
export const CHECKOUT_TEXT_CONSENT_TEXT = CHECKOUT_TEXT_CONSENT_LABEL + '. ' + CHECKOUT_TEXT_CONSENT_NOTE;

export const CHECKOUT_PHONE_HELP = 'Used if the carrier or our team needs to reach you about this order.';

/** The ten digits of a U.S. number, or '' when it is not one. A leading 1 is dropped. */
export function usPhoneDigits(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : '';
}
/** (702) 555-0101, the form the number is shown in and carried into the delivery address. */
export function formatUsPhone(value: unknown): string {
  const d = usPhoneDigits(value);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '';
}
