# Printable pick lists

Date: 2026-10-14
Author: Claude, at Logan's request
Scope: two new read-only admin routes and three links in the Orders tab. No order, stock, label or email change.

## Request
A downloadable pick list per order, one button that prints every order still waiting to be
fulfilled onto a single sheet to hand to an employee, and one that prints all standing labels.

## Change
- `lib/pick-list.ts` (new): decides which orders a picker acts on, combines the stock to pull across
  them, and renders a print-ready sheet. Pure and fully tested; no database or provider access.
- `app/api/admin/pick-list/route.ts` (new): `GET` behind `orders:read`. With `?id=` it renders one
  order; with no parameters it renders the To ship queue, capped at 300 orders. Returns HTML
  with `no-store` and `X-Robots-Tag: noindex, nofollow`. It reads; it never writes.
- `lib/label-sheet.ts` and `app/api/admin/labels/route.ts` (new): every bought-but-not-yet-moving
  label on one sheet, one per page, behind `orders:fulfill`. Label images are embedded with
  `referrerpolicy="no-referrer"`; a label that is not an image falls back to a link to the original.
- `components/store/orders-admin.tsx`: "Print pick list (To ship)" and "Print all bought labels"
  under the Orders heading, and "Pick list for this order" in the order panel.

## Scope of each sheet
The combined pick list covers the To ship queue only: paid, with nothing picked or labelled yet.
A single order can still be printed after its label is bought, for a recheck while packing.
The label sheet covers the Label bought queue: a label exists and the parcel has not started moving.

## What the sheet contains
Combined sheet: a "Pull from stock" block totalling every product across all waiting orders, then one
block per order, oldest first, each with tick boxes, item, quantity, the customer's name, city and
state, and the paid service. A sign-off line for picked by, checked by and date.

Deliberately absent: email, phone and street address. A picker does not need them and the shipping
label already carries the address. Saved text is HTML-escaped on the way out.

Orders on hold, internal tests, unpaid orders and anything already shipped or delivered are excluded
by their queue bucket, so a held order can never be picked by accident.

## Format
A print-styled HTML page with a Print button, rather than a generated PDF. The browser prints it or
saves it as PDF, which covers "downloadable" without putting a PDF library in the Worker.

## Verification
`npm run check:release`: TypeScript and the isolated suites passed, including the new
`tests/pick-list-v1.cjs` and `tests/label-sheet-v1.cjs`: picking and label eligibility including
holds, internal tests, already-moving parcels and non-https label urls; oldest-first order; combined
pull totals across orders; single-order sheet; empty sheets; contact details withheld; and markup in
saved data escaped. No network, no provider calls, no real orders.

## Gaps
Printing has not been exercised against a real printer, no label image has been rendered from a real
EasyPost url, and neither the 300-order nor the 200-label cap has been tested at volume. Live
verification of both sheets in the signed-in admin follows deployment.
