# Track page: carrier scans beside the label, release v1

Date: November 8, 2026. Author: Claude (owner request). Branch `claude/order-summary-v1`.

## Request

Owner: when pressing Track, open the label side by side with the tracking, so the carrier's scans and the label can be copied and sent to the customer when there is a problem.

## Change

- `app/api/admin/parcel/route.ts` (new, `orders:read`): `/api/admin/parcel?id=<order>` renders the Track page. It reads the order's production EasyPost shipment tracker live and shows every scan, newest first, beside the label. `&label=png` serves the label saved on that order from EasyPost's file host only (never a URL from the request; image types only), so the browser can copy or download it. `&download=1` downloads it. Read-only: buys, sends and changes nothing.
- `lib/parcel-sheet.ts` (new): scan parsing (carrier clock time as written, grouped by day), the plain-text copy, the EasyPost-only label host check, and the page. Buttons: Copy tracking history, Open carrier page, Print or save as PDF (history and label on one page), Copy label image, Download label. The label stays in view while the history scrolls; stacks on phones.
- `lib/easypost.ts`: `readShipmentTracker` returns the production tracker after checking the shipment id and tracking number.
- Every Track link in admin opens this page: the Orders table next step, the Label column and customer order list, and the order panel.
- Test: `tests/parcel-sheet-v1.cjs` (new, in the release gate).

## Checks

- `npm run check:release`: TypeScript and 121 isolated suites passed.
- Page layout checked locally with one real order's scans and label (scratch only, nothing committed).
- Source commit `5d31db8` pushed to main Nov 9 2026 ~00:58 UTC. Workers Builds and GitHub release-check succeeded; Worker version `e6f68163-8d76-4c55-989f-d143f8c21699` deployed 01:01 UTC.
- Live: `/api/admin/parcel` and `&label=png` return 403 without an admin session; the served admin bundle links Track to `/api/admin/parcel`.

## Gaps

- Signed-in live view not checked by Claude (no admin session). Unauthenticated access is refused (checked after deploy).
- Copy label image depends on the browser's clipboard support; Download label is the fallback.
