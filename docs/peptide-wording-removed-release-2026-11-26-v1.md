# "Peptide" wording removed again: release v1

November 26, 2026. Author: Claude. Owner instruction, November 26: "i dont think its worth the risk to lose credit card processing ... remove peptides like before." This supersedes the November 14 instruction that restored the word (docs/peptide-wording-restored-release-2026-11-15-v1.md) and returns the public site to the October 23 wording (docs/ruo-softgel-marks-release-2026-10-23-v1.md).

## What changed

- Reversed e60bf8c and 913e93a (November 15): titles, descriptions, headings, the home h1 and button, shop, FAQ buying section, both guides, collections, compound reference and comparison pages, product titles ("Research Vial" again, not "Peptide Vial"), "Browse all research compounds" links, research notes, llms.txt and the Organization markup (alternateName "Biomod Peptides" and the former-name mention removed). `isPeptideVial` is gone. Later work on those files (spray titles, product headings, layout measurement) is kept; only the wording was reverted.
- Removed wording added on October 28 and 29 while no guard existed: the Wolverine and Kisspeptin product answers, and the DSIP name variant ("delta sleep-inducing peptide" is now "Emideltide", the catalog's stated compound).
- The FAQ answer "Is TryBiomod.com the official Biomod online store?" no longer names the old domain (it says "Its former web address redirects here."), as the press release stopped doing on October 23. The guard fails if visible copy names the old domain; links and mailboxes on it stay allowed.
- Sitemap `siteLastmod` is November 26: the wording changed on every page.
- New guard `tests/no-peptide-wording-v2.cjs`, in the release gate. It checks every published page's title and description, product names and categories, FAQ, collections, compound reference, product questions, press and llms.txt, and every source line in app/, components/ and lib/. Only listed hidden uses pass: old-address redirects, the `research-peptides` category slug, search synonyms, lab-report matching ("BIOMOD PEPTIDES", "lyophilized peptide") and supplier-pitch spam filters. A probe file with the word fails it.

## Unchanged on purpose

- Store name Biomod Research Supply Company; RUO softgel marks; catalog identities (Emideltide, Prezatide Copper, Ala-Glu-Asp-Gly).
- Hidden uses listed above, so old links, searches typed with "peptide" and COA matching keep working.
- The laboratories' own report text (for example the analyte "Peptide Purity (HPLC)" in the certificate dialog, and the original PDFs). Original lab documents are not altered.

## Checks

- `npm run check:release`: TypeScript and 142 isolated suites passed. Updated expectation: search-buy-intent (KPV title).
- a470f34 pushed November 27 02:2x UTC; Workers Builds succeeded and deployed Worker 989bbe7f (02:26 UTC). Live scan of all 84 sitemap pages plus llms.txt: no "peptide" in titles, descriptions or structured data, and one visible match, the old domain in the FAQ answer, fixed in the follow-up commit.
- 532390e deployed as Worker feb771d6 (02:31 UTC). Second live scan, all 84 sitemap pages plus llms.txt: 0 matches in visible text, titles, descriptions and structured data.
