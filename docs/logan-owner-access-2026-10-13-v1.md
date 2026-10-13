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
