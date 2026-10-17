# Store renamed; "peptide" wording removed (October 17, 2026, v1)

Author: Claude agent for the owner. Owner instruction, October 17, 2026: "remove all words of peptides on our webpage. Biomod Research Supply Company. Buy Research Compounds. Shop research Compounds." This supersedes the October 14 instruction to keep the "research peptides" search wording.

## Owner decisions (asked in chat, October 17)

- Official compound names stay as written: Delta Sleep-Inducing Peptide (DSIP), Epitalon Tetrapeptide, Copper Tripeptide-1 (GHK-Cu). Descriptions were reworded ("a 15-amino-acid compound", "the three-amino-acid sequence Lys-Pro-Val").
- The two press releases get new addresses with permanent redirects from the old ones.
- The former domain biomodpeptides.com stays as history in the press release.
- The filed softgel marks (The Original Peptide Softgel™, World's First Peptide Softgel™): the owner asked for a recommendation. Recommended and applied: keep the marks where they name the product line (the /softgels page and softgel product story) so the filed marks stay in use; remove them from the sitewide footer and the About page. Renaming the line is a question for trademark counsel.

## Change (commit b8f6f26)

- Brand: "Biomod Peptides" is now "Biomod Research Supply Company" in every title suffix, the default title, Open Graph site name and logo alt, Organization and WebSite markup, About, newsroom, press boilerplate and llms.txt.
- Copy: homepage "Buy research compounds." and "Shop research compounds"; shop heading "Buy research compounds"; "All research compounds" vial index; "lyophilized vials" on the homepage list; FAQ "Buying research compounds"; COA guide "How to read a COA"; supplier guide "Choosing a research compound supplier"; product research notes.
- Titles: /shop "Buy Research Compounds Online", /faq "How to Buy Research Compounds", /quality-standard "Reading a COA: Lot, Purity, Assay", /choosing-a-research-supplier "Choosing a Research Compound Supplier". Product titles drop "Research" only when the title would pass 70 characters (Thymosin Alpha-1).
- Press releases: /news/biomod-online-store-trybiomod ("Online Store Moves to TryBiomod.com") and /news/guide-to-reading-coa ("Biomod Publishes COA Reading Guide"); the old URLs redirect permanently (lib/legacy-routes.ts).
- Unchanged on purpose: original COA documents and their biomodpeptides.com PDF links; the COA matcher that reads the lab's "report to" name; old-URL redirects; the search synonym so "peptide" still finds vials; product names, prices, URLs of products, publication holds.
- Sitemap: every page is dated October 17 (rebased onto 2ca7adc, which already set that for the menu and shipping changes); the renamed press release replaces its old dated entry.
- Tests: tests/no-peptide-wording-v1.cjs added to the release gate; six suites updated for the new wording.

## Verification

- `npm run check:release`: TypeScript and 94 suites passed; `BIOMOD_DEPLOY=true npm run build` passed. Workers Builds success 21:50:00 UTC.
- Live crawl of all 31 sitemap URLs plus /softgels, /locations, /multi-pack, /terms-of-sale, /privacy-policy, llms.txt and robots.txt, visible text and metadata: about 450 mentions before, and afterwards only the kept compound names, the softgel marks on /softgels, and COA PDF links on the former domain. Old press-release URLs return 308 to the new ones. Homepage, footer and /shop checked in a browser.
- IndexNow resubmitted; `node scripts/change-history-import-v1.mjs --remote` ran.

## Search impact (for the owner)

"Research peptides" was the main search phrase the site targeted. Rankings for peptide searches will likely drop, and "research compounds" searches become the target. Google and Bing will show the new titles after they recrawl.
