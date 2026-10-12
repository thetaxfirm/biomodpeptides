# Unpaid checkout recovery and test classification

Owner direction: identify the pictured checkout as an internal test; show unpaid checkouts accurately; send one recovery reminder after one day with an additional 7.5% after existing discounts. Author: Codex, October 12, 2026. Parent revision: 943897c6d159f5a51eb3ebc610b5e5264d0f6ba6. TryBiomod only.

## Behavior

- Authorize.net's complete no-match lookup now means an unpaid checkout. Fraud review, uncertainty and unsuccessful transactions require review. Provider proof remains required for paid status.
- Explicit internal-test classification stays in the private order record, preserves original financial history, appears in admin, excludes fulfillment attention and sales/promo aggregates and never receives recovery mail. Only the exact owner-identified existing record was classified; no customer identities or records belong in this release log.
- Recovery is prospectively activated through `settings.checkout_recovery_v1` with an activation timestamp. Historical checkouts are excluded. Migration 0018 defaults it off until the deployed build is verified.
- The existing five-minute Worker schedule runs COA and recovery independently. Recovery processes bounded candidate/job batches. Eligible live unpaid checkouts must be at least 24 hours old and have no payment-form issuance within the last 24 hours. Internal tests, administrators, paid/review orders, presales, unavailable products, unsubscribed recipients and orders older than the existing seven-day payment window are excluded. At most one recovery per order and one per recipient per week; daily cap 100.
- The additional 7.5% is applied to saved merchandise line amounts after existing pack/sale/promo discounts, rounded to cents and allocated exactly. Existing promo attribution and original shipping remain. Tax uses the same calculation as normal checkout. An immutable original snapshot is retained privately alongside the recovery job. No completed purchase is repriced.
- Offer preparation and payment-form issuance compare the saved snapshot. Reconciliation compares the verified amount before recording payment. A late payment with an older amount is held for reconciliation, never silently accepted as payment of a changed total. The reminder asks the customer to close older payment pages.
- One immutable email payload and idempotency key per order; retry only within 23 hours of the first attempt, capped at three attempts. Ambiguous expired delivery outcomes require manual review. Before each attempt, payment is rechecked. Provider acceptance is not inbox delivery.
- The email links to authenticated My orders, where the updated total and additional savings are visible. No new cart or transferable public code. Unsubscribe is anonymous and token-bound; GET is read-only and POST performs the opt-out. Transactional order/shipping updates are unaffected.
- Admin Orders shows activation and scheduler health, per-order recovery savings and the outbox outcome. Customer view, merchant receipt, paid-order email, sales diagnostics and promo CSV reflect the same saved data and classification.

## Validation

`BIOMOD_DEPLOY=true npm run build` passed TypeScript and 36 isolated suites, then built the production Worker. Additional `tests/checkout-recovery-worker-v1.mjs` passed against the actual compiled Worker using local D1 and intercepted Authorize.net/Resend calls. Coverage includes every active promo, exact 24-hour eligibility, additional savings, tax, immutable receipt data, payment race guards, test/paid/held exclusions, unknown delivery retry, opt-out and duplicate prevention. Existing COA route/scheduler fixtures retain isolation from the added scheduler.

Affected routes: `/admin?tab=orders`, `/account/orders`, `/api/store/pay`, `/api/store/reconcile`, `/payment/return`, `/api/recovery/unsubscribe`; protected sales and promo reports/CSV. Runtime changes: additive private migration, one owner-confirmed test classification, prospective activation. No live purchases, payment submissions or test emails are part of verification.

Deployment identifier, deployed checks and activation evidence are recorded in the private release receipt after publication. Inbox delivery and conversion outcomes remain unverified until actual eligible customer events occur. Source and live build completion are separate checks.

Provider reference: https://developer.authorize.net/api/reference/features/accept-hosted.html (hosted form tokens preserve the issued transaction details). Email opt-out and accurate sender guidance: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business.
