# Google indexing fixes, November 27, 2026 (v2)

Follow-up to `google-indexing-fixes-2026-11-19-v1.md`. Owner request, November 27, 2026: finish the Search Console work now that the Google sign-in is available. TryBiomod only; BiomodPro not edited. Prepared by Claude in the worktree `claude/gsc-indexing-v2`.

## What Search Console shows (domain property trybiomod.com, last update November 22)

Read in the signed-in browser. This is the first time the affected URL lists were visible.

| Reason | Pages | Reading |
| --- | --- | --- |
| Soft 404 | 0 | Cleared. One page was flagged for a few days around November 19 and dropped after the v1 release. |
| Excluded by noindex | 242 | Three groups, below. |
| Page with redirect | 24 | Correct: trailing-slash, `www` and `http` variants of live pages. |
| Not found (404) | 4 | Junk addresses with a `:xxxxx` suffix and one old `/es/tag/` path. Correct. |
| Duplicate without user-selected canonical | 4 | Four lab reports moved here on November 19. Fixed below. |
| Discovered, currently not indexed | 8 | Four collection and four compound pages Google has not crawled yet. |
| Crawled, currently not indexed | 1 | The held GLOW 70 mg report, which is noindex on purpose. |

Indexed: 64. Validation was already started on November 26 for every open reason, so there was no Validate Fix button left to press.

### The 242 noindex addresses

1. **Meant to be noindex (most of them).** Tracking and cart parameters (`?universally_switch=source`, `?add_to_wishlist=`, `?product=`, `?category=`), private pages (`/account`, `/login`, `/checkout`), held products (HEAT line, KLOW 80 mg, Wolverine, GLOW 70 mg and others), and unpublished pages (`/multi-pack`, `/presales`, `/international-partners`).
2. **Stale: 19 sitemap pages Google last read while they were still on hold.** `/privacy-policy`, `/terms-of-sale` and 17 product pages (sprays, softgels, CJC-1295 No DAC, GHK-Cu, Run & Gun, Acetic Acid). Last crawled between October 9 and November 9. All 19 return 200 with `index, follow` today and are in the sitemap. Nothing to change on the site; Google has to read them again.
3. **A site fault: permanent redirects sent with a noindex header.** Old addresses such as `/about-biomod`, `/coa`, `/es/tag/...`, `/tag/...`, the old Las Vegas blog paths and `/product-category/...` answer 308 to the right page, but the proxy also set `X-Robots-Tag: noindex, follow` on them because the old path is not a published page. Google filed them under noindex instead of "Page with redirect", so it was not following them and nothing those old addresses earned reached the new pages. About 75 of the 242 are of this kind.

## Changes

- `proxy.ts`, `lib/legacy-routes.ts`: a path that the catch-all page redirects permanently (the 166-entry legacy table, plus `/about-biomod` and `/coa`) now passes through with no robots header. Pages that are not published keep `noindex, follow`; private pages keep `noindex, nofollow`; any other host is still never indexable. `/affiliate-program` is left noindex because it leads to a private account page.
- `public/_headers`: the 11 hosted lab reports of indexable products send `Link: <https://trybiomod.com/certificates/...>; rel="canonical"`. The same files are still reachable on the retired biomodpeptides.com host, which is why Google called the copies here duplicates with no chosen canonical. The three held reports keep noindex and get no canonical.
- New `tests/redirect-no-noindex-v1.cjs` in the release gate: runs the real proxy over all 168 moved addresses, the 83 published pages, private and unpublished pages and a foreign host, and checks the canonical headers against the hosted-file list.

## Release evidence

- Commit 2db12ae on main (pushed `ebe3d22..2db12ae`). `npm run check:release`: TypeScript and 161 isolated suites passed. `BIOMOD_DEPLOY=true npm run build`: exit 0.
- Live, fetched as Googlebot after deployment:

| Address | Before | After |
| --- | --- | --- |
| `/coa`, `/about-biomod`, `/es/tag/sonication`, `/las-vegas-guide-to-glow-peptides-for-research` | 308 with `X-Robots-Tag: noindex, follow` | 308, no robots header |
| `/multi-pack` | 200, `noindex, follow` | unchanged |
| `/account` | 200, `noindex, nofollow` | unchanged |
| `/product/bpc-157-10mg` | 200, no robots header | unchanged |
| `/certificates/BPC-157_10-mg.pdf` | 200, no canonical | 200, canonical to itself |
| `/certificates/GLOW_70-mg.pdf` | 200, `noindex, nofollow` | unchanged |

## Search Console actions

Indexing was requested through URL Inspection, one page at a time, until Search Console answered "Quota Exceeded". Each of these ten showed "Indexing requested":

`/product/solara-melanotan-ii-spray`, `/product/glow-spray`, `/product/klow-spray`, `/product/ignite-pt-141-oxy-spray`, `/product/cjc-1295-no-dac-10mg`, `/product/run-gun-10mg`, `/product/ghk-cu-50mg`, `/product/flux-nad-spray`, `/product/apex-semax-spray`, `/product/forge-bpc-157-spray`.

Refused by the daily limit and still to request: `/product/equil-selank-spray`, the five softgel pages (BIONIC, CHISEL, DELTA, ERASER, SCULPTOR), `/product/acetic-acid-solution-1`, `/privacy-policy`, `/terms-of-sale`.

IndexNow (Bing) was resubmitted after the release.

## Not done, and why

- The remaining stale pages and the eight "Discovered" pages wait on Google's daily request limit or on its own crawl. They are all in the sitemap, so they will be read without a request; a request only moves them up the queue.
- The intended noindex group stays in the report permanently. That is the report working as designed, not an error.
- The old Hostinger host still answers 403 to Googlebot for WordPress system paths (see v1). Unchanged; needs the owner's Hostinger sign-in.
