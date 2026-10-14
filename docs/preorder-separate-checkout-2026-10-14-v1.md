# Preorders check out separately, October 14, 2026

Owner: "Orders containing preorder items ship together when all items are ready. have them purchase preorders separately at check out. make it coherent."

## Behavior

- A cart is either all preorder items or all in-stock items. Adding a preorder to a cart with in-stock items (or the reverse), including fixed packs and mix-and-match packs, is refused with: "Preorders check out separately. Check out your in-stock items first, then place a separate order for preorders (or the other way around)."
- The pack builder will not add a pack that mixes preorder and in-stock products and says why.
- A cart that already mixes them (saved before this change) shows the message with two buttons: "Check out in-stock items now (remove preorders)" and "Check out preorders now (remove in-stock items)". Proceed to checkout is disabled until one group is removed.
- The server refuses checkout of a mixed cart (409) regardless of the browser.
- Copy is consistent everywhere: product preorder notice, cart and checkout summaries, FAQ, Shipping Policy and the research FAQ now say preorders are purchased in their own order and ship when the preorder is ready. Order records, receipts and admin notices for preorder orders say "Ships when the preorder is ready." The "ship together when all items are ready" promise is removed.

Existing orders are unchanged. Pricing, discounts and the preorder offer (15% off, early November 2026) are unchanged.

## Verification

`npm run check:release`: TypeScript and 74 suites; `tests/preorder-order-v1.cjs` adds the mixing rule, the server checkout refusal, all add paths and a copy check. Author: Claude at the owner's request.
