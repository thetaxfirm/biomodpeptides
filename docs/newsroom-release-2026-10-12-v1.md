# Newsroom release, October 12, 2026

Author: Claude, at the owner's request for "press releases that AI can find". The same request asked for thousands of invisible keyword phrases on every page; that was declined because hidden text is a spam violation under both Bing and Google guidelines and risks removal from their indexes.

## Change

Commit 7ae2820. `/news` index and one page per release from `lib/press-releases.ts`:

- `/news/biomod-peptides-online-store-trybiomod`: the online store is TryBiomod.com; biomodpeptides.com redirects; products, pack pricing, batch library, U.S. shipping to adults 21+ for laboratory research.
- `/news/guide-to-reading-peptide-coa`: adapted from the unsent October 8 draft (`BIOMOD COA Guide Press Release v1.docx`); the guide's purity/content, sterility/endotoxin and BPC-157 worked-example statements were rechecked on the live page. The batch-library wording was corrected to the categories the live page actually shows.

Each release is a normal public page record: sitemap, `llms.txt` ("News and press releases" section), `NewsArticle` JSON-LD (publisher = the site Organization, datePublished 2026-10-12) and a footer link. No quotes, named people, medical, dosing, ranking or BiomodPro statements; `tests/newsroom-v1.cjs` enforces this. The October 8 retail-expansion draft was not published because it cross-links BiomodPro, which the owner is keeping hidden.

## Verification

- `npm run check:release`: TypeScript and 68 suites. `tests/merchant-policies-v1.cjs` now expects `/news` in the static public set and the release pages in the sitemap.
- Live: `/news` and both releases 200 with no noindex; unknown slug 404; three `/news` URLs in the sitemap; `llms.txt` lists both releases; `NewsArticle` present; desktop render checked.
- IndexNow: 200 OK, 31 URLs, 2026-10-13T06:29Z.

## Open

- Wire distribution (for example EIN Presswire or PR Newswire) is paid and publishes under the company's name; it needs the owner's approval and account. Wire links are usually nofollow; their value is brand mentions that news aggregators and AI assistants pick up.
- New releases: add an entry to `lib/press-releases.ts` only for verifiable news.
