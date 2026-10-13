# Owner-reviewed customer replies v1

Scope: TryBiomod only, October 12, 2026. Baseline shared main: d91594d0ca035e84316bb35e708dc74597fada7f.

The Requests tab replaces mailto with an inline AI/staff reply editor beside each customer's name and issue. The original inquiry, draft, exact COA facts, previous mail-provider status and recorded conversation remain visible together. Staff can prepare drafts, but only Ash's existing Jarvis Ready to Send workflow sends them. The sender is the connected research@biomodpeptides.com mailbox.

## Review and matching

- Original COAs require an exact approved product, strength/form, lot, registry association and intact PDF hash. No fuzzy match, renamed identity, rewritten PDF or arbitrary attachment is permitted.
- Missing or ambiguous originals produce review/clarification drafts without an attachment. Prior accepted and uncertain legacy sends are preserved and prevent automatic duplicate attachments. Provider acceptance is never described as inbox delivery.
- A private, authenticated pull bridge lets Jarvis claim preparation jobs. It does not expose Jarvis, confer staff access to Ash's mailbox, or provide a customer-send endpoint.
- Draft revisions are optimistic and leased; stale revisions cannot send. The final owner-click check binds sender, recipient, original hash, request snapshot and outgoing body to a one-use send lock. Concurrent lot, registry, request or duplicate-send changes reject that lock atomically. Unknown provider results require review rather than resend.
- Sent/received message records are immutable. Exact-account, exact-provider-thread customer followups use the existing full-body Gmail cache; unavailable message bodies are not fabricated from snippets. The original inquiry and recorded history appear with the proposed reply.
- New website requests queue draft preparation after persistence. Refreshing admin does not resend messages. Old direct COA sends are retired server-side, including old admin tabs, the post-response callback and scheduled queue processing. Staff request alerts retain their separate provider.

## Changed consumers

Admin Requests, protected request API, customer inquiry persistence, COA alert/outbox processor, private reply/COA audit metadata, and the local Jarvis Ready to Send integration. Product, cart, pricing, stock, checkout, order records and BiomodPro are outside this change.

Source authorship: Codex contribution in this task; deployment/provider accounts and authenticated staff remain separately attributed. Migration 0024 adds private reply tables and non-identifying audit/eligibility triggers. It does not rewrite orders, products or original reports. Runtime pricing/stock fingerprints are captured before and after deployment in the external release receipt.

## Verification and limits

The storefront release gate, isolated real-SQLite reply/auth/race tests, UI draft/conflict tests, and actual built-Worker response/scheduler tests run without external mail. Jarvis has separate isolated bridge tests and full TypeScript checks. No test sends a real customer email.

Jarvis must be awake, running and connected for preparation and mailbox followup sync. A queued request is not a ready draft. An accepted send is not inbox delivery. Exact deployment identifiers, final check counts, live draft evidence and any deployment blocker are recorded in the dated release receipt; this document alone does not establish deployment.

## Final handoff refinements

Unsaved inline reply bodies and AI instructions survive an admin tab round-trip. Owner changes, lost permissions and sign-out clear the protected draft. Preparation failures use actionable language and never appear ready. Jarvis retains sanitized preparation phase/category diagnostics across idle polls; no customer text or secret is recorded in that diagnostic status. The exact seven-file Jarvis contribution and baseline/current hashes are archived under `docs/integrations/`, without committing unrelated shared Jarvis work.

Linked website drafts also retain validation through Open in compose and bulk Ready sending. Provider-draft export, scheduled sending and generic-send copies of protected original COAs are blocked. A newer acknowledged draft supersedes an older pending revision without rewriting sent or uncertain history. The final Jarvis checks cover 24 isolated regressions and TypeScript.
