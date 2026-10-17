# Store contact address switch, 2026-10-16 (v1)

Owner request: customer-facing store email comes from contact@trybiomod.com. trybiomod.com now has Google Workspace MX records, so the mailbox receives mail.

## Owner access (unchanged)

The owner's existing sign-in address stays in `STORE_ADMIN_EMAILS`. For about an hour on Oct 16 it was replaced by contact@trybiomod.com in error; the owner reported it and the original list was restored the same evening. contact@trybiomod.com is not an owner sign-in.

## Runtime settings

| Where | Setting | Now |
| --- | --- | --- |
| Worker `biomod-peptides` | `STORE_ADMIN_EMAILS` | Original owner list, unchanged |
| Worker `biomod-peptides` | `ORDER_NOTIFY_EMAILS` | Original recipients plus contact@trybiomod.com |
| D1 `settings.coa_delivery_v1` | Customer reply-to (COA, tracking, checkout recovery) | contact@trybiomod.com |
| D1 `settings.coa_delivery_v1` | COA staff notification | Owner address, unchanged |

## Code (this release)

- Default From for store email (orders, tracking, COA, checkout recovery, overdue alerts, forwards) is `BIOMOD <contact@trybiomod.com>` instead of no-reply@. No `*_EMAIL_FROM` override is set on the Worker.
- Reply desk sender is contact@trybiomod.com (lib/request-replies.ts, desk labels). Jarvis sends desk replies from the connected contact@trybiomod.com mailbox.
- Migration 0032 rebuilds `request_reply_drafts` so the sender check allows both mailboxes; sent history keeps research@biomodpeptides.com and unsent drafts move to contact@trybiomod.com. Triggers and index are recreated unchanged.

Rollback: revert this commit's lib/components changes; the widened sender check is harmless to keep.
