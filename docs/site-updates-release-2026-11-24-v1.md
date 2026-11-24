# Website updates release — 2026-11-24

## What changed

The owner asked for one staff member to be in charge of picture, lab report (COA) and cosmetic
changes on trybiomod.com, by telling the site's assistant what to do. A plain upload button was
ruled out after inspection: product pictures are fitted to measured frames and gallery views, and a
public COA carries structured lab data and a lot match. A request box keeps that care in place.

- **Admin > Website updates.** A chosen staff member writes the change, picks the product, gives the
  lot for a COA, and attaches files (PDF, PNG, JPG, WEBP, GIF, HEIC; 16 MB each, six per request).
  The request shows Received, In progress, Live, Question for you, or Waiting for the owner, with
  the reply written on it. Owners see every request.
- **Admin > Team.** A per-person "Website updates" switch, separate from the role. Owners always
  hold it. Removing a person's staff access ends it.
- **Lane.** `docs/site-updates-lane-v1.md`: pictures, COAs and wording are done directly. Prices,
  stock, policies, claims and settings wait for an owner's Approve on the request.
- **Desk tool.** `scripts/site-updates.mjs` lists, shows, downloads, claims and finishes requests.
- **Fix.** The Team tab could not save the Catalog role: the staff save action's role list predated
  it. It now accepts every assignable role.

Nothing on the public storefront changed. Migration `0038_site_updates.sql` adds four tables and
touches no existing table or record.

## Source and deployment

- Author: Claude (owner-approved Nov 24 2026). Commit `fb802d9`, fast-forward over `c3bde91`.
- Pushed 2026-11-24 20:56 UTC. GitHub `release-check`: success. Workers Builds `biomod-peptides`:
  success. Deployed version `468c073f-3c49-4495-8761-8ab095fc07ce` at 21:01:13 UTC.
- Files: `lib/site-updates.ts`, `lib/site-updates-auth.ts`, `lib/staff.ts`,
  `app/api/site-updates/route.ts`, `app/api/site-updates/file/route.ts`,
  `app/api/store/[action]/route.ts`, `components/store/site-updates.tsx` and its stylesheet,
  `components/store/admin.tsx`, `components/store/team-admin.tsx`, `scripts/site-updates.mjs`,
  `drizzle/0038_site_updates.sql`, `docs/site-updates-lane-v1.md`, tests below.

## Tests

- `npm run check:release`: TypeScript and 140 isolated suites passed, locally and in GitHub.
- New `tests/site-updates-v1.cjs`: the permission belongs to no role; owner-or-granted access and
  denial on lookup failure; file type by extension and first bytes, size and safe names; draft,
  send, question, answer, done, reopen, cancel; storage in pieces with hash-checked read-back and
  corruption refusal; requester isolation; owner-only decisions; open-request cap; database guards;
  route, admin and rules-document wiring; no real addresses in the public repository.
- Updated loaders: `admin-read-recovery-v1`, `coa-routes-v1` (new module registered, no assertion
  changed).
- Migration 0038 applied on its own through `wrangler d1 migrations apply --local`: 10 commands.
- Local built Worker with a stand-in sign-in service and test accounts on 127.0.0.1: signed-out and
  ungranted staff refused (403); owner grant; cross-origin write refused; malformed lot refused; a
  333 KB PDF and a 1.1 MB PNG stored and downloaded byte-for-byte (matching SHA-256); a PNG renamed
  .pdf and an HTML file refused; another staff member could not read or add files. In the browser:
  new request from the form, answer to a question, owner Approve, Team switch, phone width with no
  horizontal overflow.

## Live verification

- D1 `d1_migrations` latest: `0038_site_updates.sql`; the four `site_update*` tables exist.
- `https://trybiomod.com/` 200, `/shop` 200, `/product/tesamorelin-10mg` 200, `/admin` 307 to
  sign-in. `/api/site-updates` and `/api/site-updates/file` return 403 "Administrator sign-in
  required." signed out; a write with no same-origin header returns 403.
- `node scripts/site-updates.mjs list` against production: no requests waiting.
- One staff member was granted Website updates at the owner's direction (grant and access-history
  rows written with the owner-request actor label).

## Gaps

- No authenticated check on the live site: the assistant cannot sign in to the admin. The first
  real request is the live check of the signed-in screen; the local run above used the same build
  path with test accounts.
- Requests are worked by a scheduled task on the owner's computer, hourly from 7:30 AM to 7:30 PM
  Pacific. It does not run while that computer is asleep or the app is closed.
- No alert is sent when a request is waiting for the owner; it shows on the Website updates page.
- BiomodPro is out of scope until its store backend is moved over.
