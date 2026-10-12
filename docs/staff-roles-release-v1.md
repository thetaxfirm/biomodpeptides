# Staff roles for store administration, October 12, 2026

Owner chose this to give a team member limited backend access instead of full administration. Author: Claude. Base: 696f89d, fetched main in a separate worktree (`claude/staff-roles-v1`); collaborator checkouts untouched.

## Roles

| Role | Tabs | Can |
| --- | --- | --- |
| Owner | All, plus Team | Everything. Owners are the `STORE_ADMIN_EMAILS` runtime setting, unchanged; only Cloudflare can add or remove an owner. |
| Manager | All except Team | Orders and shipping, requests and COAs, settings, products, prices, presales, rewards, reports. |
| Fulfillment | Orders | View orders, buy labels, record tracking and delivery, re-check payments. |
| Support | Orders, Requests | View orders, re-check payments, work the request inbox and send original COAs. No shipping, store edits or reports. |

Owners add, change and remove staff in the new Team tab. A staff member then uses "Set or reset your admin password" at /admin/login with their own address. Removal takes effect on the next request; there is no cached role.

## Enforcement

The server checks the role on every admin call (`requireStaff(permission)` in `lib/auth.ts`, permission table in `lib/staff.ts`). The admin payload omits sections a role cannot use (requests and COA status, presales, search report, team). The UI hides tabs and shipping/COA-settings controls using the same table, but hiding is not the control. A staff lookup failure, a missing staff table, a removed row or an unknown role all deny access. Owners resolve from the runtime setting without a database read.

Order-copy emails and checkout-recovery exclusions still use `STORE_ADMIN_EMAILS` only, so staff do not receive every paid order by email.

## Data

Migration `drizzle/0019_staff_access.sql` adds `staff` (manager/fulfillment/support only, normalized email enforced by CHECK) and append-only `staff_audit`. Additive; no existing table changes. Applied by the existing Workers Builds deploy command. No customer records, secrets or runtime settings changed.

Affected: lib/staff.ts, lib/staff-store.ts, lib/auth.ts, app/api/store/[action]/route.ts, app/api/admin/shipping/route.ts, app/api/metrics/report/route.ts, app/api/metrics/shopping-report/route.ts, app/[...path]/page.tsx, app/auth/return/route.ts, components/store/admin.tsx, components/store/team-admin.tsx, db/schema.ts, drizzle/0019_staff_access.sql.

## Validation

TypeScript, all 37 isolated release suites (new `staff-access-v1.cjs`; extended `admin-password-setup-v1.cjs` and `admin-landing-v1.cjs` with per-role allow/deny, fail-closed lookup and staff landing) and the gated production build passed. No new lint findings in changed files. Existing route tests now stub `requireStaff` as an owner. No live sign-in, password email or staff row was created. Authenticated verification of the Team tab and a limited role needs the owner's signed-in browser.

## Live deployment

Commit 5f6cb71 deployed by Workers Builds (build caf7855d, Worker version a31795e6, 100% at 2026-10-12T20:06Z); GitHub release-check passed. Read-only checks: production D1 has `staff`, `staff_audit` and `staff_audit_created`, with zero staff rows. /, /shop and /admin/login return 200. Signed-out calls to the admin payload, the shipping API and the new `admin-staff` action are refused, and no row was written. Not yet verified: the Team tab and a limited role while signed in, which need the owner's own browser session.
