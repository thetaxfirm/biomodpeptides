# Catalog staff role release — 2026-10-30

## What changed

The owner asked for an assistant role that can keep product pricing and lab reports current without
seeing anything else. A new staff role, **Catalog**, holds one permission, `catalog:write`.

- **Can change:** product price, fixed 3/5/10 pack prices, timed sales, and the lot number and
  lab-report (COA) link on each product. Can open the private original report from the editor.
- **Cannot see or change:** orders, customers, requests, reports, settings, presales, rewards, promos,
  affiliates or staff. The dashboard load returns no orders to this role.
- **Stock is locked server-side.** On a Catalog save the server keeps the current availability,
  preorder, in-stock, purchasable, stock quantity and maximum quantity, whatever the request sends,
  and refuses release review. The editor shows those fields read-only with a note.
- Owner and manager also hold `catalog:write`, so their product editing is unchanged. The Products
  tab content is now gated on `catalog:write` rather than `store:write`.
- `admin-coa-original` accepts `catalog:write` or `requests:write` (Support keeps access for replies).
- Migration `drizzle/0034_staff_catalog_role.sql` rebuilds `staff` so its role CHECK allows
  `catalog`, copying every row and recreating the three `audit_staff_*` triggers from 0020.

No one was given the role. The owner assigns it in Admin → Team.

## Source and deployment

- Author: Claude (owner-approved Oct 30 2026). Commit `3b11629`, fast-forward over `8e1e1ec`
  (the Support `requests:send` work, kept intact during rebase).
- Pushed 2026-10-31 04:52 UTC. Workers Builds `biomod-peptides`: success. GitHub `release-check`:
  success. Deployed version `82edf9f5-4106-41c9-b669-d09ba5a49e4d` at 04:55:26 UTC.
- Files: `lib/staff.ts`, `lib/auth.ts` (`requireStaffAny`), `lib/staff-store.ts`,
  `app/api/store/[action]/route.ts`, `components/store/admin.tsx`,
  `components/store/admin-products.tsx`, `drizzle/0034_staff_catalog_role.sql`,
  `scripts/release-check.mjs`, tests listed below.

## Tests

- `npm run check:release`: TypeScript and 113 isolated suites passed; `BIOMOD_DEPLOY=true npm run build` passed.
- New `tests/catalog-role-v1.cjs`: permission matrix, migration on isolated SQLite (rows preserved,
  no history events on copy, triggers kept, owner refused), route and UI gates, Products tab gate.
- Updated: `product-availability-v1` (Catalog save keeps stock/availability), `product-batch-admin-v1`,
  `pack-price-admin-v1`, `staff-access-v1`, `admin-password-setup-v1`, `coa-routes-v1`.

## Live verification

- D1 `d1_migrations` latest: `0034_staff_catalog_role.sql`.
- `staff` after migration: one active manager, one active support (counts only); role CHECK includes
  `catalog`; triggers `audit_staff_delete`, `audit_staff_insert`, `audit_staff_update` present.
- `https://trybiomod.com/` 200, `/shop` 200, `/admin` 307 to sign-in, `/api/store/admin` unauthenticated
  returns "Please sign in to continue."
- `node scripts/change-history-import-v1.mjs --remote` ran; GitHub, Cloudflare and Cloudflare
  versions sources active.

## Gaps

- No authenticated live check of a Catalog session: nobody holds the role yet. Behavior is covered by
  the isolated suites above. Check once the owner assigns it.
- Cloudflare account audit and Vercel remain unavailable to change history, as before.
