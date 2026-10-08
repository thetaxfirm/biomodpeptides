# TryBiomod existing-link audit

Observed 2026-10-08. Read-only public-page research; no outreach, account creation, purchases, publication or site edits. Three verified practical opportunities, one conditional listing correction, plus an existing good link to retain. These are useful navigation and factual corrections, not a promise of ranking credit.

## Priority opportunities

| Priority / source | Current observed link and destination | Exact proposal | Access or authorization needed |
|---|---|---|---|
| 1. [Las Vegas Peptide Therapy's Biomod page](https://lasvegaspeptidetherapy.com/biomod-peptides-las-vegas/) | Live 200. Repeated BIOMOD links still target `biomodpeptides.com`; most have `rel="sponsored noopener"`. The general catalog link targets the old home page. The COA link targets `https://biomodpeptides.com/coa/`, which currently reaches `https://trybiomod.com/testing` after **301 + 308 + 308**. | Change catalog links to `https://trybiomod.com/shop`; COA links to `https://trybiomod.com/testing`; About to `https://trybiomod.com/about`; Quality/FAQ/Contact to the same paths on TryBiomod. Preserve sponsored qualification and accurately disclose any commercial/ownership relationship. Use normal brand/documentation anchor text. Do not multiply links or add product-keyword lists. | Publisher/CMS editor access. This page claims independence; ownership was **not** verified. An editor must approve changes. Contacting the publisher requires a separate explicit send authorization. |
| 2. [AlphaGrade Testing & COA Library](https://alphagradepeptides.com/research-peptide-coa-library/) | Live 200. Contains 27 PDF links: 26 to the old Biomod upload host and one AlphaGrade-hosted report. Sample existing destinations `https://biomodpeptides.com/wp-content/uploads/2026/05/BPC-157_10-mg.pdf` and `https://biomodpeptides.com/wp-content/uploads/2026/05/AOD-9604_10-mg.pdf` still return **200 application/pdf**, without redirect. No TryBiomod link was present in inspected HTML. | Add one contextual line near the existing documentation explanation: **“For BIOMOD's current product and batch records, visit the BIOMOD batch library.”** Link `BIOMOD batch library` to `https://trybiomod.com/testing`. Preserve accurate historical PDFs and their lot context; a current index does not replace the original reports or prove current stock. | AlphaGrade's authorized WordPress editor or administrator; business relationship is publicly claimed, but this audit did not establish our edit rights. No contact or change made. |
| 3. [Estly Studio](https://estlystudio.com/) | Live 200. Its homepage includes Biomod Peptides in a list of companies its team has worked with. Inspected HTML has no link from this credit to either Biomod storefront. Its visible external links are its own social profiles and Google documentation. | If the client relationship and credit are authorized, turn the existing **Biomod Peptides** name/mark into a single link to `https://trybiomod.com/`. Keep the truthful client credit; do not invent a case study, testimonial, results metric or endorsement. | Estly website editor and confirmation that Biomod approves the client credit. Publisher controls the link. Explicit authorization required before outreach. |
| Conditional. [Ground Truth existing vendor profile](https://groundtruth.bio/vendors/biomodpeptides) | Live profile 200. Website anchor points to `/go/biomodpeptides` with `rel="nofollow noopener noreferrer"`. Its AOD product anchor embeds old URL `https://biomodpeptides.com/product/aod-9604-10mg/` in the `to=` parameter. Direct checks of the two `/go/` URLs returned 403, so their final destinations could **not** be verified. | Ask the publisher to reconcile the existing vendor website record with `https://trybiomod.com/` and to verify each exact current product URL before updating its catalog links. Preserve the publisher's nofollow/referral treatment and historical report context. Do not request favorable scores, conceal identities or remove accurate adverse results. This is a factual correction candidate, not a verified broken link. | Publisher's vendor-data editor or support process; no owner access confirmed. Explicit send authorization before any request. No account or paid plan is needed for this audit, and none was created. |

## Existing good link: retain

[BiomodPro homepage](https://biomodpro.com/) already links “BIOMOD batch records” directly to `https://trybiomod.com/testing`. [BiomodPro Quality](https://biomodpro.com/quality/) also has a contextual “Find your batch report” link to that destination. Both pages and destination returned 200. No correction is needed. Treat these as sister-site navigation, not an independent endorsement or a reason to add repetitive sitewide product links.

## Verified redirect mappings

| Existing public URL | Final current destination | Result |
|---|---|---|
| `https://biomodpeptides.com/` | `https://trybiomod.com/` | 200 after redirect |
| `https://biomodpeptides.com/coa/` | `https://trybiomod.com/testing` | 200 after 3 redirects |
| `https://biomodpeptides.com/about-biomod/` | `https://trybiomod.com/about` | 200 after redirect |
| `https://biomodpeptides.com/locations/` | `https://trybiomod.com/locations` | 200 after redirect |
| `https://biomodpeptides.com/product-category/softgels/` | `https://trybiomod.com/softgels` | 200 after redirect |
| `https://biomodpeptides.com/product-category/spray-products/` | `https://trybiomod.com/shop?category=spray-products` | 200 after redirect |

## Social and local-listing verification gap

The inspected live TryBiomod homepage and Locations HTML contain no Instagram, Facebook, LinkedIn, Google Maps place or Yelp link. Targeted public search did not establish an official company social profile or a Google Business Profile URL. That is **not** evidence that none exists. Do not invent handles, a place ID or owner access, and do not create a duplicate listing.

`https://trybiomod.com/locations` currently returns 200 with `X-Robots-Tag: noindex, follow`. Its Las Vegas location shows 6625 S Valley View Blvd, Suite D420. Public third-party snippets contain inconsistent suite/phone/category details; they are not authoritative confirmation. Before correcting a local listing, obtain the owner's actual managed profile, confirmed address/suite, customer-facing hours and business category. Do not present Biomod as a pharmacy or treatment clinic merely because a third-party directory does.

Other discoveries were not promoted into ready opportunities: `https://biomodebook.com/` is a live BIOMOD-branded ebook page but ownership, claim support and its rendered link state were not fully verified; `https://www.peptidestg.com/` is live but its inspected HTML did not establish the current BIOMOD relationship. No new link is proposed there without confirmation.

## Method and limits

- Used current public HTML GET requests to inspect actual `href` and `rel` attributes and HTTP redirects, backed by public search discovery. Search snippets for the old Biomod site still show old WordPress content, so they were not treated as current production state.
- No private Google/Search Console links report, referral analytics, publisher login or authority metric was available in this audit. We cannot quantify backlink value or resulting sales.
- Keep commercial links qualified. Google documents [sponsored/nofollow link treatment](https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links) and prohibits [links created primarily to manipulate rankings](https://developers.google.com/search/docs/essentials/spam-policies#link-spam). Do not buy placements, demand reciprocal links, use mass directories or remove valid qualifiers to seek ranking credit.
