# AI reply certainty gate and pause (Oct 30, 2026)

Owner request (chat, Oct 30 2026): the pending AI customer-service drafts were wrong ("not even in the ball park", "you need to be certain"). Discard them, pause automatic drafting, fix, and show the owner before drafting resumes.

## What the owner found (all four rejected)
- Autumn Tatro, order 601FF4DB: already bought and already emailed several times; draft came two weeks late.
- Sheldon Steinburgh, order 310C5F61: order cancelled; draft said "still saved".
- Aaron Lambert, order B329EB36: wrote from another address and gave the order number in the form; draft asked him for it. He had already been emailed and the missing items shipped.
- Winfred (lab-peptides): supplier pitch; drafted a reply instead of Spam.

## Runtime changes (production D1, attributed in change_events as claude-agent owner request)
- Cancelled drafts 62a3338c, 2155e115, 79974fb8 (reason owner_rejected_2026_10_30). Request 06429c34 (Winfred) set to spam.
- settings.reply_ai_v1 = {"paused":true,...}. AI drafting stays paused until the owner reviews this change.
- Jarvis Ready to Send items ae745b74, f5827618, c85ba975, 3d526001 set to discarded (restorable).

## Code
- e846c06 (deployed 21:59 UTC): pause switch. No AI draft, automatic or from the desk, while paused; a bad setting read counts as paused. Staff replies and owner sends unaffected.
- This change: lib/reply-gate.ts runs when a draft is about to be written (claim), not when requested.
  - Finds the person's orders by checkout email, any order number they gave (subject, message, or the form's lot box "ORDER-B329EB36"), or an exact first+last name shared by one checkout email only.
  - No AI draft when: anyone replied (desk or recorded outside reply, to any of their addresses) after they last wrote; they wrote more than 3 days ago; the order conversation is about a cancelled/refunded order, or an unpaid order whose follow-up check fails; it is about an order but no order matched; it is a supplier pitch (also moved to Spam). The desk shows the reason.
  - Jobs carry latestIncomingAt, linkedEmails and linkedOrders. New bridge action draft_states.
- Jarvis (server/services/trybiomodReplies.ts, untracked; backup in AI Workspace Backups/jarvis-trybiomodReplies-20261030-*): refuses to write when any connected mailbox shows an email to any linked address after the customer last wrote (reason answered_in_mailbox); prompt lists matched orders and forbids asking for an order number; removes Ready to Send copies whose website draft is no longer ready or whose request closed.

## Tests
- tests/reply-gate-v1.cjs (new, in gate): the four rejected cases replayed with synthetic data.
- request-replies-v1 (pause; answered-elsewhere now stops the draft), request-cases-v1 (cancelled order gets no AI job).
- check:release: TypeScript + 112 suites passed; production build passed.
- Jarvis trybiomodReplies.test.ts 72/72. Full Jarvis npm test: 736 pass, 5 fail in unrelated areas (privacy entry points, schedulers, narration, mailbox onboarding) from other uncommitted work in that folder.

## Gaps
- Drafting remains paused; the gate has not run on live requests. The owner reviews before it is turned back on.
- Mailbox check covers connected mailboxes only (texts, calls and unconnected accounts are not seen).

## Later the same day: drafting resumed; Support staff can send (blind copy to the owner)
- Owner: "ai drafting can be turned on" — settings.reply_ai_v1 set to {"paused":false} (attributed change event).
- Owner: give Bryan (bryan@biomodpeptides.com) customer-service access; he may send replies to customers directly; blind-copy the owner; he may see customers and orders.
- New permission requests:send (owner, support). Managers still save drafts only. Cases tagged Owner review required stay owner-send only.
- A send approved by a staff row (owners are never staff rows) carries bcc = settings.reply_staff_send_v1.bcc, default ash@biomodcompounds.com. Jarvis stores it on the Ready to Send item and its draft row, sends it through Gmail, and refuses any other or missing BCC on that reply.
- Support can open private original COA PDFs from the desk (admin-coa-original accepts requests:write).
- Tests: request-replies-v1 (support sends, BCC, owner sends without BCC, owner-review block, managers cannot send); Jarvis trybiomodReplies.test.ts 73/73. check:release 112 suites passed; build passed.
- Deploy order: Jarvis restarted first (PID 96937) so no staff send could go out without the copy.
