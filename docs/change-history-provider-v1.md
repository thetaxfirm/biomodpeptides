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

### Scheduled provider reader

Migration `0046_provider_history_poll.sql` adds only pagination checkpoints and short leases. Apply it before deploying the scheduled reader. It does not modify customer data or rewrite existing history. The Worker keeps the existing daily retention and five-minute operational timers; a separate `7,22,37,52 * * * *` timer performs provider reads without running fulfillment, correspondence or payment jobs.

Each feed claims a four-minute lease. GitHub source history reads at most one 100-row page per invocation, anchored to the first commit SHA so new commits do not shift later pages. Check polling examines the newest 20 main revisions, at most five 100-row check pages per invocation. Large histories resume from the saved page on a later timer. Cloudflare deployment, version and audit feeds each read at most one 100-row page per invocation. Completed history scans wait an hour; incomplete scans and transient failures retry after at least 15 minutes. Rate-limit headers can extend that delay up to a day. GitHub check coverage deliberately remains the recent 20 commits, not all historical checks.

GitHub metadata and check runs work against the public repository without a token. `HISTORY_GITHUB_READ_TOKEN` is optional if public rate limits are insufficient. If supplied, use a repository-restricted fine-grained token with only **Contents: read** and **Checks: read**, and the provider's required Metadata read access. Do not copy the existing GitHub CLI login into the Worker. The original public recent-source REST/Atom fallback and runtime-version observations remain independent.

Cloudflare requires a dedicated optional secret binding named `HISTORY_CLOUDFLARE_READ_TOKEN`. No such binding existed in the verified production configuration when this reader was prepared. The existing Wrangler login does not become a Worker credential. The current official endpoint permission lists accept **Workers Metadata Read-Only** for deployment/version metadata and **Audit Logs Read** for account audit. Restrict the token to the verified TryBiomod account; if the provider offers an individual-Worker metadata permission, narrow the Worker read to `biomod-peptides`. The API also accepts the broader read permissions **Workers Scripts Read** and **Account Settings Read** where the narrower permissions are not available. No write, D1 query, token-management, DNS edit or secret-read permission is required by this poller. Provision and verify any token through the approved provider interface; never paste it into this repository, a document, a chat or a log.

Missing token, HTTP 401/403, rate limiting, malformed metadata and persistence failures are separate unavailable coverage states. A missing Cloudflare reader does not stop public GitHub polling. Cloudflare audit access previously returned HTTP 403 and remains unverified until the dedicated reader succeeds. Account-wide audit pages are filtered before storage to exact TryBiomod Worker/database resource paths or the exact `trybiomod.com` zone, and only mutations are retained. The initial audit scan covers the retained last 30 days; later scans overlap the previous completed window by an hour. Provider retention and late events outside that overlap remain explicit limits.

Events, checkpoint movement and coverage updates commit atomically in D1. A stale lease cannot overwrite another run. HTTP redirects use Workerd-supported `manual` mode and are rejected by status; credentials are sent only to the fixed provider host. Response bodies are bounded and discarded after selecting allowed metadata. Automatic source records use their own immutable IDs so a later CLI import can add exact safe source paths; the history view prefers the richer imported record without deleting either record. Separate scheduled coverage rows preserve the provenance of previous CLI imports.

The default successful runtime observations do not prove that credentials exist or provider polling succeeded. Verify the five scheduled coverage rows after a normal provider timer: `github_commits_scheduled`, `github_checks_scheduled`, `cloudflare_scheduled`, `cloudflare_versions_scheduled`, and `cloudflare_audit_scheduled`. A partial page scan must remain labelled partial until it traverses the available pages. Do not invoke the five-minute business cron as a history smoke test.

## Verification

`node tests/change-history-import-v1.mjs` exercises the actual transformation/import code with isolated SQLite and mocked provider responses: resource boundaries, evidence URLs, attribution labels, exclusion of raw/provider secret data, idempotence, bound SQL parameters, timestamp preservation, and denied-provider coverage. Dry-run output reports only aggregate counts and coverage descriptions.

`node tests/provider-history-sync-v1.cjs` exercises the scheduled implementation with isolated SQLite, fixed public metadata and fixture-only read tokens: anchored pagination, separate check transitions, missing/denied access, retry leases, atomic cursor writes, immutable duplicates, size and redirect bounds, and metadata privacy. No real provider request is made by this test.

## Source documentation

- [Cloudflare audit log structure, permissions and limits](https://developers.cloudflare.com/fundamentals/account/account-security/audit-logs/)
- [Cloudflare Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare Workers Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)
- [Cloudflare D1 query and batch API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
- [GitHub commits API](https://docs.github.com/en/rest/commits/commits)
- [GitHub check-runs API and read permissions](https://docs.github.com/en/rest/checks/runs)
- [Cloudflare deployment metadata API permissions and pagination](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)
- [Cloudflare version metadata API permissions and pagination](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/list/)
- [Cloudflare audit v2 API permissions and cursor pagination](https://developers.cloudflare.com/api/resources/accounts/subresources/logs/subresources/audit/methods/list/)
