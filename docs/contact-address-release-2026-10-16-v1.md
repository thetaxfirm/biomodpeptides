# Store contact address switch, 2026-10-16 (v1)

Owner request: use contact@trybiomod.com in place of the owner's previous company address for every store and admin email.

trybiomod.com now has Google Workspace MX records, so contact@trybiomod.com can receive mail.

## Changed (runtime only, no code change)

| Where | Setting | Now |
| --- | --- | --- |
| Worker `biomod-peptides` | `STORE_ADMIN_EMAILS` (owners) | contact@trybiomod.com replaces the old owner address; other owners unchanged |
| Worker `biomod-peptides` | `ORDER_NOTIFY_EMAILS` (paid-order copies) | contact@trybiomod.com replaces the old address |
| D1 `settings.coa_delivery_v1` | COA, tracking and checkout-recovery reply-to, COA notify | contact@trybiomod.com |

Other Worker bindings were sent as `inherit` and verified unchanged (28 bindings, 11 secrets).

## Owner sign-in

The old owner address no longer has owner access. First admin sign-in with the new address: /admin/login > Forgot password? sends a set-up link to contact@trybiomod.com.

## Not changed

Test fixtures under `tests/` use the old address as an example owner; they do not send mail.
The reply desk still sends customer replies from its existing Jarvis mailbox until the owner decides otherwise.
