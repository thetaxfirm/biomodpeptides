# TryBiomod provider change history v1

The protected administration change-history page combines application audit events with provider evidence. It covers TryBiomod only. It does not establish that one person operated a shared provider account, and a source revision is not proof that the revision reached production.

## Provider import

Run from the TryBiomod source repository with its existing GitHub CLI and Wrangler login:

```sh
node scripts/change-history-import-v1.mjs --dry-run
node scripts/change-history-import-v1.mjs --remote
```

The default is a dry run. `--remote` inserts sanitized evidence into the production D1 `change_events` table and updates `change_history_sync` only after those inserts succeed. Apply the table migration first. It never changes hosting permissions, environment variables, inventory, prices, customer orders, or provider settings. Credentials remain in the existing login mechanism and process memory. They are never printed or copied into the repository, files, logs, or database.

The account, Worker, database and GitHub repository are fixed in the script to the verified TryBiomod resources. Do not change these identifiers to inspect another business in this workflow.

### Captured evidence

- GitHub's current `main` commit history, paginated until exhausted (bounded at 10,000 records). The commit time, SHA, Git author/committer metadata, linked GitHub account when supplied, signature-verification boolean and safe source file paths are retained. Local Git supplies paths only for an exact commit already present; otherwise the UI points to GitHub evidence and marks path detail unavailable. Commit messages/bodies are excluded because historical messages can contain customer details or credentials. Summaries describe affected code areas.
- GitHub/Cloudflare check results for the newest 20 commits, with the exact commit SHA and provider evidence URL. This is deliberately partial check-history coverage. Check status transitions are separate records. A successful check is not a customer payment, carrier handoff, or inbox-delivery test.
- Cloudflare's retained Worker deployment and version metadata, following pagination instead of relying on Wrangler's default ten rows. Deployment records keep exact version traffic allocations. A version upload does not imply deployment. The account reported by Cloudflare is shown without guessing which human or assistant used it.
- When permitted, Cloudflare Audit Logs v2 for the last 30 days. Only exact TryBiomod Worker/database paths or the exact `trybiomod.com` zone survive the resource filter. Request bodies, responses, raw SQL, IP addresses, tokens, and configuration values are excluded. Platform event metadata is useful evidence, but cannot reconstruct every field's previous value.

Event IDs are deterministic and imports use a parameterized `INSERT ... SELECT ... WHERE NOT EXISTS`: rerunning preserves the first recorded evidence rather than rewriting history. Existing IDs are counted as preserved in the aggregate result, even if later metadata differs. The database immutable-record guard remains in force. A provider outage or access failure updates coverage to unavailable; it is never reported as zero changes. Existing history remains available.

## Verified access and limits, October 12, 2026

- GitHub read access works through the existing CLI login.
- Cloudflare deployment/version APIs work through the existing Wrangler login. The initial read exposed 198 retained deployments and 202 versions; these counts are an observation, not a permanent total.
- Account Audit Logs v2 returned HTTP 403/code 10000. Direct dashboard, DNS and platform-setting changes therefore **are not fully covered** with the current login. Cloudflare requires Account Settings Read or Write to read this endpoint. No token or permissions were created or changed by this implementation.
- The Workers Builds REST endpoint also returned HTTP 403. GitHub's Cloudflare check-runs supply independent exact-commit build evidence; the importer does not invent a direct association between a Cloudflare deployment and a GitHub SHA based on timing.
- TryBiomod's verified current production runtime is Cloudflare Workers and D1. Vercel is marked **not connected** to this history, not “no changes.” No Vercel project or BiomodPro setup was changed.
- Shared credentials and self-reported Git names cannot reliably distinguish Ash, Chris, Logan, Codex or Claude. Application events use authenticated staff identity. Provider/Git records explicitly name their different evidence basis. Unrecorded historical admin edits cannot be retroactively assigned to a person.

## Ongoing synchronization

Run the import after a release and from the authorized local monitoring workflow. The page exposes the last provider-sync time and coverage. It does not claim instant provider capture or continuous unattended execution merely because the command exists. If a monitoring run cannot authenticate, it should report the missing coverage rather than changing access permissions. On a machine that is asleep or offline, the local monitor cannot run.

An eventual server-side integration should use a dedicated, least-privilege provider reader and a narrowly protected ingestion endpoint. Do not copy a developer's broad OAuth token into the Worker. That expansion is not part of this release.

## Verification

`node tests/change-history-import-v1.mjs` exercises the actual transformation/import code with isolated SQLite and mocked provider responses: resource boundaries, evidence URLs, attribution labels, exclusion of raw/provider secret data, idempotence, bound SQL parameters, timestamp preservation, and denied-provider coverage. Dry-run output reports only aggregate counts and coverage descriptions.

## Source documentation

- [Cloudflare audit log structure, permissions and limits](https://developers.cloudflare.com/fundamentals/account/account-security/audit-logs/)
- [Cloudflare Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare Workers Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)
- [Cloudflare D1 query and batch API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
- [GitHub commits API](https://docs.github.com/en/rest/commits/commits)
