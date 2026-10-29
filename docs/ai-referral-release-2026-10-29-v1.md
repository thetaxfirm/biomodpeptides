# Old-domain redirects and product name variants, October 29, 2026 v1

Author: Claude, taking over the TryBiomod SEO and AI-referral campaign from Codex (owner request). Source commit `454d6a6` on main, rebased onto the daily sprint's `3bfeb2d`/`aa79426` with both redirect sets kept. Workers Builds (`ef6851da-8590-40c6-80dc-b4a558cf594f`) and release-check succeeded.

## Evidence

Owner-authorized DataForSEO research (807 calls, $41.08; raw files outside the repository in `AI Workspace/Documents/Generated/2026/10/TryBiomod-AI-Referral/research-v1/`):

- No trybiomod.com result in Google top 100 or Bing top 50 for 56 product-name queries, and none in 355 ChatGPT, Gemini, Perplexity and Google AI Mode answers to product-purchase prompts. Branded prompts already resolve to trybiomod.com.
- Google `site:` lists ~33 trybiomod.com URLs and ~2,880 old biomodpeptides.com URLs; Bing returns none for `site:trybiomod.com`.
- 87 old-domain URLs observed in Google's index were tested: 58 ended in a 404 after the domain move.
- AI prompts with buy intent use spelling variants (MOTSc, SS31, Epithalon, AOD9604, PT141, TA1, Kisspeptin 10).

## Change

- `lib/legacy-routes.ts`: 58 exact observed URLs redirect permanently to the live page on the same topic. Topics BioMod does not carry go to `/`; held products (GHK-Cu, ERASER) go to `/shop` or `/softgels`, never their held pages. `/locations` stays non-indexable, so `es/locations` goes to `/about`. Unknown paths still 404.
- `lib/product-names.ts` (new), `lib/product-questions.ts`, `lib/seo-policy.ts`: ten eligible listings gain a visible name-variant answer, mirrored in FAQPage data, and the variants in their meta description. Variants are spelling forms or the compound the catalog already states. Kisspeptin has narrower wording because plain kisspeptin also names longer forms.
- `lib/sitemap-lastmod.ts`: those ten pages dated 2026-10-29.
- Tests: `legacy-domain-routes-v1`, `legacy-spanish-routes-v1`, `search-buy-intent-v1` (eligible-only variants, description length, held listings excluded).

No price, stock, SKU, checkout, COA, publication approval or Wolverine/TB-500 hold change.

## Verification

- `BIOMOD_DEPLOY=true npm run build` on the rebased tree: TypeScript and 108 isolated suites passed.
- Live: all 58 former 404s now end in 200 via one 308; unknown `/tag/` and `/es/` paths 404. The ten pages are `index, follow` with four FAQ entries and new descriptions; Wolverine and TB500 remain `noindex, follow` with no FAQ markup and outside the sitemap.
- IndexNow 200 for 32 sitemap URLs at 2026-10-29T07:30:58Z (acceptance, not indexing). Change-history import: 24 events inserted.
- Gaps: no mobile viewport check (layout unchanged); protected admin Changes page not viewed.

## Measurement baseline

D1 `traffic_daily`, complete UTC days Oct 22–28: 1 AI incoming event of about 534 external events (≈0.2%); search arrivals land almost entirely on the home page. No ranking, citation or traffic gain is claimed from this release.

## Owner actions found

- The claimed Google Business Profile "Biomod Peptides" (Las Vegas) still lists biomodpeptides.com as its website; changing it to trybiomod.com removes two redirect hops.
- Bing Webmaster Tools verification and Site Move remain outstanding (see the October 25 AI traffic release).
