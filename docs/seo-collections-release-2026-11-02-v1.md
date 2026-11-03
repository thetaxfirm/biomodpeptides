# Search release: shop collections by research area, November 2, 2026 (v1)

Author: Claude, at the owner's request ("Yes, build them": indexable category pages).

## What shipped (3e4b3f2)

- `/collections` and seven `/collections/<slug>` pages in `lib/collections.ts`, each grouping published products by what the compounds are, not by any outcome:
  - Growth Hormone Axis: CJC-1295 No DAC, Tesamorelin, AOD 9604, Run & Gun.
  - Mitochondrial Research: MOTS-c 10/40 mg, SS-31 10/50 mg, NAD+.
  - Neuroscience Research: Semax, Selank, DSIP.
  - Melanocortin Research: PT-141, KPV.
  - Coenzymes and Antioxidants: NAD+, Glutathione.
  - Thymosins: Thymosin Alpha-1, TB-500.
  - Research Blends: Run & Gun, Wolverine 10/20 mg, KLOW, GLOW.
- **Indexing rule:** a collection is indexed only while two or more of its products are published (`publishedCollection`). Thymosins and Research Blends stay `noindex` until TB-500 and the blends are released; they then index with no code change.
- **Page contents:**
  - the standard shop product cards, so items can be added to the cart from the page;
  - a CAS, formula and molecular weight table linking each compound reference page;
  - links to the other collections.
- **Markup:** CollectionPage, ItemList (the collection's indexable products) and a three-level BreadcrumbList.
- **Links in:**
  - product pages, in the "buy" answer;
  - the `/compounds` hub;
  - the footer ("Shop by research area").
- No peptide, dosing or handling wording. The intros restate structural facts from the compound reference pages.
- Not yet in any collection: BPC-157, Epitalon, GHK-Cu and Kisspeptin-10 (their only fit is a grouping by outcome). BPC-157 and GHK-Cu join Research Blends through Wolverine, KLOW and GLOW once those are released.

## Verification

- `npm run check:release`: TypeScript and 118 isolated suites passed, including the new `tests/collections-v1.cjs`. `BIOMOD_DEPLOY=true npm run build` passed.
- Static render with the site CSS at 375 px: no horizontal page overflow.
- **Live:**
  - The five public collections and `/collections` return 200 with `index, follow`, CollectionPage, and ItemList counts of 4, 5, 3, 2 and 2.
  - Thymosins and Research Blends return 200 with `noindex, follow`.
  - The sitemap grew from 58 to 64 URLs.
- **Live click in the built-in browser:** MOTS-c 10 mg on `/collections/mitochondrial-research` opens `/product/mots-c-10mg`, which links back to the mitochondrial research collection.
- IndexNow: 64 URLs, 200 OK, 2026-11-03T00:59:51Z. `change-history-import-v1.mjs --remote` ran.
