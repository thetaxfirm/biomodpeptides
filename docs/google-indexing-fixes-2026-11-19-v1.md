# Google indexing fixes, November 19, 2026 (v1)

Owner request, November 19, 2026: fix the reasons Google Search Console gave for pages not being indexed. TryBiomod only; BiomodPro not edited. Prepared by Claude in the worktree `claude/gsc-indexing-v1`.

## What Google reported

Three Search Console emails arrived on November 19, 2026 (00:04 to 00:27 PT). They name a reason but no URLs.

| Property | Reason |
| --- | --- |
| `https://trybiomod.com/`, all pages | Soft 404 |
| `https://trybiomod.com/`, pages in the sitemap | Soft 404 |
| `https://biomodpeptides.com/` | Blocked due to other 4xx issue |

A fourth email gave the same Soft 404 reason for the `trybiomod.com` domain property. The Search Console connector on this Mac has no Google sign-in, so the affected URL list was not read. The causes below were found by fetching and rendering both sites the way Googlebot does.

## Cause 1: Soft 404 on trybiomod.com

All 83 sitemap URLs return 200 with full server-rendered content, correct canonicals and `index, follow`. Missing pages return a real 404. The fault appears only after JavaScript runs.

`robots.txt` disallows `/api/`. A rendering crawler therefore cannot make the cart and account read (`/api/store/state`) that every page makes on load. Rendered in headless Chrome with the robots-disallowed paths refused (Googlebot smartphone user agent, all 83 sitemap URLs):

- Every page showed the pop-up "Saved cart is temporarily unavailable. Please refresh to try again."
- `/testing` (Batch documents) replaced its server-rendered lot records, about 2,500 words, with "Account and cart access could not load. Please retry." and a retry button: 14 words in `<main>`.

A 200 page whose rendered text is an error message is what Google labels a soft 404. `/testing` is in the sitemap, which matches the sitemap-specific email.

### Fix

- `components/store/provider.tsx`: a failed first read is quiet. It is retried once on the visitor's first pointer or key action and announced only if that retry also fails. Cart, checkout and account pages keep their own persistent error and retry controls.
- `components/store/testing.tsx`, `components/store/quality-guide.tsx`: lots that the server already resolved for the page (or that the last good read returned) stay on the page when a later read fails. With no resolved lot the page still fails closed and never falls back to source documents, as required by the October 12 current-inventory COA rule.
- `robots.txt` is unchanged. `/api/` stays closed to crawlers.

## Cause 2: Blocked (4xx) on biomodpeptides.com

The old domain is still on its original Hostinger host. Page URLs there 301 to trybiomod.com, but that host answers 403 to Googlebot for everything under `/wp-content/`, `/wp-json/`, `/wp-admin/` and similar WordPress paths (a browser gets 200 for the same PDF).

TryBiomod was sending Google to those URLs: the batch library linked 14 original lab reports at `biomodpeptides.com/wp-content/uploads/2026/05/*.pdf`, and every page's data held each product's old-store permalink and image addresses.

### Fix

- The 14 linked reports are now served from `https://trybiomod.com/certificates/` under their original filenames. Each file was fetched from the old host and matched byte for byte against the SHA-256 already recorded in `lib/coas-source-v1.json`. `lib/coa-hosted-files-v1.json` lists them; `lib/testing.ts` moves only the address. No lot, result, date, report number or association changed.
- Three of the 14 belong to products on a publication or specification hold (GLOW 70 mg, TB-500 10 mg, the TB-500/BPC-157 blend). `public/_headers` gives those three `X-Robots-Tag: noindex, nofollow`, the same rule the held KLOW report already follows.
- The seven other certificates in the source record (KLOW 80 mg, NAD+ 500 mg, Selank, Semax, CJC/IPA, Epitalon 50 mg, Tesamorelin) are not linked publicly under the current-lot rule and were not copied.
- The old-store permalink, gallery and image-source fields left page data in commit be48e54 (the scheduled November 19 search run), immediately before this change.

## Tests

- New `tests/store-first-read-quiet-v1.cjs` (in the release gate): actual `StoreProvider` with both reads refused. No error at load; one retry on the first action; one announcement if that fails; nothing armed after a good read; clean-up on unmount.
- `tests/public-batch-consumers-v1.cjs`: resolved lots stay visible through a failed read, loaded or not; no resolved lot plus a failed read still shows the retry state and no lot.
- `tests/certificate-hold-noindex-v1.cjs`: each hosted file is the recorded original (SHA-256), maps to one product, is noindex exactly when its product is held, and no public record or document still addresses a moved report on the old host.

## Not done, and why

- The old host still answers 403 to Googlebot for WordPress system paths and for the seven unlinked certificates. Those are not pages to index. Stopping the 403s, or redirecting the 14 old PDF addresses to their new home, needs the owner's Hostinger sign-in.
- Search Console "Validate fix" needs the owner's Google sign-in. Google re-crawls on its own schedule either way; the report usually takes one to three weeks to clear.
- `/terms-of-sale` still ends "These storefront terms are a review draft for the rebuilt site." and several policy pages are 60 to 90 words. Thin pages are a second, weaker soft-404 risk. Copy is the owner's decision and was not changed.

## Release evidence

- Commit 579d8bc on main (pushed `f4da909..579d8bc`). `npm run check:release`: TypeScript and 137 isolated suites passed. `BIOMOD_DEPLOY=true npm run build`: exit 0.
- GitHub `release-check` success and Cloudflare `Workers Builds: biomod-peptides` success on 579d8bc. Live Worker version 373d63a8, deployed 2026-11-19 22:31:32 UTC (14:31 PT).
- Same Googlebot-style render of all 83 sitemap URLs, before and after, robots-disallowed paths refused:

| | Before | After |
| --- | --- | --- |
| Pages showing error wording | 83 of 83 | 0 of 83 |
| `/testing` rendered words in `<main>` | 14 | 497 (lot records collapsed, as for visitors) |
| HTTP status | 200 on all | 200 on all |

- All 14 hosted reports return 200 `application/pdf` to a Googlebot user agent and match their recorded SHA-256. The three held-product reports return `X-Robots-Tag: noindex, nofollow`; the other 11 do not.
- `/testing` as Googlebot: 0 links to biomodpeptides.com (14 before), 19 distinct certificate links on trybiomod.com, 0 old-domain strings anywhere in the HTML. `/product/bpc-157-10mg`: 0 old-domain strings (45 after be48e54, 195 before it).
- Ordinary browser visit: `/testing` shows 52 records, no error or pop-up; `/product/bpc-157-10mg` shows "Add to cart" enabled, the certificate link at `/certificates/BPC-157_10-mg.pdf`, and no console errors.

Not verified: adding to cart, checkout and admin were not exercised live (the isolated suites cover them). The forced-failure path for a real visitor (first read fails, retry on first action) was tested in isolation, not live. Whether Google has re-crawled is not visible without the Search Console sign-in.
