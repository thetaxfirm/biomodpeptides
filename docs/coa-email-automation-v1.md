# Original COA email automation v1

Prepared October 11, 2026 UTC. Base commit `d1f4c4c`.

## Behavior

Contact and affiliate forms continue saving requests in the existing administrator queue. When enabled, new contact/affiliate requests also enqueue a short administrative email with an admin link. Customer text is not copied into that alert, and older requests do not generate a notification backfill.

COA requests matching an explicitly approved product, strength, form and lot enqueue the unchanged original laboratory PDF. Unknown requests or conflicting report versions require review. The initial registry is a verified subset, not the full catalog. Each attachment retains its original scientific identity and is checked by SHA-256 before sending. A report is sample-specific and is not evidence of the lot actually shipped or of suitability for human use.

Admin → Requests adds COA settings and email status. Admin reads never send. Manual processing accepts only a stored request ID and processes that request's COA; it cannot supply an arbitrary recipient, document or generic alert. Email-provider acceptance is shown separately from delivery and from the existing request review status.

## Storage and delivery

The shared GitHub repository is public. Original report bytes and detailed source provenance are therefore excluded from Git and from both client/server deployment bundles. Migration `0016_coa_delivery.sql` adds private D1 tables for approved originals and operational email records. Report metadata is read without PDF content; a full approved original is retrieved by its hash only at send time. No public download endpoint was added.

Mail uses the existing Resend secret binding without exposing its value. The fallback sender is `BIOMOD <no-reply@trybiomod.com>`. Reply-to and request-alert destinations are owner-controlled settings. Existing order-notification configuration is preserved.

The five-minute Worker cron processes at most five due emails per invocation. Atomic claims, an immutable payload and idempotency key, recipient/report deduplication, up to five bounded retries, and a 23-hour safe retry cutoff protect against duplicate or ambiguous sends. Unknown outcomes remain for review. New COAs are capped at 100/day and three per recipient/day; generic alerts at 50/day. Operational correspondence is not visitor analytics. The existing daily traffic-retention cron is preserved.

## Validation

- Actual API-handler authorization, same-origin checks, contact persistence despite queue errors, honeypot handling, validated configuration and manual COA-only scope.
- Actual admin component, requester mapping, readable statuses, duplicate relationships, unsaved-form/read/owner protections and isolated browser clicks.
- Synthetic original PDF integrity, exact lot/size/form matching, private-registry boundaries, SQLite concurrency, quotas and immutable retries.
- Actual built Worker + isolated Miniflare D1: original attachment verified, one mocked provider acceptance, repeated cron does not resend, disabled settings do not send, daily metrics cleanup preserved. No live test customers or test emails.
- Production build, TypeScript and diff checks passed. 188 client and 101 server build files scanned: no original-report base64 prefixes, hashes or source filenames.

No orders, payments, inventory, prices, catalog publication holds, BiomodPro settings or customer request text/status were changed by this feature.

## Operations

Apply migration 0016 before deploying code that reads its tables. Import source-verified originals as disabled private rows, reread and validate their complete decoded bytes, then approve the exact rows. Enable mail only after the production secret binding and intended reply/notification destinations are confirmed. Existing matching requests require a deliberate one-time enqueue; the cron never scans history to generate new work.

If an email is accepted, do not resend to troubleshoot delivery. Inspect the mail provider's delivery/bounce evidence first. A missing original, wrong lot, changed catalog form, hash mismatch or ambiguous prior result requires review rather than substitution. To pause automatic sends, disable COA automation in Admin → Requests; existing outbox records are retained.
