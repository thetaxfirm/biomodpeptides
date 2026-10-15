# Requests desk: simple reply box, October 15, 2026

Scope: trybiomod.com admin only. Author: Claude, at the owner's request: "this is not working. too confusing. simply. if I want to write a message just make it easy. if we replied, let me know."

## What was wrong

- After a reply was sent, the sent text stayed in the editable box with an active Send button, so a sent reply looked unsent. The only sign it went out was small grey text ("Sent 3:28 PM. Accepted by the mail provider." and "Last reply sent 3:28 PM").
- Seven extra controls sat on screen at all times: the AI instruction box, Dictate, Rewrite, Tailor, a "remember" checkbox, three insert/attach menus, and the win-back template list.

## Behavior

- **A sent reply empties the box.** The draft model seeds an empty body when the latest reply is `sent` (`seedBody`), and the clean-draft sync uses the same seed, so the sent text is never pushed back in. Unsent drafts and AI drafts keep their text exactly as before.
- **A clear replied line** sits directly above the box: "✓ You replied <time>", covering desk replies, Gmail replies found by Jarvis and logged phone/text replies, plus "they wrote back since" when the customer answered after. The sent message itself shows in the conversation as before.
- **Box, then Send.** The placeholder names the customer ("Write your reply to Albert…" / "Write a new message to Albert…"). Send sits right under the box; Save draft is a quiet link.
- **Everything else under one toggle**, "More options: AI help, discount codes, COA, win-back emails". It opens itself for COA requests, while the AI is writing, during dictation, and when an AI instruction is typed. No capability was removed; Enter in the AI box still asks the AI.

## Verification

`npm run check:release`: TypeScript and 86 isolated suites, all passing. New `tests/reply-simple-v1.cjs` checks the seed rule (sent → empty, ready → kept, revision preserved), the sync comparison, the replied line, removal of the old ambiguous status lines, Send before More options, and that every tool is inside More options with the auto-open conditions. The existing request-desk, request-replies and COA UI suites pass unchanged. `BIOMOD_DEPLOY=true npm run build` passes.

The real component and stylesheet were also server-rendered locally with synthetic `example.invalid` data (outside the repository) and screenshotted in three states: draft ready, after sending, and More options open.

## Affected

`/admin?tab=requests` reply pane only (`components/store/request-inbox.tsx`, `request-inbox.module.css`). No API, database, email or customer-facing change.

## Release

Recorded after deployment below.
