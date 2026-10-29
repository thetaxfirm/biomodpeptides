# Old-domain trailing-slash redirect fix

October 29, 2026, approximately 01:27 PDT. Executed by Codex using the owner-authorized Hostinger session. This is an old-domain hosting configuration change, not a TryBioMod application deployment.

## Change

In biomodpeptides.com public_html/.htaccess, changed only the forwarding RewriteRule capture from `^(.*)$` to `^(.*?)(?:/+)?$`. Destination remains `https://trybiomod.com/$1` and status remains 301. This removes trailing slashes during the old-domain redirect instead of requiring a second redirect at the destination. All existing host/method/query exclusions, Google verification exception, WordPress and original laboratory-file routes remain unchanged. Query strings are preserved. No DNS, email, SSL or customer data changes.

Saved using Hostinger File Manager, then cleared hosting cache and flushed the active Hostinger CDN cache. Cached plain-path requests initially returned the old rule; after CDN flush they returned the new rule. Existing snapshot docs/domain-move-evidence/hostinger-htaccess-after.txt is the rollback source; updated configuration is hostinger-htaccess-2026-10-29.txt in the same folder.

## Live verification

Recorded in docs/domain-move-evidence/redirect-checks-2026-10-29.json:

- HTTPS apex and www /shop/: one 301 directly to https://trybiomod.com/shop, then 200.
- HTTPS /product/bpc-157-10mg/ and /faq/: one 301 to the same slashless path, then 200.
- Query parameters remain intact.
- Google verification file on both hosts: 200, zero redirects, exact expected public token checked by GET.
- Original BPC-157 laboratory PDF: 200 application/pdf.

Scope limits: HTTP requests still pass through Hostinger's existing HTTPS-enforcement redirect before the domain move. Renamed paths such as /coa/ still use the application's existing /coa to /testing mapping and take two redirects overall. This change eliminates the trailing-slash hop; it does not claim every historical URL has a one-hop mapping.

Claude's TryBioMod SEO and AI-referral campaign chat was explicitly asked to independently verify these results and avoid concurrent edits. The prior source checkout was clean and fast-forwarded to shared main e556978 before recording this runtime change. Required repository checks/build results and the independent verification outcome are recorded below when complete. No application-source edits were made.

## Completed checks

- npm run check:release: passed TypeScript and 109 isolated suites.
- BIOMOD_DEPLOY=true npm run build: passed, including the repeated release gate. No local application build was deployed for this hosting-only change.
- Claude independently checked the same 19 baseline URLs at 08:28:19 UTC: final destinations/statuses preserved, targeted slash hops removed, exact verification content preserved. Claude also reported 87 harvested legacy URLs ending in 200: 26 one-hop, 61 two-hop deliberate renamed-path redirects, no remaining trailing-slash anomalies. Independent detailed baseline and after results are in ~/Projects/trybiomod-seo-toolkit/reports/redirect-chain-{before-2026-10-29,after-hostinger}.json.
- Runtime deployment evidence is the saved Hostinger rule and public HTTP results above; Hostinger does not expose an application commit/version for this .htaccess edit.
