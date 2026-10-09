# TryBiomod search and AI visibility execution brief v1

Prepared October 8, 2026. Internal execution brief. No outreach or external press distribution has occurred. Technical eligibility does not establish indexing, ranking, regulatory approval or a sale.

## Direction and current work

Make accurate product information and original batch documentation easy to find, read and cite. Improve the existing pages before adding new ones. Do not conceal product identities, invent specifications or promote held products through alternate names.

Implemented in release `c08f7add-69b7-4d46-a8fd-2a3711535ac5`; production HTTP, catalog and desktop-browser verification passed (see search-visibility-v6.md):

- The research FAQ has ten answers readable in the initial HTML, grouped by documentation, packs, shipping and research use. The six existing policy answers are preserved.
- Product specifications are readable without opening a tab across the 50 catalog records. Available original COAs have ordinary PDF links outside the document dialog; this does not imply all products have a published certificate. Missing, mismatched and restricted-document states remain distinct.
- The publication policy retains 16 technically eligible product targets and ten specification holds. Use [product-search-targets-v2.csv](product-search-targets-v2.csv). These are eligibility counts, not measured Google indexing counts; other publication restrictions also remain in place.

Implementation evidence: `components/store/research-faq.tsx`, `components/store/catalog.tsx`, `components/store/batch-record.tsx`, `lib/seo-publication-v1.json` and `lib/product-specification-review-v1.json`. Deployment and live verification belong in the release record.

## What the primary sources show

Public pages inspected October 8, 2026. These are documentation examples, not legal compliance assessments of the companies or evidence of search volume.

