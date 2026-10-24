# Owner-added promo codes — 24 Oct 2026

## What changed

Promo codes could only be added by editing `lib/promotions.ts` and deploying. Administration now has
an **Add a promo code** button in the existing **Promo codes** tab: a code and a whole-number
percentage, saved to one settings row, live on the next cart.

## Why it is built this way

Promo codes set the price a customer pays, so the stored list is treated as untrusted input at every
step rather than as configuration.

- **Built-ins stay in source and always win.** `lib/promotions.ts` keeps its table. Stored codes
  arrive as an optional `extra` argument; a stored row naming a built-in code is dropped, never
  applied. Nothing in administration can reprice a code already printed on a card or sitting in a
  customer's cookie.
- **Nothing is repaired.** `normalizeStoredPromos` drops any row it does not fully understand —
  wrong shape, bad code, non-integer or out-of-range percentage, duplicate. A half-understood
  discount is worse than a missing one.
- **Failure direction is deliberate.** An unreadable settings row returns no stored codes, leaving
  the built-ins working and owner-added codes refused with "not valid". A customer never sees a
  wrong price because a read failed.
- **90% ceiling.** A 100% code is a free-checkout hole on a public storefront. Comp an order by
  refunding it.
- **Concurrent saves are refused, not merged.** The write is a compare-and-set against the exact row
  that was read; a second administrator's save is rejected with "reload and try again" rather than
  silently deleting their code.
- **`promotions.ts` stays dependency-free**, and `promo-codes.ts` depends only on it — no runtime
  import on the pricing path. The caller passes the database it already holds.

## Surfaces that resolve a code

All of these now read owner-added codes, and all are asserted in `tests/promo-codes-v1.cjs`:

| Surface | File |
| --- | --- |
| Checkout totals | `lib/commerce.ts` (`quote`) |
| Applying a code at checkout | `app/api/store/[action]/route.ts` (`promo`) |
| The saved code on a later page load | `app/api/store/[action]/route.ts` (`currentPromoCode`) |
| Affiliate referral links | `app/r/[code]/route.ts` |
| The promo report | `lib/promo-analytics.ts` |
| Assigning a code to a partner | `lib/affiliate-program.ts` |

The reply desk's code suggestions (`lib/request-replies.ts`) still offer built-ins only. It is a
dropdown, not a price, and wiring it meant rewriting a 40 KB file in the same change; it is the one
surface left and lands separately.

## Where it is mounted

Inside `components/store/promo-analytics.tsx`, at the top of the existing **Promo codes** tab.
Administration's shell is untouched, so no tab was added. Permission is enforced by the endpoint
(`store:write`) rather than by what is mounted: a reports-only reader gets a 403 and the panel
renders nothing, leaving the totals they came for.

## Not built

No expiry dates and no redemption limits (owner's call, 24 Oct 2026). Turning a code off is the
manual equivalent of an expiry and is instant.

## Verification

- `npm run check:release` — TypeScript and 101 isolated suites.
- `tests/promo-codes-v1.cjs` loads the real route against isolated SQLite and covers validation, the
  ceiling, untrusted rows, built-in collisions, cent-exact allocation, on/off, permission, origin,
  in-place edit, delete, audit history and the concurrent-save rebase. Mutation-checked: removing
  the compare-and-set, or letting a stored row override a built-in, both fail the suite.
- Live: add a throwaway code, apply it to a cart, confirm the total, then delete it.
