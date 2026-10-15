# COA follows the lot on the customer's vial, October 14, 2026

Owner direction after a wrong COA: "Have systems in place not to mess this up again." Author: Claude. Base: bc414e9 in worktree `claude/coa-lot-guard-v1`.

## What happened

An expo buyer asked for a COA from the HEAT-R 20mg page (form subject "HEAT-R 20mg / 102-20-0001"). The reply desk matched the 20mg report from that subject and the reply said it "matches your Olympia expo purchase". Her vial was lot 102-30-0001 (HEAT-R 30mg). Her emailed correction was not shown in the desk because the Jarvis reply bridge had stalled from 1:21 PM to 5:30 PM Pacific (last website check-in 20:21:42 UTC). The owner directed a corrected reply with the 30mg report (V260812-35 001) and code COMEBACK15 to her and to a second customer with the same lot; both were sent from research@ at 00:27 UTC on October 15 and recorded in the desk.

## Store changes (this commit)

- Request by email (`/api/coa-link`) requires the lot printed on the vial. The report for that lot is sent even from another size's page; an unknown or ambiguous lot creates a reply-desk request for a person and emails nothing.
- Contact form has an optional "Lot on your vial" field (`labelLot`). COA automation and the reply desk choose the report by that lot, and the desk refuses to attach a report for any other lot.
- The Documentation contact link no longer pre-fills the page lot.
- Reply desk shows the customer's vial lot and turns the Jarvis check-in notice into a red alarm after 15 minutes of silence.

Affected: lib/coa-delivery.ts, lib/coa-link.ts, lib/coa-outbox.ts, lib/request-replies.ts, app/api/coa-link/route.ts, app/api/store/[action]/route.ts, components/store/batch-record.tsx, content.tsx, request-inbox.tsx. URLs: every on-request product page COA popup, /contact, /admin?tab=requests.

## Jarvis changes (local, not in this repository)

`server/services/trybiomodReplies.ts` (untracked in the Jarvis repository; backed up first to AI Workspace Backups): a pass that runs past five minutes (twenty while sending) is recorded in trybiomod_reply_health and a fresh pass starts; the AI draft call has a four-minute deadline; AI drafts may never say a report matches a purchase or vial and must ask the customer to compare the report's lot with their vial. 31 of 31 bridge tests pass, including two new ones. Jarvis restarted via its LaunchAgent; the bridge checked in at 00:41:28 UTC.

## Validation

- `npm run check:release`: TypeScript and 79 isolated suites, including new `coa-label-lot-v1.cjs`.
- Built Worker: `coa-link-worker-v1` (wrong-page lot sends the 30mg report, unknown lot goes to review with no email, lot required), `coa-worker-v1`, `coa-first-attempt-worker-v1` pass. `coa-shipping-worker-v1` fails identically on untouched main (shipping service availability), not caused by this change.
- Live: `/api/coa-link` without a lot returns "Enter the lot number printed on your vial"; the HEAT-R 30mg COA popup shows the lot and email fields.

## Gaps

- No live end-to-end COA email was sent as a test (it would email a real address).
- The signed-in reply desk was not viewed live.
