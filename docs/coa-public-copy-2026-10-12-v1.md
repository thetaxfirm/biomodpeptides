# Public COA wording adjustment v1

Owner request, October 12, 2026: remove the repeated sentence saying the available certificate identifies a different lot.

Baseline source: `da10cc7d08947d7eee4938d925f277b2b02a9fde`. Shared main was fetched, clean and aligned before editing. Contribution prepared by Codex in this chat; Git author and provider account attribution remain separate evidence.

The shared batch details no longer repeat that paragraph on product pages, the COA library or individual lot records. The related product FAQ now says: “Contact BIOMOD to request the COA for the listed lot.” Factual product and certificate lot fields, lot-confirmation status, unverified result values, and the original-document scope disclosure remain intact. Original reports, lot associations, identities, prices, stock, publication settings and delivery workflows are unchanged.

Affected source: `components/store/batch-record.tsx` and `components/store/product-research-details.tsx`. Existing assertions were updated for the requested wording. The older testing-library fixture was aligned with the current server-resolved catalog and its ordering, without changing production behavior.

Verification: focused batch search, library SSR, readable product facts and research-details suites passed. `BIOMOD_DEPLOY=true npm run build` passed its required release gate and production compilation. Live targets include `/product/selank`, `/testing?product=785` and `/testing/LYO-028-2608-02?product=785`. Exact commit, deployment, live observations and outstanding gaps are recorded separately in the local versioned release receipt; this source note alone is not deployment evidence.
