# Requests desk: readable conversation, October 16, 2026

Scope: trybiomod.com admin only. Author: Claude, at the owner's request: "super confusing. have no idea what was sent. or who replied. make it more understandable."

## What was wrong

- Each sent email was labelled "You, from research@ (reply desk)". It never said who pressed Send, who it went to, or what was attached.
- The status line read "Replied Oct 14, 12:05 AM from research@", even for order conversations where we wrote first.
- The case-tagging form (issue, eight checkboxes, case note) sat between the header and the emails, so the actual email was pushed below the fold and an empty checkbox row looked like "nothing was done".
- The thread was a 300px scroll box inside the page.

## Behavior

- **Plain summary at the top**: e.g. "We emailed once. Our last email: Oct 14, 12:05 AM, sent by <person>." then "<Name> has not written back. Nothing to do unless they do." Turns amber with "...is waiting for an answer" when the customer wrote last.
- **Every email is labelled**: "<Name> wrote" / "You emailed <Name>" with the date, then "From research@biomodpeptides.com to <customer> · Sent by <person> · Subject: ...", and "Attached: <report>" when a PDF went with it. Gmail replies say "Sent in Gmail from <account>"; logged calls say "Logged as answered by phone or text by <person>".
- **List rows name the sender**: "You emailed them Oct 14, 12:05 AM by <person>" (order conversations) or "Replied ... by <person>".
- **Case notes folded** under "Case notes for the AI (only you see these)", with the chosen issue and handling shown on the folded line.
- Thread is no longer a nested scroll box.
- Order note retitled "Order behind this conversation (only you see this)". Composer line reads "Already emailed <time>. Anything you write here goes out as a new email."

## Data

`lib/request-replies.ts`: outgoing thread messages now carry `from`, `to`, `subject`, `sentBy` (the draft's `approved_by`) and `attachment` (report filename), read by joining `request_reply_messages.reply_job_id` to `request_reply_drafts`. No schema change. The AI job payload sent to Jarvis keeps the old four-field history shape.

## Verification

`npm run check:release`: TypeScript and 86 isolated suites pass. `tests/reply-simple-v1.cjs` and `tests/request-desk-v1.cjs` updated for the new wording. `BIOMOD_DEPLOY=true npm run build` passes. The real component and stylesheet were bundled locally with synthetic `example.invalid` data (outside the repository) and checked in the browser for an order conversation we started and a contact conversation where the customer wrote again.

## Affected

`/admin?tab=requests` only: `components/store/request-inbox.tsx`, `request-inbox.module.css`, `lib/request-replies.ts`. No customer-facing or email change.

## Follow-up the same day: "is this done or not?"

Owner, on an archived order conversation seen under All: "I replied to this person many times, why is he still here... did he reply? what am I to do?"

- The summary now opens with a bold verdict: **Needs your reply.** / **Waiting on <name>.** / **Done. Nothing to do.** (archived) / Deleted / Spam / Sales pitch / Sending now, each with one line on what to do. Archived ones say they move back to Needs reply on their own if the customer writes.
- List rows for answered conversations start with "Done ·" (archived) or "Waiting on them ·", so the All tab shows at a glance which ones are finished.
