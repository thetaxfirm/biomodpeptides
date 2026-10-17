# TryBioMod affiliate program upgrade

Owner scope: TryBioMod first, adapting the supplied CRM's application, agreement and partner workflow. The supplied CRM seed agreement and rates were demo fixtures; neither was imported as an approved contract or financial promise.

## Behavior

Authenticated account applications require explicit acceptance of versioned program terms and the partner guide. Owners publish the operative text and confirm the contracting company and contact address. Each affiliate receives an owner-set, immutable financial schedule with their own commission rate, payment method and hold. The partner must accept that schedule; no universal rate or hold is assigned. The owner's confirmed standard is a $500 payout minimum and payouts every 30 days, after applicable signed tax paperwork and payment details are complete. Tax forms and banking details are not collected or stored by this feature.

Owners/managers review applicants, assign one existing promotion code, suspend or reject with an audit reason. Existing discount behavior remains unchanged. Referral links use the existing promotion cookie. Order creation snapshots the approved partner, accepted current schedule, rate and hold; sandbox, internal-test and self-referred orders are excluded. No historic attribution or application acceptance is backfilled. Hold timing uses first recorded successful payment rather than subsequent fulfillment changes.

The commission report is an eligibility report, not a payout balance or money-transfer system. It shows up to 1,000 recent attributed orders. Staff reconcile refunds, prior payments, minimums and secure tax/payee documentation before making any manual payout. Staff can hold commissions while a dispute is pending, reduce the eligible product basis for partial refunds, exclude lost disputes or release a hold. Customer disputes alone do not establish affiliate wrongdoing. The legal text provides prospective changes and preservation of earned amounts.

## Surfaces and storage

- `/account`: application, current/accepted agreement, individual financial schedule acceptance, guide, assigned link/code and scoped earnings.
- `/admin?tab=affiliates`: owner publishing/enrollment/schedules, staff application and commission review, activity history.
- `/api/affiliates`: authenticated owner-scoped reads; owner-only legal/financial publishing; existing store-write permission for reviews; same-origin mutations and bounded streamed request body.
- `/r/[code]`: only approved affiliates with current accepted agreement/schedule receive the promotion cookie.
- Legacy affiliate inquiry action returns a reload message instead of bypassing legal acceptance. Historical inquiries remain in Requests.
- Additive migration `0029_affiliate_program.sql`: immutable legal/schedule/acceptance/order history and review state. No customer fixtures or runtime agreements seeded.

## Verification and limits

The final production build passed TypeScript and all 90 isolated release suites. The compiled Worker test `tests/affiliate-worker-v1.mjs` passed against disposable local D1, covering application, owner-only schedule offer, partner acceptance, approval and referral cookie with external services intercepted. Focused lifecycle tests exercise per-affiliate schedule ownership, acceptance before approval, immutable historical order rates, payment holds, self-referrals, sandbox exclusion, refund exclusion and chargeback reviews. API tests cover role restrictions, session-derived acceptance ownership, CSRF and payload bounds. Actual component browser checks use isolated synthetic data, including individual schedule offers; no live form, order, email or payment was submitted.

The editable Word agreement is prepared for the owner's planned attorney review. It is not represented as attorney-reviewed. Deployment identity, source commit and live checks are recorded after publication. Enrollment starts paused until the owner publishes the company/contact agreement and opens applications; each affiliate's financial terms remain for the owner to decide. Secure tax collection, 1099 filing and payout execution remain external manual operations, not implemented integrations.
