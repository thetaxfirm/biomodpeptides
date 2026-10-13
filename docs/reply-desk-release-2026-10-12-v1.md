# Reply desk v1

Owner request, October 12, 2026: replying from Admin → Requests was too slow and too hard. Drafts were written by Jarvis on a 30-second pull, then had to be opened and sent from Jarvis Ready to Send in a different app; four ready drafts were sitting unsent there. No COA or discount-code picker, no dictation, and the AI did not learn from the owner's edits.

## What changed

- Requests is now one desk: a compact queue on the left (To reply, oldest first, with age; Waiting on customer; Done; Spam; All) and the conversation on the right with an editable draft. A customer follow-up after a reply or a closed request returns the thread to To reply.
- Dictate (browser speech recognition) or type an instruction; the AI rewrites the current draft in place. Undo restores the previous text. "Remember this instruction" saves it as a standing reply rule.
- Insert code lists the server-owned active promotion codes. Attach COA lists the approved private originals (product, strength, lot, current lot marked). A hand-picked original passes the same hash, duplicate-send and send-lock checks as an automatic match.
- Owner Send: one click creates an exact staff revision marked approved by that owner. Jarvis claims approved sends first, stages them and sends through the same checks as its own Send button. Managers and support save drafts only. A send Jarvis refuses before the provider call clears the approval (`send_blocked`).
- Learning: when a send is acknowledged, a private row keeps the AI wording beside what was actually sent. AI jobs carry the reply rules, the last six edited examples and the active codes. The desk shows how many of the last 20 AI drafts went out unchanged.
- Speed: the desk polls reply status every 2.5 s while work is in flight (30 s otherwise) instead of reloading all administration. Jarvis polls every 4 s, drains up to five jobs in a row, and writes website drafts at medium effort.
- Jarvis heartbeat: the claim call records when Jarvis last checked in; the desk warns when it has been quiet for 3 minutes (Mac asleep or Jarvis down).

## Data

Migration `0025_reply_desk.sql` adds four nullable columns to `request_reply_drafts` (`approved_at`, `approved_by`, `ai_draft`, `coa_choice`) and the private tables `request_reply_learning`, `request_reply_style` and `request_reply_bridge_seen`. Additive; no existing rows are rewritten. Customer text stays in private D1 only.

## Tests

`npm run check:release`: TypeScript and 63 isolated suites. `tests/request-inbox-v1.cjs` covered the retired card UI and is replaced by `tests/request-desk-v1.cjs` (queue order, resurfacing, code insert, COA pick, AI rewrite payload, undo, single owner Send, staff draft-only, plain failure text, unsafe addresses). `tests/request-replies-v1.cjs` adds owner-only send, approved-first claims, chosen original through the send lock, learning rows, rules and codes in AI jobs, desk options without report bytes, and `send_blocked`. `tests/admin-read-recovery-v1.cjs` opens the conversation from its queue row.

Jarvis (`server/services/trybiomodReplies.ts`, `emailWriter.ts`, test file): 26 isolated tests and full TypeScript pass, including one approved send with the matched original, no second send of the same revision, and no provider call when the website refuses the send lock.

## Limits

Sends and AI drafts need Jarvis running and the research mailbox connected. Provider acceptance is not inbox delivery. Live checks of the signed-in desk need the owner's own browser session.

## Follow-up: Delete and Forward (same day)

- Delete asks once, then moves the request to a Deleted view (left out of All); Restore brings it back. Reply history stays preserved, and a deleted request cannot be replied to until restored.
- Forward sends the customer's message, recent thread and an optional note to one chosen owner or active staff member through the site's existing mail provider. The forwarder is the reply-to address; the customer is never a recipient. Forwards are recorded (migration `0026_request_forwards.sql`) and shown in the conversation. Cap: 100 per day.
- Tests: `tests/request-forward-v1.cjs` (team-only recipients, reply-to, failure recorded) and Delete/Forward cases in `tests/request-desk-v1.cjs`.

## Follow-up: requested reports are always attached (same day)

Owner instruction after a HEAT-R 20mg reply was staged saying "Attached" with no PDF: an earlier send of the same original (old COA automation or a previous reply) no longer withholds the attachment. The draft gets the exact verified original again and its COA note says it was emailed before. The only remaining duplicate guard stops two replies with the same report to the same customer from sending at the same moment. The validate step no longer refuses a report that was sent once before.

## Follow-up: Archive and activity record (same day)

- A reply accepted by the mail provider archives its request (status `resolved`, attributed to the Jarvis reply bridge). A customer follow-up returns it to To reply; drafting or sending on an archived request takes it out of the archive.
- Views are now To reply, Archive (archived plus replied), Spam, Deleted and All. "Mark done" is now "Archive".
- Each conversation shows an Activity record built from existing private data: received, every archive/spam/delete/restore with who did it (change history), each reply sent with the PDF attached, customer follow-ups, and forwards with notes. No new table.
