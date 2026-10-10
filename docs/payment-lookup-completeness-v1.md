# Settled payment lookup completeness v1

Date: 2026-10-10
Author: Codex
Base commit: 4c8d6ee
Scope: TryBiomod Authorize.net lookup limits only.

A settled transaction search previously discarded batches beyond the first 40 and returned after five full transaction pages. Those partial results could incorrectly imply no matching payment, or miss a second capture. The hosted-payment route relies on that verification before requesting another payment form.

The adapter now raises the existing sanitized `TOO_MANY_RESULTS` error when more than 40 batches are returned, or when the fifth fetched page of any batch is still full. No payment state is inferred from these incomplete searches. Exactly 40 batches remain supported, and a shorter terminal page, including an empty fifth page, completes normally. An exactly full fifth page is conservatively incomplete because the current bounded lookup has not observed a terminal page. Limits, offsets, provider selection, payment classification, owner/environment checks and order/inventory behavior are unchanged.

The existing GET payment handler catches the error, displays that payment status could not be confirmed, links to orders and does not issue a hosted payment token. This change makes no claim about any particular customer's order or payment.

## Files

- `lib/authorizenet-payments.ts`
- `tests/payment-lookup-completeness-v1.cjs`
- `docs/payment-lookup-completeness-v1.md`

## Verification

The new regression reproduced both omissions against unchanged base code: the 41-batch case and the full fifth-page case resolved instead of rejecting. Its fixtures exercise the actual adapter and actual GET payment handler with injected HTTP; live network and database mutations are blocked. Boundaries include the 40th batch, 41 batches, a full fifth page, a shorter and empty fifth page, a cap reached after an earlier capture, complete pending/paid/failed/review classifications, and hosted-form suppression after incomplete, paid or under-review results. Complete no-match behavior is checked with an isolated hosted-token fixture only.

Passed `payment-lookup-completeness-v1.cjs`, `payments-authorizenet-v1.mjs`, `payments-v1.mjs`, `hosted-payment-error-v1.cjs`, `order-receipt-v1.mjs`, `npx tsc --noEmit --incremental false` and `git diff --check`.

Implementation is ready for coordinated release; it has not been committed or deployed by this task. No production requests, order changes, account changes or real emails were performed. The three pre-existing inventory drafts remain untouched.
