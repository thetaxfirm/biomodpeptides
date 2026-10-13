# Per-service shipping controls, October 12, 2026

Scope: trybiomod.com only. Author: Claude, at the owner's request ("give me a section in admin to choose which shipping options to include, how much extra to charge per option and what they say ... double check it then and there").

## Why

Production settings had never saved shipping options, so checkout charged customers the raw carrier rate with no extra (for example USPS Ground Advantage $6.27 and $8.62 on recent orders) and only the cheapest service per speed. The owner sets prices; the store does not.

## Behavior

Admin > Settings > Shipping lists every domestic USPS, UPS and FedEx service EasyPost quotes (20 services). Per service the owner chooses: offer on/off, the extra added on top of the carrier price, the name customers see and an optional note. Each row shows the live carrier price for a sample address and package and what the customer will pay. The free-shipping minimum and backup standard price moved into the same panel.

Save writes the settings, reads them back from the database and compares, then runs one live EasyPost rate request through the exact pricing checkout uses. The result is a green "everything works" or names each problem (service not offered for that sample, price mismatch, save did not stick, no options, EasyPost unreachable). Nothing is bought. Owners can re-run the check for five sample cities and five package sizes.

Checkout shows each offered service with the owner's name, note and carrier estimate; the carrier/handling breakdown is no longer shown to customers in this mode. When an order reaches the free-shipping minimum, the standard service with the lowest carrier cost becomes free; others keep their price. A quote is refused if the owner changes that service's extra or turns it off before payment. Orders store the carrier service, so label buying still matches exactly; staff order views show the real carrier service beside a custom name.

Until the owner saves the panel once, the previous tier behavior stays live unchanged. The store Settings save no longer carries shipping fields, so it cannot overwrite shipping.

## Verification

- `npm run check:release`: TypeScript and 64 isolated suites. New: `admin-shipping-services-ui-v1.cjs` (actual component, save payload, verdict states) and `shipping-services-v1.cjs` (quote, selection, payment handoff, saved order, label match, stale price/off-service refusal, free minimum, live check, policy copy). Replaced `admin-shipping-settings-ui-v1.cjs`, whose tier UI no longer exists.
- `BIOMOD_DEPLOY=true npm run build` passed. Built-Worker tests `shipping-options-worker-v1.mjs` and new `shipping-services-worker-v1.mjs` (save, read-back, live check, checkout, store-settings preservation, change history) passed on local D1 with synthetic providers.
- Component exercised in a local browser with synthetic rates: desktop and 375px, edit extra and name, save, green result. Synthetic prices only.

Deployment version and live checks are recorded below after release.

## Affected

`/admin?tab=settings`, `/admin?tab=orders`, `/checkout`, `/shipping-policy` overnight sentence; `/api/admin/shipping-services` (new), `/api/store/admin-config`. No migration. No product, price, order or credential change.
