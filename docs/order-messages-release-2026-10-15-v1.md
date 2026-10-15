# Orders tab: who was messaged and when, October 15, 2026

Scope: trybiomod.com admin only. Author: Claude, at the owner's request: "anyone we send a message to. show that and when."

## Behavior

The Orders table has a new **Messaged** column. It shows the most recent message sent to that customer, when it was accepted by the mail provider, and how many have gone out in total ("Email reply · Oct 14, 2026, 3:02 PM · 3 sent"). An order with nothing sent reads "Not contacted". Hovering the cell lists every message. The order's detail panel lists every message, newest first, with who sent it where known.

Sources, read-only:

| Shown as | Source |
| --- | --- |
| Automatic checkout reminder | `checkout_recovery`, status `accepted`, `accepted_at` |
| Email reply | `request_reply_messages`, outgoing, in the order's conversation **or** to the order's email address after the order was placed |
| Email from your mailbox / Phone or text (logged) | `request_external_replies` on the order's conversation |
| Tracking email / Tracking email (not confirmed) | `change_events`, action `shipping.tracking_email`, status `succeeded` / `observed` |
| Lab report email | `coa_delivery_outbox`, purpose `coa`, status `accepted`, to the order's email after the order was placed |

A message sent to the address before the order existed is not attributed to it. A reply counted through the order's conversation is not counted again through the address. Times are provider acceptance, never claimed as inbox delivery, and the detail panel says so. Message bodies are never returned. Any source table that is missing degrades to "Not contacted" rather than breaking the tab.

**Logging gap closed.** Tracking emails sent by the automatic label job were not recorded anywhere; only the admin path wrote `shipping.tracking_email`. The job now records it under its existing audit identity, "Automatic label purchase", with the same wording as the admin path. Automatic tracking emails sent before this release have no record and are not shown; no history is invented for them.

## Verification

`npm run check:release`: TypeScript and 85 isolated suites. New `tests/order-messages-v1.cjs` runs the real module on in-memory SQLite with every migration applied, synthetic `example.invalid` records only, network forbidden. It asserts newest-first ordering across all five sources, case-insensitive address matching, exclusion of a pre-order message, no double count of a linked reply, the unconfirmed tracking label, that `attempted` audit rows are not sends, no bodies in the output, graceful degradation on a missing table, and the route/UI/auto-label wiring. `tests/orders-mark-shipped-v1.cjs` maps the new module for its render harness. `tests/auto-label-v1.cjs` still passes. `BIOMOD_DEPLOY=true npm run build` passes.

No network, no provider calls, no real orders, customers or emails in any suite.

## Affected

`/admin?tab=orders` (table column, detail panel); `GET /api/store/admin-orders` (each order now carries `messages: { count, last, items }`); the `*/5` automatic label job (one extra audit row per tracking email). No migration, no schema change, no customer-facing change.

## Release

- Source: `ab57a6c` on shared main, fast-forward from `6060424` (no intervening commits; nothing to reconcile).
- Deployment: Cloudflare Workers Builds `biomod-peptides` succeeded for `ab57a6c` at 2026-10-15 22:10:01 UTC. GitHub `release-check` succeeded at 22:07:42 UTC.
- Live check (read-only, no login): the admin page's served chunk `/_next/static/chunks/experience-TTzb1BPO.js`, reached by following the live entry scripts, contains the new strings "Not contacted", "Messages sent" and "Automatic checkout reminder".
- Changes page: `node scripts/change-history-import-v1.mjs --remote` imported 6 new events (commit, checks, deployment, version).
- Gap: the authenticated Orders tab and the `admin-orders` response were not viewed live. No staff session was used, and no credential was requested. The first real automatic tracking email after this release is the first that will show; earlier ones were never recorded.
