# Owner access for logan@biomodcompounds.com

Date: 2026-10-13
Author: Claude
Scope: TryBiomod runtime setting only. No code, database or secret changed.

## Owner request
Give Logan full store admin access (previously Manager).

## Change
Production Worker `biomod-peptides` (serves trybiomod.com): `STORE_ADMIN_EMAILS` changed from
`chris@biomodcompounds.com,ash@biomodcompounds.com` to
`chris@biomodcompounds.com,ash@biomodcompounds.com,logan@biomodcompounds.com`.
Applied through the Workers settings API with every other binding sent as `inherit`.

`ORDER_NOTIFY_EMAILS` is set separately (Chris only), so Logan does not start receiving every paid-order email.
His existing Manager row in `staff` stays; the owner check runs first, so he resolves to Owner.

## Verification
Readback: 28 bindings before and after; only `STORE_ADMIN_EMAILS` differs. New version
ae7e552e-54e2-4103-a504-527b0119580c deployed 2026-10-13T23:04:54Z. trybiomod.com `/` 200,
`/admin/login` 200, `/admin` 307 to sign-in.

## Rollback
Set `STORE_ADMIN_EMAILS` back to the prior value above, or roll back to version eeedadc3-ee1a-4a7b-8db0-0ae6ec4153ab.

## Follow-up, same day: owner order emails
Owner request: Ash receives the paid-order email too. `ORDER_NOTIFY_EMAILS` changed from
`chris@biomodcompounds.com` to `chris@biomodcompounds.com,ash@biomodcompounds.com`. Readback: 28 bindings,
only `ORDER_NOTIFY_EMAILS` differs; `/` and `/admin/login` 200. Rollback: restore the prior value.

## Follow-up, same day: Logan can ship directly
Owner request: Logan changes trybiomod.com from his own Claude the same way the owner does.
User-owned repos cannot grant a collaborator Admin, and ruleset bypass is admin-only, so the
`pull_request` rule was removed from ruleset 24951226 ("protect main"). `deletion` and
`non_fast_forward` stay. Logan (write) can push to main; Workers Builds deploys main.
Contributors still follow docs/website-change-rule-v1.md. Rollback: re-add the `pull_request` rule
(1 approval). Cloudflare: Workers Platform Admin invite for Logan to be sent by the owner from the
dashboard; the agent's token cannot invite members.
