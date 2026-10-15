# Request visibility and email controls, October 15, 2026

Owner authorization: fix the identified request/admin/email-control issues now; mailbox setup remains deferred until tomorrow. Scope is trybiomod.com only. Implemented by Codex with parallel review. Git author/provider account metadata is separate from this task attribution.

## Behavior

The protected Requests inbox now reloads new requests and current reply metadata automatically while the tab is visible. It checks every 30 seconds when idle and every 2.5 seconds while a draft or approved send is in progress, and checks again when the page regains focus. Polling is read-only, pauses on other admin tabs, preserves unsent text and other admin edits, and rejects an older response after refresh/unmount. A failed read leaves the last known records visible with an explicit retry notice. The list remains bounded to the latest 200 requests plus the specifically linked or selected older request.

New staff alert templates identify the sender, subject, tentative category and full reference, with a link to the exact conversation. Name and subject are bounded plain text; the customer message body is not copied into the alert. Exact links survive the administrator sign-in round trip and reveal supplier, archived or deleted requests. Selecting another admin tab removes the alert reference. Existing queued/historical alerts retain their saved payload and idempotency key.

Supplier suggestions now require seller or catalog-offer language. Questions about manufacturing, purity or wholesale buying remain in the customer queue unless staff explicitly tags them otherwise. The shared heuristic also serves overdue reminders; staff issue tags remain authoritative.

Email controls now distinguish owner-approved AI/staff drafts from automatic customer-requested COA links, internal new-request alerts, overdue reminders and configured checkout recovery. The new-request switch is accurately described as applying to new-request alerts, not the other email paths. Provider acceptance is not presented as inbox delivery. Existing lot/report matching and send permissions are retained.

Tracking emails now use the current configured reply-to inbox at send time, matching COA links and checkout reminders. An unavailable/invalid reply address prevents the provider call. A configuration-read failure does not undo a saved carrier label. Existing sender, notification destination and runtime configuration were not changed.

## Source and consumers

Preserved and fast-forwarded collaborator work from bf8883afc8cb2ea52041fd954d125dd7f162e0cb to shared main 40e177695cf251d2f62bfa04143cd1322499da31 before editing. The intervening commits report Git authors Ash Taha and biomodpeptidelogan; those labels do not identify the person or model operating a shared account.

Affected routes: /admin?tab=requests, /admin/login and authenticated POST /api/store/admin-request-replies; staff request-alert templates and tracking-email replies via /api/admin/shipping. Source is app/[...path]/page.tsx, app/api/store/[action]/route.ts, app/api/admin/shipping/route.ts, components/store/{admin,experience,request-inbox,coa-automation}.tsx and lib/{request-issues,coa-outbox,easypost}.ts. No database migration, product, inventory, order correction, role, credential or mailbox change.

## Verification

- TypeScript and 82 isolated release suites pass. The production build runs the same release gate. New request-alert and snapshot suites are included in the maintained gate.
- Actual component regressions cover empty inbox arrival, retained drafts/instructions, active/inactive tabs, visibility/focus, single-flight polling, errors/recovery, exact older/deleted/supplier targets, link consumption, authentication return routing, stale responses and no unintended sends.
- Actual route regressions use isolated SQLite, mocked staff authorization and no mail. They cover bounded newest/focused queries, supported request kinds, all metadata chunks, prior-client compatibility, UUID validation and access denial.
- Built Worker checks cover inbox snapshots/authentication, forwarding safety, request-alert first attempts and shipping access/tracking with isolated D1 and mocked providers.
- Browser interactions on an isolated synthetic preview verify new request counts, retained unsent text, exact supplier selection and responsive layout. At 390px the page has no horizontal overflow; no console errors were observed. This preview contains no real customers and cannot send or save.

The final source commit, GitHub checks, Cloudflare deployment/version, read-only live observations and any verification limits are recorded after publication in the dated Email Controls Release Receipt under the approved BioMod-SEO-Sprint generated-document folder. Production email delivery is not a test claim: no live customer email is sent as QA.
