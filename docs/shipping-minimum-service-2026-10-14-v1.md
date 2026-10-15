# Store minimum shipping service, October 14, 2026

Scope: trybiomod.com only. Author: Claude, at the owner's request ("i need it to default to usps prio at the min", then "make the min shipping prio usps then you know that i want that"). Label purchase and shipping settings. No checkout pricing, catalog, or customer charge change.

## Why

"Buy shipping label" offered a USPS Ground Advantage label. Order #C4FFDD80 ($489.23, placed 2026-10-13) cleared the $200 free-shipping minimum, so its saved option is free standard shipping, which resolves to the cheapest standard service — Ground Advantage. `buyLabel` honours the saved service, so the confirmation named it correctly. There was no minimum-service setting anywhere in the codebase: nothing could express "never hand a carrier anything slower than Priority."

## Behavior

The store has a floor: the slowest service it will ever hand to a carrier. At label purchase, if the service the customer paid for is slower than the floor, the label is bought at the floor instead. The store absorbs the difference; the customer's saved shipping charge is never rewritten, and a service at or above the floor is never touched. The comparison is by tier, so it works across carriers — a UPS Ground selection is floored to USPS Priority.

**The floor ships set to USPS Priority Mail.** A store that has never opened the setting still gets it. Admin > Settings > Shipping has a "Never ship slower than" selector listing expedited and overnight services; choosing "No minimum" stores an explicit opt-out (`none`) that survives, so the default cannot creep back in. An unknown or misspelled key falls back to the default rather than silently removing the floor, in `normalizeShippingOptions` and again in `minimumService`, so a hand-edited settings row cannot quietly disable it.

If the floor is not quoted for a given address, the paid service is bought unchanged rather than failing the purchase. The floor's carrier is added to the rate request so a cross-carrier floor can be found.

What this costs: every order that would have gone Ground Advantage now goes Priority, and the store pays the difference. On the fixture rates that is $7.05 to $11.40. This is the intended trade.

## Change

- `lib/shipping-options.ts`: `minimumServiceKey` on `ShippingOptionsConfig`, carried through both normalize paths; `defaultMinimumServiceKey` (`USPS:PRIORITY`), `noMinimumService` (`none`), `tierRank`, `minimumService`.
- `lib/easypost.ts`: `buyLabel` upgrades the chosen rate to the floor when the floor's tier is strictly faster and the floor rate is available for that address.
- `app/api/admin/shipping-services/route.ts`: accepts and persists the setting verbatim, including the explicit opt-out.
- `components/store/admin-shipping-settings.tsx`: the selector, the cost warning, and the stated default.
- `components/store/shipping-admin.tsx`: the buy confirmation says a slower service is upgraded to the store minimum and that the saved customer charge does not change.

## Verification

`npm run check:release`: TypeScript and 80 isolated suites. `tests/shipping-minimum-service-v1.cjs` covers the default, the explicit opt-out, junk falling back rather than removing the floor, catalog resolution, tier ranking, and the upgrade-only decision across every catalog service. It then exercises the real `buyLabel` against a stubbed EasyPost and asserts which rate id is actually bought: a Ground selection and a free-standard selection both buy the Priority rate, a UPS Ground selection does too, Priority and Express selections are bought unchanged, the opt-out restores the old behavior exactly, and a floor the carrier does not quote leaves the paid service alone. `tests/shipping-options-v1.cjs` updated: the normalized default shape now carries the floor. No network, no provider calls, no real orders.

## Affected

`/admin?tab=settings` shipping panel; label purchase from `/admin?tab=orders`. No migration, no schema change, no checkout or customer-facing change, no product, price or credential change.

## Release

Source on main, pushed file by file with each file verified byte-identical afterwards: 37ef9f2 wrote a placeholder into `lib/shipping-options.ts` by mistake and fdc5e33 restored it (the gate runs before deploy, so the broken file failed the build and production was never served it); 134fe0d and e784448 (route, buy confirmation; the second fixed an `aria-expanded` attribute corrupted in the first); b551e25 (`buyLabel`); ba95191 (admin selector, new suite); this commit (gate list, updated expectation, this log).

Live read-only checks are recorded after the deploy of this commit.

## Gaps

A real label purchase against a live order has not been exercised — the fixture proves which rate id `buyLabel` selects, not that EasyPost bills the Priority rate. The first upgraded label should be checked by hand against the EasyPost dashboard.
