# Shared administration change history, October 12, 2026

Owner request: a separate page showing website, function, pricing, administration and hosting changes with date and actor. Scope is TryBiomod only. Starting revision: 0cc8ef97082ba9e5bad3c634446dc8cfecf4e40e; shared main was fetched and matched before editing.

## Behavior

- `/admin?tab=changes` adds a protected, shared Changes page for existing owner and manager reporting permissions. Search, source and inclusive UTC date filters, local display times, pagination, expandable before/after values and source evidence are read-only. Support, fulfillment, customer and anonymous sessions cannot read this endpoint.
- Migration 0020 records product/price/stock/preorder/sale, settings, campaigns, staff access, selected order/payment/fulfillment/promo fields, request status, rewards, original-report registry and email/recovery state changes. Routine visits, profile contents and payment-form polling are excluded. Private tracking/order detail changes receive redacted indicators. Secrets, message bodies, customer contact/address information and payment references are excluded.
- Context is set and cleared inside the same D1 transaction as each write. Save and history failures roll back together. Returning mutations are included. Direct SQL without authenticated context is explicitly unattributed. Known scheduled jobs and verified webhooks have separate system identities. External shipping actions have durable attempted events and truthful recorded outcomes; mail acceptance is not inbox delivery and a label is not dispatch.
- History rows reject updates, deletion and conflicting replacement. This is application/database protection, not tamper-proof storage against a database administrator who can change the schema. Only existing legacy staff records are backfilled from admin data. Earlier unlogged edits cannot be reconstructed.
- The provider importer preserves original GitHub and Cloudflare source timestamps and evidence with deterministic IDs. It imports code commits, recent exact-commit checks and retained deployment/version metadata. Git author metadata and shared provider identities are labelled as such. It does not invent a person, AI author or code-to-deployment association.

## Coverage limits

Cloudflare is the verified current production host. Account Audit Logs and Builds REST returned 403 with the current login. Exact-commit GitHub build checks are available, but dashboard settings, DNS and secret rotations do not have complete coverage. Vercel is not connected to this history. Imported history updates on an authorized sync; local scheduled runs depend on the computer being awake/online. Existing records remain readable when a source fails.

## Validation and publication

The release gate includes six new isolated history suites covering real SQL triggers/rollback/privacy, UI behavior, route permissions, provider import, shipping actions and system attribution. Relevant compiled-Worker tests cover D1 trigger execution, RETURNING claims, payment/recovery, email and signed carrier callbacks with blocked/mocked external services. No real purchase, email, label or customer record is created for testing.

The dated private release receipt records exact commit, hosted build/checks, production version, migration/import counts, read-only live URLs and verification limits after publication. Runtime catalog overrides, provider bindings and historical purchases must remain unchanged.
