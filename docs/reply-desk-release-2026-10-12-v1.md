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

## Follow-up (Oct 13): email order customers, issue tracking, rules per issue

- Orders → order panel → **Email customer** opens (or reuses) one desk conversation per order. Order context (number, date, items, preorder flag, status) is staff/AI-only: shown as an internal note, never quoted to the customer (Jarvis omits the quoted-inquiry block for order conversations). The subject is "Your BioMod order #…".
- Each conversation can be tagged with what it is about (out of stock, website problem, COA, shipping, refund, wrong/damaged, product question, partner, vendor, other), how it was handled (wait, refund, store credit, substitute, discount, replacement, answered, other) and a case note. Migration `0027_request_issues.sql`.
- **Issues & rules** groups every tagged case by issue with a tally of how each was handled, and holds rules per issue plus general rules. AI drafts get the general rules, that issue's rules and the owner's decision for the case.
- Tests: `tests/request-cases-v1.cjs`; desk cases for order notes and tagging; Jarvis test that order notes never reach the customer email (27 Jarvis tests).

## Follow-up (Oct 13): report a problem on an order (hold)

- Orders rows get **Report problem**; the order panel gets a "Report a problem" form (what is wrong + note) and, on a held order, **Clear hold**. Reporting stores `data.hold` on the order (audited), opens the order's desk conversation tagged with the issue, and sends nothing.
- A held order shows "On hold: <issue>" with **Email customer**, sits in Needs review, and cannot have a label bought (`app/api/admin/shipping` claim refuses) or be marked shipped/delivered (`admin-order` refuses) until cleared.
- New resolution: "Free item of their choice if they wait", so the AI can write that offer.
- Tests: hold/clear, bucket, label-claim refusal in `tests/request-cases-v1.cjs`; `tests/orders-mark-shipped-v1.cjs` loader maps the shared issue list.

## Follow-up (Oct 13): win-back emails for unpaid checkouts

- Unpaid order rows get a **Win back…** menu with five templates. Choosing one opens (or reuses) the order's desk conversation, tags it "Did not finish checkout" and puts the template in as a staff draft. Nothing is sent until the owner presses Send. Order conversations show the same five templates on the side (Use, then Tailor asks the AI to fit it to the customer while keeping codes and links).
- Templates (`lib/win-back.ts`): Need a hand? (service first), Your order is saved (reminder + lot-matched lab reports), 10% off to finish (code BM10, used on a fresh checkout because a code cannot be added to a started order), Personal note from Ash, Last reminder. No invented deadlines or scarcity.
- The existing automatic recovery email (one email after 24 h, 7.5% off the saved order) is detected: the order note and the templates mention the saving already applied, so offers do not conflict.
- Research basis: Klaviyo's abandoned-cart benchmarks (a short sequence: reminder, then incentive, then a final note) and Baymard's checkout-abandonment reasons (extra costs, payment trust, friction). Most "2026" subject-line statistics online are secondary and directional only.

## Follow-up (Oct 13): come-back codes

- Owner request: add COMEBACK30, plus more like it. `lib/promotions.ts` now also accepts COMEBACK10, COMEBACK15, COMEBACK20, COMEBACK25 and COMEBACK30 (server-owned, case/space normalized, applied after pack/sale prices like every other code, not advertised on the site, reusable by anyone who has the code).
- They appear in the desk's Insert code menu, in Affiliate & promo codes reporting, and the AI may offer them when asked. The Win back menu now has one offer email per come-back code (10/15/20/25/30%) in place of the single BM10 offer.
- Checks: `tests/promo-checkout-v1.cjs` verifies exact totals and case/space variants for all five new codes; `tests/promo-analytics-v1.cjs` lists all ten active codes; `tests/request-cases-v1.cjs` checks every code used in a template is an active code.

## Follow-up (Oct 13): reply status at a glance

Owner feedback (relayed by the Orders session): he could not tell who had been answered; Archive mixed replied and never-replied items; times were unlabeled; supplier pitches sat with customers.
- Tabs: **Needs reply** (default, oldest first), **Replied & archive**, **Sales pitches**, Spam, Deleted, All. Switching tabs clears a conversation that does not belong to the new tab.
- Every row and the conversation header state one thing: "Needs reply" (with "AI draft ready", "draft saved", "AI is writing" or "Customer wrote again") and "Received Oct 13 · waiting 3 days" (red after a day), or "Replied Oct 13, 12:57 PM from research@" / "in Gmail from research@" / "by phone/text · ash@", or "Closed without reply · Oct 13 by ash@".
- Replies sent outside the desk count: Jarvis checks the Gmail mirror of every connected mailbox every 2 minutes for sent mail to an open requester after the request arrived (drafts, older mail and the desk's own sends excluded) and records it (migration `0028_request_external_replies.sql`). The text appears in the conversation. **Mark as replied** records phone/text answers with an optional note.
- Supplier pitches (manufacturer, wholesale, OEM, price list, "high quality peptides", SARMs…) are kept out of Needs reply as "Looks like a sales pitch", with "Not a sales pitch" / "Yes, a sales pitch" to correct it. Tagging the issue overrides the guess.
- Fix: issue tags saved in a conversation were not reloaded by the live refresh; they now are.

## Follow-up (Oct 14): one customer, one conversation; daily "waiting" alert

- Requests from the same email (any letter case) show as one row ("3 requests") and one conversation containing every message. A reply (desk, Gmail or Mark as replied) to any of them counts for their earlier ones; a desk send archives all of that customer's open requests sent before it; Archive/Spam/Delete/Restore act on the whole conversation. The AI sees the customer's earlier requests.
- A queued draft whose request was closed meanwhile is set aside (`request_closed`) instead of blocking the Jarvis queue.
- Daily digest (`lib/reply-overdue.ts`, from the existing 5-minute schedule): after 8 am Pacific, once a day, one email to the owner notification address (COA settings notifyTo, else the first owner) listing customers waiting over a day with no reply, grouped by email; sales pitches, answered, phoned and closed requests excluded; nothing is sent when nobody waits. Internal only.

## Follow-up (Oct 14): several COAs on one reply; plain reply status

- A reply can carry up to five original COA PDFs (`coa_choice` holds comma-separated hashes; first is the primary). Every extra is verified like the primary (approved original, intact PDF hash, same-moment duplicate guard). The claim sends `extraAttachments`; validate requires `extraSha256s` to match exactly; Jarvis writes, re-verifies and attaches each PDF (`extra_json`) and refuses a tampered one. The desk's Attach COA PDF adds reports one at a time with Remove.
- Wording: rows and headers now say "Not replied yet" (plus "reply ready to send in Jarvis" / "AI is writing a draft") or "Replied <date>, then they wrote again". Supplier pitches stay in Sales pitches even after we replied; pitch detection also catches "raws", "raw materials", "high purity".
