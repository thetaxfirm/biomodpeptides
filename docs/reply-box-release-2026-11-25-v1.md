# Reply box release — 2026-11-25

## What changed

A staff member reported that opening a customer in Admin > Requests starts an AI draft and locks
the reply box until it finishes, so a quick manual answer had to wait. The owner asked that staff
can override it.

- **The AI draft never locks the reply box.** Staff can type their own reply while the AI is still
  writing, and Save draft or Send work on that text straight away.
- **Typed text is never replaced.** When the AI draft finishes after staff have typed, it is offered
  as "Use the AI draft instead", with Undo back to the staff text.
- **Typing first skips the automatic draft.** A box that already holds staff text does not start one.
- A staff save in progress still locks the box, as before. The server already accepted a staff save
  over a pending AI draft, so no server or database change was needed.

Nothing on the public storefront changed.

## Source and deployment

- Author: Claude (assistant), at the owner's request.
- Source commit: `63254ea` on `main`.
- Files: `components/store/request-inbox.tsx`, `tests/request-desk-v1.cjs`.
- Tests: `npm run check:release` passed locally and in GitHub (TypeScript and 140 isolated suites).
  `request-desk-v1` now covers typing during an AI draft, the offered AI draft and its undo.
- Deployment: Workers Builds success, version `1b3c59ac-207b-48ba-8752-e1c8aa7fa9ee`,
  2026-11-25 22:40 UTC.
- Live check: `/` 200, `/shop` 200, `/admin` 307 signed out, `/api/site-updates` 403 signed out.

## Outstanding gaps

- No signed-in click-through on the live admin by the author. The component behavior is covered by
  the rendered-component suite; the first staff use is the live confirmation.
- AI drafts are still written by the owner's local assistant, so they stay slow or stall while that
  computer is asleep. This release removes the wait for staff; it does not make the draft faster.
