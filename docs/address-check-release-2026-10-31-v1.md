# Checkout address check release — 2026-10-31

## What changed

The owner reported label and shipping trouble from addresses: customers leave out apartment numbers
(the order ships and nobody knows), and customers retype a billing address on the Authorize.net page
that does not match their card, so the fraud filter holds the order.

- **USPS check at checkout.** A fresh delivery quote asks EasyPost (`POST /v2/addresses`,
  `verify: true`) about the street, city, state and ZIP before pricing. A missing apartment/unit, an
  unknown unit, or an address USPS cannot find stops the quote with an inline message, and the
  cursor moves to the field to fix. The customer can fix it or confirm the address as typed. A check
  that cannot run (EasyPost off, unreachable, USPS engine down) never blocks a customer.
- **The result travels with the order** as `data.addressCheck` (`status`, `at`, `confirmed`) from
  the stored quote to the order, and staff see it on the order details.
- **Authorize.net billing prefill.** The hosted payment request now sends `billTo` built from the
  delivery address, in schema order (customer, billTo, shipTo). The apartment line now reaches
  Authorize.net; it was dropped before. Checkout copy tells customers to change billing only if their
  card bills elsewhere.
- **Automatic labels hold flagged addresses.** An order whose address USPS flagged, including one the
  customer confirmed anyway, gets a `shipping` hold once (`addressHeldAt`). After staff clear it, the
  job ships it and never re-holds it. Orders paid before this release are checked at label time. An
  outage never stops shipping. The auto-label health line reports the count.
- The apartment field label is now "Apartment, suite or unit (if any)" on checkout and saved addresses.

## Source and deployment

- Author: Claude (owner-approved Oct 31 2026). Pull request thetaxfirm/biomodpeptides#164,
  rebase-merged as `42055e3` directly over `95fcf72`. No intervening commits.
- Files: `lib/address-check.ts` (new), `lib/easypost.ts`, `lib/checkout.ts`, `lib/auto-label.ts`,
  `lib/authorizenet-payments.ts`, `app/api/store/[action]/route.ts`, `components/store/account.tsx`,
  `components/store/provider.tsx`, `components/store/order-admin.tsx`,
  `components/store/admin-shipping-settings.tsx`, tests listed below.
- Merged 2026-10-31 20:35:08 UTC. GitHub `release-check` on `42055e3`: success (20:37:05 UTC).
  Workers Builds `biomod-peptides`: success (20:37:32 UTC). Deployed version
  `36efad4d-9f36-4a29-b2ab-4bb25f6cf698` at 20:37:27 UTC, 100% of traffic.

## Tests

- `npm run check:release`: TypeScript and 113 isolated suites passed locally and in GitHub
  `release-check` on the pull request.
- `easypost-v1.mjs`: exact verify request (no name, phone or email sent; nothing bought),
  classification of each EasyPost code, and outages read as unavailable.
- `address-normalization-v1.cjs`: a flagged address stops the quote before rates, confirmation lets it
  through, the check carries quote to reselection to order, and an outage passes.
- `shipping-settings-route-v1.cjs`: only literal `true` confirms; a flagged address returns 422 with
  `addressProblem`; other quote errors are unchanged.
- `payments-authorizenet-v1.mjs`: billTo order and contents, apartment included, 60-character limit.
- `auto-label-v1.cjs`: holds once, ships after the hold is cleared, re-checks older orders, never
  blocks on an outage, never overwrites an existing hold.
- Loader maps updated in `fulfillment-v1`, `change-history-system-v1`, `preorder-order-v1`,
  `admin-shipping-services-ui-v1`.
- The real `Checkout` component was clicked through in a local harness with a mocked store and
  server replies: warning, focus, confirm checkbox and the add-apartment fix, at desktop and 375px.

## Live verification

Read-only, 2026-10-31 after 20:37 UTC, with `?measurement=off`:

- `https://trybiomod.com/` 200, `/shop` 200, `/checkout` 200, `/cart` 200, `/admin` 307 to sign-in.
- Unauthenticated `POST /api/store/delivery` is refused (403), as before.
- The live checkout scripts contain the new strings: the "Apartment, suite or unit (if any)" label,
  the confirmation wording, the billing note and the `addressConfirmed` request field.
- No order, payment, quote or address check was created on production.

## Gaps

- The Authorize.net hosted page with `billTo` prefilled has not been seen. Authorize.net documents
  that request values populate the form and remain editable. The owner will open one checkout to the
  payment page and cancel.
- No live USPS warning has been triggered: that needs a signed-in checkout, which agents do not run
  on production.
- EasyPost pricing for US address verification is not stated in their docs.
- A street over about 52 characters plus an apartment can be clipped by Authorize.net's 60-character
  address field. Labels are unaffected because EasyPost keeps street2 separate.
