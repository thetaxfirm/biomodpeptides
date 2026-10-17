# Free USPS Priority at $250, same-day cutoff, shipping schema (Oct 17, 2026)

Owner request (chat, Oct 17 2026): free USPS Priority Mail on orders of $250 or more; show the threshold and same-day cutoff on product pages; full merchant shipping schema.

- Author: claude-agent (owner request). Source commit da848db, pushed to main; Workers Builds version 113ee783 (2026-10-17T20:08Z).
- Before: the store offered only USPS Priority and Priority Express (no standard service), so the $200 free-standard threshold never applied and the site said "shown at checkout".
- Runtime change: production D1 `settings.store.freeShippingAt` 20000 to 25000, written inside a `change_context` row; `change_events` records actor "claude-agent (owner request: free Priority at $250)", before 20000, after 25000. `change_context` emptied afterward. Set before the push so the new code never offered free Priority at $200.
- Code: with no standard service on, the threshold makes USPS Priority Mail free (cheapest eligible rate); Express is never free. Checkout, saved-option validation and stale-quote checks share `freeShippingService` / `freeEligible`. Product buy box adds the published cutoff for in-stock items. Cart names the free service. Admin note explains which service becomes free.
- Schema: Organization `hasShippingService` now named "USPS Priority Mail", with `handlingTime` (0-1 business days, Mon-Fri, cutoff 14:00 Pacific with the current offset) and `transitTime` 1-3 business days from the USPS Priority catalog estimate. Offers keep `shippingDetails` by reference. Return-policy fields were not changed (owner decision still open).
- Tests: check:release passed (TypeScript + 92 suites); new cases in shipping-services-v1 and merchant-policies-v1. Production build passed.
- Live checks (read-only): /product/bpc-157-10mg shows "USPS Priority Mail is free on orders of $250 or more after discounts and before tax." and the 2 p.m. Pacific line; header banner "Free USPS Priority Mail on orders of $250 or more."; JSON-LD as above; /shop 30/30 requests returned 200.
- Gaps: no live checkout or label purchase was run (smoke checks are read-only). The free Priority quote path is covered only by isolated tests with mocked EasyPost. The admin Shipping live check was not viewed signed in.
