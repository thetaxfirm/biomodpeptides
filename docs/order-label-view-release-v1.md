# Order label and delivery view, release v1

Date: November 8, 2026. Author: Claude (owner request). Branch `claude/order-summary-v1`.

## Request

Owner: there was no way in admin to see an order's shipping label or whether it was delivered. Add it for all customers, available whenever a customer is opened: order, customer, items, total, payment, shipment, label (was missing), last contact recorded, next step.

## Change

- `lib/order-label.ts` (new): `labelSummary(order)` says whether a label exists, its https label and tracking links, service, tracking number, purchase date, insurance and signature, and the carrier's last status and time. "Missing" is used only for a paid order with no label on file. `nextStepWords(order)` gives the next step in words for read-only views.
- `components/store/customer-orders.tsx` (new): `LabelCell` (View label, Track, service and tracking number, bought date, protection, delivered or carrier problem) and `CustomerOrders` (every order with the same email, including archived and test, with Order, Items, Total, Payment, Shipment, Label, Last contact recorded and Next step). The email is sent in a POST body to the existing `admin-orders` endpoint (`orders:read`), never in a URL. Read-only: nothing is bought, sent or changed.
- `components/store/orders-admin.tsx`: Label column in the Orders table; the order panel shows the customer's orders, with the open order marked and the others one click away.
- `components/store/request-inbox.tsx`: the reply desk conversation shows the customer's orders under the order line, before the reply box.
- Tests: `tests/order-label-v1.cjs` (new, in the release gate); stubs for the new component in `orders-dropped-off-v1`, `request-desk-v1`, `admin-read-recovery-v1`.

## Checks

- `npm run check:release`: TypeScript and 120 isolated suites passed.
- Production build and deployment: recorded below after the push.

## Gaps

- Roles without `orders:read` see "Your role cannot view orders." in the reply desk instead of the list.
- The carrier status shown is the last one the store saved; the carrier's full scan history stays behind Track.
