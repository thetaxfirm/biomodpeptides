# Request forwarding outcome repair - October 13, 2026

Author of this repair: Codex. Scope: TryBiomod only. Reviewed from shared main b4edbf385afd99f56b9a4e10b54d92c92e383a4a after fetching; the unrelated dirty SEO checkout was preserved.

A lost mail-provider acknowledgement previously marked a team forward failed. Retrying created a fresh idempotency key and could send a duplicate. The repair retains a durable unresolved lock for the same request and recipient, including concurrent staff attempts and edited notes. Timeout, 408/409, server error, malformed success and post-provider status-write failure display an unconfirmed outcome. Only a definite client rejection becomes failed and can retry. An already accepted forward can still be intentionally repeated.

The existing database sending state is projected as unknown in the protected API and activity record. No schema migration, historical status rewrite, automatic unlock or real email occurs in this release. An unresolved attempt requires provider investigation before its lock can be resolved; the UI does not provide automatic reconciliation. Provider acceptance remains distinct from inbox delivery.

Affected code: lib/request-forward.ts; app/api/store/[action]/route.ts; components/store/request-inbox.tsx. Consumers: /admin?tab=requests, POST /api/store/admin-request-forward, POST /api/store/admin-request-replies. Prices, inventory, orders, customer replies and COA selection are unchanged.

Validation: production build with the required TypeScript and 68-suite release gate; focused source and actual component tests; focused actual built-Worker regression in tests/request-forward-worker-v1.mjs using isolated D1 and intercepted synthetic auth/mail. Regression cases include acceptance followed by lost response or failed status persistence, atomic concurrent claim, repeat blocking, definite rejection retry, accepted repeat and anonymous read/write denial. No production send is used to verify delivery.

Release source revision, provider deployment/version, live read-only checks and limitations are recorded in the private dated Daily Review Receipt and 30-Day Scorecard v29 under the approved BioMod-SEO-Sprint generated-document folder. GitHub checks are tied to the exact release commit. Cloudflare's current credentials expose deployment/version metadata but not direct version-to-Git-SHA attestation; do not equate timing with cryptographic source proof.
