# Search migration and sales diagnostics v4

October 8, 2026. Follow-up to the accepted Google domain move and v3 release.

## Former Spanish links

Public search still surfaced four old Spanish storefront addresses. Live checks showed that the old host forwarded their paths to TryBiomod, where they ended in 404 responses. Added only the four verified equivalents:

| Former path | Current English destination |
| --- | --- |
| `/es/` | `/` |
| `/es/product/mots-c-10mg/` | `/product/mots-c-10mg` |
| `/es/product/mots-c-40mg/` | `/product/mots-c-40mg` |
| `/es/coa/` | `/testing` |

These are permanent redirects through the existing exact legacy-route map. Unknown Spanish pages still return genuine 404 responses; no blanket language-prefix removal or guessed product mapping was added. The existing site has no Spanish edition. Current destinations retain their canonical metadata and existing publication eligibility; the ten specification holds and sitemap list are unchanged.

The handler regression uses the real catch-all page and metadata functions, Next permanent redirects/notFound, current catalog and publication policy. It verifies the exact destinations, both slash-form route inputs, unknown paths, and absence of loops. Live HTTP checks separately cover the framework slash-normalization step.

## Sales environment classification

Checkout saves Chase environments as `live` or `sandbox` and Authorize.net environments as `authorizenet:live` or `authorizenet:sandbox`. Diagnostics previously accepted only the bare forms, misclassifying the prefixed orders as Unknown. Both reporting queries now normalize the exact supported values. Malformed JSON, missing modes and unsupported spellings remain Unknown.

Regression fixtures use the actual `paymentEnvironment()` function outputs for both providers. Existing authorization, UTC periods, payment-evidence checks, aggregate-only results and no-store behavior remain tested. No payment processing, order rows, inventory, prices, catalog identity or provider settings were changed.

The four diagnostics SELECT queries were also run against production through the existing Cloudflare administrator access. All completed successfully with zero rows written. Results were reviewed privately; order amounts and activity counts are not included in this repository. This was an aggregate database check, not a customer payment test or provider reconciliation. Real-customer versus internal-test classification still requires the owner’s confirmation.

## Remaining dependencies

Approved policy text, manufacturer/lab specifications for held products, payment reconciliation and the owner’s order classification remain outstanding. Two backlink requests now have verified contact channels but remain unsent pending explicit send authorization. Google’s migration requests have been accepted; indexing and ranking results remain unproven.

## Production verification

Published Worker version `7fb63e93-5cda-4335-b013-9cd822674834`. All 24 tested source variants (four aliases, with/without trailing slashes, across old apex, old www and the current domain) end at their exact expected current page with HTTP 200. Two unmatched Spanish routes retain HTTP 404. The first immediate post-deployment pass saw a transient old 404 response; the failed path then returned its intended 308, and the complete repeat passed.

The live audit confirms 24 sitemap URLs, 16 Product offers and ten specification holds. All 50 catalog records retain names, strengths, SKUs, prices, pack prices, inventory and purchase availability. A browser visit to the original `/es/coa/` URL reaches the working current batch library. TypeScript, production build, relevant SEO tests, diagnostics regressions and exact legacy-route regressions pass. No live purchase or provider reconciliation was performed.
