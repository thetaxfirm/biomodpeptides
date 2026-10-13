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

## Release

Source on main: ebf6838 then 0197e04 rebased to 9ac0cd0 (fast-forward, after collaborator commits 26e4303 and a41fc3f). Combined gate: TypeScript and 65 suites passed. Cloudflare Workers Builds deployed version 867322b5-a235-49b0-bf16-4322b44fcf26 at 2026-10-13T05:50:22Z.

Live read-only checks: `/api/admin/shipping-services` returns 403 "Administrator sign-in required." when signed out; `/`, `/checkout`, `/shipping-policy` return 200; `/admin` redirects to sign-in. Production shipping settings were not changed by this release: per-service mode starts only when the owner saves the new panel.

Gap: the signed-in live EasyPost check has not run yet; it needs an owner sign-in at /admin?tab=settings. The panel runs it on open and after every save.
