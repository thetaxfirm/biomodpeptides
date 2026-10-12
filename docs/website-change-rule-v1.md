# Website change consistency rule v1

Owner-approved October 11, 2026. Applies to all TryBiomod contributors and all changes: source, images, pricing, stock, promotions, content, admin settings, runtime bindings and deployments. BiomodPro is outside this scope until separately authorized.

## Definition of done

A change is complete only when all affected uses agree with the authoritative data, relevant tests pass, the exact revision is deployed and verified live, and shared GitHub main contains the source. A successful build, a local preview or a Git push alone is not completion. If any check is unavailable, record that gap rather than marking it passed.

## Before editing

1. Fetch shared main, inspect divergence and uncommitted work, and preserve other contributors' edits. Identify the author and commit of intervening changes. Never force-push or replace main with an older checkout.
2. Record the requested change, its authoritative source and its affected products, routes, settings and consumers. Inspect runtime overrides as well as source when relevant. Do not infer current stock, approval or paid status from an old document.
3. Use shared data and components. Do not patch a displayed number or logo in one page while leaving another consumer on an older value.

## Check the whole affected chain

| Change | Required dependent checks |
| --- | --- |
| Product identity, strength, price, stock or sale | Home cards, shop/search, product and alternate-size pages, fixed 1/3/5/10 packs, mixed-pack builder, cart, delivery quote, payment handoff amount, receipt, admin base price and eligible Product schema. Check expiry/disabled/out-of-stock states. |
| Promo or affiliate code | Every enabled code, case/space normalization, Apply/Clear and invalid-code states, pack/sale interaction, cart and delivery totals, saved order attribution, receipt and protected admin report/export. Historic orders are immutable unless a separately authorized correction is required. |
| Logo, label or product artwork | Header/footer, mobile, home/shop cards, search, product gallery, pack builder, cart and share image wherever used. Check proportions, baseline, colors, trademark, sharpness and labels at real sizes. Do not alter original lab documents. |
| Content, links or search metadata | Visible copy, internal links, title/description/canonical, eligible structured data, sitemap/robots and relevant redirects. Retain publication holds; never hide scientific identity to evade review or claim an unverified result. |
| Admin, authentication or analytics | Authorized roles see the same store data; unauthorized users cannot. Verify loading/error states and exports. Separate live/test, paid/pending, events/visitors and gross/net. Never put customer details or credentials in release logs. |
| Forms, COA or email | Saved inquiry, correct owner destination, exact approved original/lot, deduplication/retry, provider status and admin status. Acceptance is not delivery. Test mail with mocks, not real recipients. |
| Runtime/database/deployment | Intended account, Worker, D1 and bindings; required migrations; timers; domains; preserved secrets/settings; rollback path; deployed version and post-deploy smoke checks. No blanket reset or migration replay. |

“Agree” means the correct relationship, not necessarily identical numbers. Admin base price differs legitimately from a timed sale; pack and promo discounts apply in their documented order. A historical receipt uses its saved purchase snapshot, not today's catalog price. Live D1 overrides are authoritative where implemented; never overwrite them with older source defaults.

## Automated release checks

- `npm run check:release` runs the maintained, explicit list in `scripts/release-check.mjs`, TypeScript and whitespace checks. Fixtures are isolated; payment, shipping, authentication and email services are mocked. Historical tests are not blindly globbed into the gate.
- `BIOMOD_DEPLOY=true npm run build`, the existing Cloudflare production build command, runs that same gate before building. Any failure stops this build path. Do not bypass it by invoking the framework CLI directly or deploying old build output.
- GitHub Actions runs the checks on pushes and pull requests. Its result supplements the build gate; it is not branch protection and cannot prevent a privileged person from bypassing the documented path.
- Add or update a focused behavioral regression when a substantive bug or dependency gap is found. Use actual merged runtime records rather than separately hard-coded page values. For runtime/Worker changes, also run applicable built-Worker tests after building, with isolated D1 and mocked providers.
- Maintain this allowlist as behavior changes. Do not remove a failing check merely to publish; fix the defect or document why a test is obsolete and replace its coverage.

## Publish and verify

1. Review the diff and run the checks appropriate to the change. Re-fetch main before a normal fast-forward push; reconcile intervening work without discarding it.
2. Wait for the deployment for that exact commit. Preserve existing runtime configuration. Do not deploy from a stale local build or mark GitHub source as production until confirmed.
3. Reload affected public pages with fresh assets and verify desktop/mobile interactions. Default live smoke checks are read-only. Use `?measurement=off` for QA where supported. Do not create purchases, send forms, process COAs or call real payment providers as a smoke test.
4. For protected admin/payment/email behavior, use an authorized read-only session and isolated tests. An unavailable authenticated check remains a stated gap. Never ask another agent to obtain passwords or write sensitive evidence into Git.
5. Record author, source commit, affected files/URLs, tests, deployment/version, time, observed result and outstanding gaps in a dated release log. Runtime-only changes need an audited record of nonsecret settings and confirmation that public/admin consumers reflect them; customer records and secret values stay private.

## Ongoing review

The existing daily TryBiomod sprint checks changes by any contributor against this rule, including runtime changes that Git cannot see. Compare shared main, deployed build/version, nonsecret settings and affected public surfaces; use protected aggregate diagnostics when available. Investigate discrepancies, preserve valid newer work, and fix verified regressions within the owner's authorization. Notify the owner of material failures and unverified dependencies. Do not claim continuous monitoring or unseen changes were checked. The sprint retains its existing November 8 end date; the repository rule and push/PR checks continue afterward.

## Shared Changes page

`/admin?tab=changes` is the protected shared history for owners and managers. Application changes are recorded atomically with authenticated staff or known system attribution; direct database writes without operation context are explicitly unattributed. Never invent an actor for an older unlogged change. Source commit authors and provider accounts are separate evidence, not proof of which person used a shared account.

After a release, run `node scripts/change-history-import-v1.mjs --remote` using existing authorized provider access and verify the page shows the new source/build/deployment evidence. The scheduled local importer supplements this step; it does not run while this computer is asleep or offline. Preserve append-only records. The page reports source-sync age and unavailable coverage. Cloudflare account audit access and Vercel history remain unverified/unavailable until separately connected; do not label them complete. See `docs/change-history-provider-v1.md`.
