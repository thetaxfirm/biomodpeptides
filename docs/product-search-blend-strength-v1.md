# Product search: blend totals and component strengths v1

Draft based on `c274359`, October 10, 2026. Scope: the shared product matcher and its regression test. No catalog, identity, availability, publication, metadata or image changes.

## Reproduced issue

The actual catalog matcher and `Experience` → `Shop` server render returned Wolverine 10 mg for `BPC157 10mg`. Wolverine's current identity is BPC-157 + TB-500 and its listed 10 mg is the blend's total. That listing does not establish 10 mg of BPC-157. No component split is inferred.

Before/after results from the actual catalog:

| Search | Before | After |
| --- | --- | --- |
| `BPC157 10mg` | BPC-157 10 mg; Wolverine 10 mg | BPC-157 10 mg |
| `BPC157 20mg` | Wolverine 20 mg | No exact result |
| `TB500 10mg` | TB-500 10 mg; Wolverine 10 mg | TB-500 10 mg |
| `CJC1295 No DAC 10mg` | CJC-1295 No DAC; Run & Gun | CJC-1295 No DAC |
| `Ipamorelin 10mg` | Run & Gun | No exact result |
| `BPC157 140mg spray` | KLOW spray | No exact result |
| `Wolverine 10mg` | Wolverine 10 mg | Unchanged |
| `BPC157 TB500 10mg` | Wolverine 10 mg | Unchanged |

These are search results, not confirmation of publication eligibility or stock. Existing holds remain intact.

## Bounded behavior

When a query specifies a quantity and mentions a component of a blend, it must also include the complete blend name or all words of its current component identity. Quantity/unit pairs are removed from that identity check so amount digits cannot complete a molecule name. The existing exact listed-quantity check still runs first.

Only the catalog's spaced ` + ` delimiter identifies blends. NAD+ and FLUX's NAD+ identity are not split. Broad `BPC157` search, generic `10mg vial` browsing, SKU lookups, named blends, complete component identities, single compounds, exact forms and the reviewed Epithalon alias remain available. Missing No DAC qualifiers, partial blend names and inferred `5mg + 5mg` totals cannot bypass the rule. No aliases or component amounts are added.

## Verification

`tests/product-search-blend-strength-v1.cjs` exercises the current matcher, every actual blend with listed mass/volume, and full `Experience` → `Shop` HTML using real product-card primary links. It blocks network access and checks that catalog, holds, discovery eligibility and the 17-product sitemap remain unchanged.

Passed: the new blend-strength test, `product-search-peptide-v1`, `storefront-search-v2`, `batch-search-v1`, `product-discovery-v1`, `product-research-details-v1`, `tsc --noEmit --incremental false`, and `git diff --check`.

No live request, deployment or commit is part of this draft. Live verification and release are coordinated separately. No ranking or traffic outcome is claimed.
