# Biomod domain move confirmation

October 8, 2026. User approved verifying the old domain under the Ash account and submitting the move to TryBiomod.

## Confirmed external state

- Google Search Console ownership verified for `https://biomodpeptides.com/` by HTML file.
- The `https://www.biomodpeptides.com/` property auto-verified using the same HTML file.
- Both Change of Address requests target `https://trybiomod.com/`.
- For each request, Google passed its homepage 301 redirect and ownership checks. After Confirm Move, the page states “This site is currently moving” with the correct source, destination and start date of October 8, 2026.
- This confirms accepted requests, not completed recrawling, ranking transfer, visitors or sales.

## Hostinger change

Created `/public_html/googlecfdf6da9aff93def.html` on the old domain with the public Google verification content already retained in this repository under `public/`.

Added exactly one exclusion to the existing forwarding conditions:

```apache
RewriteCond %{REQUEST_URI} !^/googlecfdf6da9aff93def\.html$
```

All other forwarding and WordPress rules remain unchanged. No DNS, email, file permissions, catalog, COA content or application code was changed. A fresh domain-scoped file-manager session resolved the expired prior session; no blanket file-permission reset was run.

Configuration snapshots and public HTTP results are in `docs/domain-move-evidence/`. Keep the verification file and exception in place so Google can recheck ownership. Do not deploy these Hostinger snapshots as application assets.

## Checks

- Apex and www verification-file GETs: HTTP 200, exact verification token after whitespace trimming, no redirect.
- Apex and www homepage GETs: HTTP 301 to `https://trybiomod.com/`.
- Representative old product path: HTTP 301 preserving its path on TryBiomod.
- Existing BPC-157 laboratory PDF: HTTP 200, `application/pdf`.
- Before/after configuration comparison confirms only the exact verification-file exception was added.

Google confirmation screenshots were saved locally at `/tmp/biomod-google-domain-move-confirmed-v1.png` and `/tmp/biomod-google-www-move-confirmed-v1.png`. They were displayed to the owner; account-interface screenshots are not committed to the repository.

## Follow-through

Keep the domain, verification and redirects operational. Continue reviewing indexing and search performance as data becomes available. Do not cancel either accepted move unless intentionally reversing the migration. Existing laboratory downloads remain on their original paths to preserve document references.

Google references: [Change of Address](https://support.google.com/webmasters/answer/9370220) and [site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes).

Backlink requests remain unsent. Verified publisher contact channels and the remaining contact gap are recorded in `backlink-contacts-v1.md`; exact requests are in `backlink-corrections-v1.md`.
