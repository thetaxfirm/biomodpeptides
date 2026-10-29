# BPC-157 and Wolverine product-name clarity

Owner requested product-name discovery improvements without interfering with Claude.
Based on shared main b5daf8e; Claude AI-traffic checkout 54b1317 was clean. Existing shared descriptions, batch records, restrictions, pricing and runtime settings preserved.

BPC-157: shorter product title, description including BPC157, visible spelling-variant and single-compound-versus-blend answers mirrored in existing FAQ structured data. Sitemap date updated only for this eligible changed page.
Wolverine: description clarifies 10 mg blend total versus ingredient weights and explicitly retains unresolved TB-500 specification. Existing noindex/publication hold retained, no sitemap addition or new promotion links. Product-specific questions remain subject to existing discovery eligibility gate; they are not exposed on the held page.

Checks: production build passed with the full release gate: TypeScript and 108 isolated suites. Existing isolated coverage extended for aliases, blend-total clarity and per-product sitemap dates. No price, SKU, stock, pack, checkout or customer-data changes. No ranking, citation or traffic gain claimed.

Deployment and live verification will be recorded after the tested source is published. Wolverine organic eligibility requires authoritative full-length/fragment specification reconciliation; this release does not resolve that evidence gap.
