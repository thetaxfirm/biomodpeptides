# Signature required on delivery, October 15, 2026

Scope: trybiomod.com only. Author: Claude, at the owner's request ("when making the lables make them auto file for sig required as well"), with the level and who pays chosen by the owner: a required signature, cost absorbed by the store.

## Why

Research compounds left on a doorstep are a "never arrived" dispute waiting to happen, and nothing in the system asked the carrier for proof of delivery. Signature confirmation is the evidence that defeats that dispute.

## Behavior

Delivery confirmation is requested on the shipment the label is bought from, so the fee is priced into every rate the purchase then chooses between — which means the recorded label cost, and the automatic daily spend figure, both include it rather than understating what was spent.

**Quoting deliberately does not carry it.** `carrierShippingOptions` (checkout) and `liveShippingCheck` (the admin price check) create their shipment without the option, so checkout prices are unchanged and no customer is charged for the store's choice. The store pays the difference, the same posture as the USPS Priority floor.

The default is **Signature required**. Admin > Settings > Shipping offers adult signature (21+) and indirect signature as alternatives, and "None" as an explicit opt-out that survives a round trip. An unrecognised stored value falls back to a required signature rather than quietly dropping it — the same fail-closed shape as the minimum-service floor. Indirect signature is USPS only; a carrier simply ignores a confirmation type it does not offer.

This applies to every label, manual or automatic, since both go through `buyLabel`.

## Change

- `lib/shipping-options.ts`: `signatureConfirmation` on `ShippingOptionsConfig`, carried through both normalize paths; `signatureOptions`, `noSignature`, `defaultSignatureConfirmation`, and the `signatureConfirmation()` resolver.
- `lib/easypost.ts`: `createShipment` takes an optional `options` object; `buyLabel` is the only caller that passes one.
- `app/api/admin/shipping-services/route.ts`: accepts and persists the setting.
- `components/store/admin-shipping-settings.tsx`: the "Delivery confirmation" selector.

## Verification

`npm run check:release`: TypeScript and 84 isolated suites. `tests/shipping-minimum-service-v1.cjs` captures the shipment-creation payload and asserts the option is actually sent on a label purchase, that an owner's choice and opt-out are honoured, that junk falls back rather than dropping the signature, and — the part that protects the customer — that **neither checkout quoting nor the admin price check carries it**. `tests/shipping-options-v1.cjs` updated: the normalized default shape now includes the confirmation. `tests/admin-shipping-services-ui-v1.cjs` covers it in the save payload.

## Affected

`/admin?tab=settings` shipping panel; every label bought from `/admin?tab=orders` and by the scheduler. No migration, no schema change, no checkout or customer-facing price change.

## Release

Recorded after push.

## Gaps

The exact fee has not been measured against the live carrier — it varies by service and by the EasyPost account's negotiated rates. The first signature label's cost should be compared with a recent unsigned one to get the real per-order figure, and the daily automatic cap reconsidered against it if it is larger than expected.

Also unaddressed, and more relevant now that every parcel needs a signature: a missed delivery is more likely, and nothing yet flags a parcel that stops moving. The "labelled but never scanned" and "return to sender never reaches Needs review" gaps from the fail-safe review are still open.
