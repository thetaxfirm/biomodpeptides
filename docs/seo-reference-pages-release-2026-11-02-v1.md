# Search release: three products released, compound reference pages, November 2, 2026 (v1)

Author: Claude, at the owner's request ("fix our SEO", then "copy the americanpeptides.us and peptira.com tricks").

## 1. GHK-Cu, CJC-1295 No DAC and Run & Gun released from stale holds (390b63d)

All three were noindexed and showed buyers "Confirm the specification with Biomod before ordering".

- GHK-Cu: the hold said its CAS was copper-free GHK. The catalog already carries 89030-95-5, which PubChem (CID 71587328, "Prezatide copper") lists as the copper complex; `catalog-cas-v1` already enforced it. Lot 203-50-0001 matches its Vanguard COA (V260304-6 013).
- CJC-1295 No DAC: PubChem lists 863288-34-0 as the 29-residue Mod GRF 1-29 without DAC (CID 56841945, MW 3367.9). Lot 302-10-0001 Vanguard COA (V260304-6 014) names "CJC-1295 no DAC".
- Run & Gun: lot 501-10-0001 Vanguard COA (V260304-6 020) names "CJC-1295 no DAC/Ipamorelin". Its certificate PDF lost its noindex header.

Still held, not changed: TB-500, Wolverine 10/20 mg, KLOW and GLOW (full-length vs fragment TB-500 is not stated on the COA), 5-Amino-1MQ, SLU-PP-332, Lipo-C, the HEAT line.

Workers Builds stopped 7 s into the first build of 390b63d (Cloudflare build logs are not readable with the local token); an empty commit (270d6c0) rebuilt it successfully.

## 2. Compound reference, comparison and lot-lookup pages (f2dd1c6)

Competitor review: americanpeptides.us has 306 sitemap URLs (82 products, 59 `/learn` monographs, 107 blog posts, 6 `/compare` pages, `/verify`). peptira.com lists 172 URLs, but every page 307-redirects to a sign-in gate for browsers, Googlebot and Bingbot alike, so its product pages cannot be indexed; nothing from it was copied.

Built from americanpeptides.us page types, with facts only:

- `/compounds` and `/compounds/<compound>` for 17 compounds: CAS, formula, molecular weight, sequence where PubChem states it, PubChem link, then each published Biomod product's lot, reported purity, measured content, laboratory and original COA. FAQPage and BreadcrumbList markup repeat the visible questions.
- `/compare/semax-vs-selank`, `/compare/cjc-1295-no-dac-vs-tesamorelin`, `/compare/mots-c-vs-ss-31`, `/compare/pt-141-vs-kisspeptin-10`.
- `/verify`: lot number on the label opens `/testing/<lot>`; unknown lots get a contact link.
- Product pages link to their compound reference; the footer links `/compounds` and `/verify`.
- Pages are indexed only while one of their products is published (`publishedCompound`).
- Not copied: reconstitution/handling sections, "what the studies show" evidence posts, telehealth/TRT/GLP-1 articles, fake daily `lastmod`, "peptide" wording.

Molecular data: PubChem PUG REST by CAS, retrieved November 2, 2026. `tests/compound-reference-v1.cjs` (in the release gate) checks CAS check digits and agreement with the catalog, residue counts, title length (with suffix, at most 70), sitemap membership, one h1, product links limited to published products, no peptide/dosing/handling wording, and FAQPage equal to the visible questions.

## Verification

- `npm run check:release`: TypeScript and 116 isolated suites passed; `BIOMOD_DEPLOY=true npm run build` passed.
- Workers Builds success on 270d6c0 and f2dd1c6.
- Live: GHK-Cu, CJC-1295 No DAC and Run & Gun `index, follow`, CAS shown, no specification note in visible text; TB-500 still `noindex`.
- Live: all 7 sampled new URLs return 200 with `index, follow`; compound pages carry FAQPage. Sitemap 32 → 35 → 58 URLs; llms.txt lists 21 reference/compare entries.
- Live clicks in the built-in browser: lot 302-10-0001 on `/verify` opens `/testing/302-10-0001?product=757`; 999-99-9999 shows the no-match message.
- Phone width (375 px), rendered with the site CSS: no horizontal page overflow; comparison table fits both columns.
- IndexNow: 58 URLs, 200 OK, 2026-11-02T09:48:45Z. `change-history-import-v1.mjs --remote` ran.

## Gaps and owner decisions

- Google Search Console MCP has no OAuth client (`client_secrets.json` missing in `~/Projects/trybiomod-gsc-mcp`); Google data is still unavailable.
- TB-500 family: ask the supplier or Vanguard for the sequence or measured molecular mass (full-length thymosin beta-4 is about 4,963 Da; the common fragment is under 1,000 Da). That one fact releases TB-500, Wolverine 10 mg, KLOW and GLOW.
- "Peptide" wording: both competitors rank on it; the owner's October 23 rule keeps it off the site. Owner decision.
