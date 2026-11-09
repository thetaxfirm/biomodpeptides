# Shared CRM with Biomod Pro: release v1

November 8, 2026. Owner direction: Biomod Pro gets the same store engine as TryBiomod, and "we want the CRM to be attached for both to be one."

## What changed on TryBiomod

- New D1 database `biomod-crm` (id `3c29e535-3975-4ccb-bca8-690ddd87641b`), bound as `CRM` to this Worker and to the Biomod Pro Worker (`biomodpro-store`). It holds contacts only: email, name, phones, and per store the contact sources, order counts, paid totals and first/last seen. Orders, addresses and everything else stay in each store's own database.
- `lib/shared-crm.ts` (identical in both stores) publishes a store's contact list into the CRM, skips unchanged rows, and merges both stores by email. `lib/crm-capture.ts` holds the one store-specific line, `CRM_SITE`.
- Contact capture (`captureContact` in the store route, affiliate tax profile) also writes the contact to the CRM straight away. Best effort: a CRM failure never affects the visitor.
- The `*/5` scheduler copies the full contact list into the CRM at most once an hour (`publishOnSchedule`). It only reads this store's database; its run time lives in the CRM (`crm_publish_log`), so it adds nothing to Change History.
- Admin > Contacts now shows both stores: a Store column (TryBiomod, Biomod Pro, with order counts), a Store filter (either store, or customers of both), and a Stores column in the CSV. If the CRM cannot be reached, the tab shows this store only and says so.
- Internal only. Nothing in the CRM is shown to customers or used to send messages.

## Checks

- `npm run check:release`: TypeScript and 122 suites passed, including new `tests/shared-crm-v1.cjs` (publish, skip-unchanged, cross-store merge, single capture, hourly limit, store guard, wiring). `coa-routes-v1`, `promo-checkout-v1` and `change-history-system-v1` stub the CRM capture the same way they stub contact capture.
- `BIOMOD_DEPLOY=true npm run build`: Worker `biomod-peptides`, routes trybiomod.com and www.trybiomod.com, crons unchanged, bindings `DB` (biomod-peptides) and `CRM` (biomod-crm).

## Live verification

- Commit 16b1637 pushed to main; Workers Builds deployed version a89941f7 at 01:35 UTC Nov 9 with the CRM binding (read back from the Worker settings).
- trybiomod.com /, /shop and /admin/login return 200 after deploy.
- First scheduled publish ran on its own: crm_publish_log shows trybiomod with 91 contacts published (25 with paid orders), 0 unchanged.
- Not yet seen: the signed-in Contacts tab with the Store column. That needs the owner signed in; nothing else depends on it.
