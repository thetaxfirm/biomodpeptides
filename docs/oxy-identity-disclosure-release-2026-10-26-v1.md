# Oxy ingredient disclosure, October 26, 2026 v1

Codex repair under the owner's standing website consistency and scientific-identity rule.

The preceding CAS release replaced the scientific ingredient name with Oxy in IGNITE and NOCTIS composition fields. These fields now say **Oxy (oxytocin)**: the alias remains, and readers can identify the ingredient without decoding a registry number. NLM MeSH identifies CAS 50-56-6 as oxytocin: https://www.ncbi.nlm.nih.gov/mesh/68010121 . This identifies the chemical; it does not establish a batch's contents, safety, efficacy or permission for human use.

The catalog, editorial descriptions and displayed batch metadata agree. Product names, URLs, photos, prices, pack sizes, stock, existing CAS corrections, publication/specification holds and historical purchases are preserved. Original laboratory files were not edited; 151 source document-reference/identifier fields compare unchanged. Their remote PDF bytes and customer delivery were not checked.

Search treats the alias and scientific name as one component only for these two documented blends. Both full-blend searches resolve; requesting the blend total as a single ingredient's dose remains rejected. No publication hold is released.

Validation:

- A focused cross-source identity regression failed before clarification and passes afterward.
- TypeScript and all 103 isolated release suites pass; the gated production build passes.
- Actual compiled Worker with isolated D1 verifies public state, both held product pages, shop and testing. Held pages remain noindex without Product schema; external provider calls are intercepted.
- No real order, email, form, payment, customer record or runtime override was changed.

Affected URLs: `/product/ignite-pt-141-oxytocin-spray`, `/product/noctis-blend-spray`, `/shop`, `/testing`, `/api/store/state`; shared catalog consumers and search use the same identities. Exact commit, provider deployment/version and post-deployment read-only evidence are recorded in the October 26 sprint receipt after publication. Authenticated controls and original COA delivery are separate verification gaps.