| Source | Observed public content | Useful application |
| --- | --- | --- |
| [Bachem FAQ](https://www.bachem.com/knowledge-center/faq-frequently-asked-questions/) | Questions include “What does HPLC purity mean?” and “What does gross weight mean?” Its documentation separates batch analytical data, purity and peptide content. | Keep purity, labeled quantity and measured content separate. Match the actual lot before interpreting results. |
| [GenScript peptide FAQ](https://www.genscript.com/peptide.html) and [QC services](https://www.genscript.com/accupep_quality.html) | The FAQ asks “What is net peptide content?” The QC page distinguishes methods for content, counterions, water and sequence analysis. | Explain what each reported method answers. Do not transfer another supplier's methods, typical values or salt forms into Biomod specifications. |
| [Cayman COA FAQ](https://www.caymanchem.com/faq/how-can-i-get-a-cofa) | “How can I get a CofA?” leads to batch-number document retrieval, with a support route when the document is unavailable. | Keep a clear product-to-lot-to-original-document route and an honest missing-document state. |

These observations support six candidate question intents: finding a lot's COA; matching certificate and container lots; distinguishing purity from content; understanding missing documentation; comparing labeled quantities; and understanding complete containers in a 1/3/5/10 pack. They are inferred content priorities, not measured popular searches or AI prompts. The current FAQ and [COA-reading guide](https://trybiomod.com/quality-standard) already cover much of this scope. Add content only where actual customer questions or search evidence reveal a gap.

Public discussion examples provide another limited signal: a [question about COA test scope](https://www.reddit.com/r/PeptideGuide/comments/1wwwg04/what_should_a_real_peptide_coa_actually_test_for/) and a [question about COA lot numbers](https://www.reddit.com/r/PeptideDiscussion/comments/1pnevqq/coa_and_lot_numbers/). These show that such questions occur publicly; they are not laboratory authorities, representative surveys or proof of AI-search volume.

## What is known about Estly

Estly's [public Biomod project](https://estlystudio.com/our-work/#work-biomod) describes an AI CRM. The page qualifies its examples as past work by team members, with scope and current systems potentially different. It does not establish delivery of an SEO campaign. Its [homepage](https://estlystudio.com/) also includes a Biomod client credit. Available correspondence searches were inconclusive about SEO scope or outcomes. Obtain the actual scope, deliverables and measurement access before attributing past search performance to Estly.

## Earned links and factual press

| Action | Boundary and next requirement |
| --- | --- |
| Ask Estly to link its existing Biomod credit to the current storefront. | Only if the credit is current, approved and free of a paid placement requirement. Keep its description factually accurate. The prepared request is unsent. |
| Ask [AlphaGrade's existing COA library](https://alphagradepeptides.com/research-peptide-coa-library/) to add a contextual current batch-index link. | Preserve historical original PDFs and lot information. Publisher acceptance is required; no demand for ranking keywords or removal of relationship attributes. The prepared request is unsent. |
| Correct authentic company profiles and locations. | Verify owner access, the real business identity, location eligibility, address and hours first. No invented listings, reviews or duplicate profiles. |
| Offer the public COA-reading guide as a factual editorial topic. | A release is prepared locally, without invented quotes, first-in-market claims or clinical/certification claims. Verify the live destination before any separately authorized distribution. No presswire purchase or ranking promise. |

Use [existing unsent drafts](backlink-corrections-v1.md) and [verified public contacts](backlink-contacts-v1.md). Sending requires explicit authorization. Related-company links are useful navigation, not independent endorsements. No mass directories, paid ranking links or fabricated third-party authority.

Local press draft: `BIOMOD COA Guide Press Release v1.pdf` and editable `.docx` in `/Users/godsstrengthandspeed/Documents/AI Workspace/Documents/Generated/2026/10/TryBiomod-Search/`. These files have not been distributed.

### Distribution feasibility

The checked [EIN editorial rules](https://www.einpresswire.com/legal/editorial-guidelines) exclude health-supplement and certain weight-loss content and restrict online pharmaceutical sellers. [PRWeb editorial rules](https://www.prweb.com/editorial-guidelines/) require ingredient disclosure and restrict pharmaceutical/supplement promotion. Acceptance of this business and release is unconfirmed. Do not purchase distribution before editorial eligibility is established for the actual site; renaming or concealing products is not a remedy. Review the release date, issuer identity and monitored media contact before approval. Paid/sponsored links must not be represented as earned independent coverage.

## Google AI visibility and measurement

The live Search Console check on October 8 found the Search generative AI control inheriting the domain default with **Include** as the current value. No change was needed. Inclusion permits participation; it does not guarantee an appearance. See [Google's control documentation](https://support.google.com/webmasters/answer/16908024).

Google now documents a [Generative AI performance report](https://support.google.com/webmasters/answer/16984139) with impressions grouped by page, country, date and device. It does not expose exact prompts or an AI click dimension. No dedicated report was visible for this property during the check, while search data was processing. Google says insufficient impressions commonly explain an absent report and publishes no numerical threshold on that page; the property's exact cause is unconfirmed. Do not interpret absence as zero demand.

Keep the useful basics: accessible text, ordinary internal links, accurate titles and original source documents. Google's [current AI optimization guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) does not call for special AI markup or files. No `llms.txt`, artificial mass pages or FAQ rich-result promises are part of this work.

### Bing and ChatGPT

The public site permits ordinary crawlers, including search agents, through its robots policy. OpenAI documents [OAI-SearchBot separately from GPTBot](https://developers.openai.com/api/docs/bots), so search discovery and potential training controls should not be confused. This code check is not proof of access from every crawler origin through the CDN. The [publisher FAQ](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq) documents ChatGPT referral tracking; a visit is distinct from a citation or mention.

Bing Webmaster Tools opened signed out. Permission to sign in using the existing Google account is pending. Its [AI Performance report](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c) can supply sampled citation and generalized grounding-query data when access and data are available. These are not private prompts or guaranteed exposure.

## Execution and success criteria

1. Desktop and HTTP verification are complete. A mobile viewport override did not take effect in the available browser, so mobile visual verification remains outstanding. Preserve every hold and unchanged commercial term.
2. Resolve held identities and specifications only from exact manufacturer or laboratory evidence. Do not infer a sequence, salt or formulation from a similar product.
3. Establish a baseline when Search Console data is available. Compare equal complete periods by eligible product page and actual reported query; track ordinary search clicks and, when available, AI impressions separately.
4. After explicit authorization, send only the relevant existing editorial requests. Record accepted links, their actual destinations and qualified referral traffic, not a promised link count.
5. Measure checkout starts and completed, payment-verified customer sales. Use qualified visits or real checkout starts as the denominator, excluding identified bots and internal tests. Failed and unpaid orders remain unsuccessful outcomes, not sales. Reconcile provider payment records and complete an owner-performed purchase before concluding why conversion is low.

Success means more qualified visits reaching the correct product and more verified customer purchases. Rankings, including page-one placement for every product, cannot be guaranteed. We have no access to private AI prompt volumes, and this brief does not claim otherwise.
