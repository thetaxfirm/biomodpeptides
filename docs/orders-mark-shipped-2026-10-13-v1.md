# Queue shortcut: mark a label-bought order shipped

Date: 2026-10-13
Author: Claude, at Logan's request
Scope: Admin Orders tab only. No pricing, catalog, payment, carrier or database change.

## Request
A clickable control next to "Print label" that manually marks an order as shipped, without
opening the order panel.

## Change
`components/store/orders-admin.tsx`: the "Label bought" row's next step now renders
"Print label" plus a **Mark shipped** button. The button is a shortcut to the manual
"Handed to carrier (store confirmation)" action that already exists in the order panel —
same `order` admin action, same `orders:fulfill` permission, no new server behaviour.

- `canConfirmShipped(order, allowed)` gates it: `orders:fulfill`, bucket `label`, status `paid` or `shipped`.
- `MarkShipped` asks for confirmation first, then submits `{ id, status: 'shipped', tracking }`,
  carrying through the tracking number recorded with the label rather than blanking it.
- `components/store/orders-admin.module.css`: `.nextGroup` lays the two actions out together.

Roles without `orders:fulfill` see no change. The order panel's manual form is untouched.

## Verification
`npm run check:release`: TypeScript and 71 isolated suites passed, including the new
`tests/orders-mark-shipped-v1.cjs` (added to the gate list in `scripts/release-check.mjs`).
The new suite covers visibility by bucket, status and role; a declined confirmation writing
nothing; an accepted confirmation preserving tracking; empty tracking staying an empty string;
and the busy-disabled state. No network, no provider calls, no real orders.

## Gaps
Not deployed and not verified live at the time of writing. Deployment and a signed-in check of
the Orders tab on trybiomod.com are still outstanding, as is confirming the customer-facing
shipped notification against a test order rather than a real one.
