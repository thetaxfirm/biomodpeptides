# TryBiomod change rule

Owner instruction, October 11, 2026: every website change must be checked and updated across all affected surfaces, regardless of who makes it.

Read and follow [the release consistency rule](docs/website-change-rule-v1.md) before changing code, assets, catalog data, runtime settings or deployment configuration. This applies to Codex, Claude, other agents and human contributors. A change is not complete until its dependent surfaces are verified and the tested source is synced to shared GitHub main.

Fetch main first, preserve collaborator edits, and never force-push. Run `npm run check:release` and the production build. Record the commit, live deployment, affected URLs and verification gaps. Runtime/admin changes must be reconciled with their actual source of truth; never copy customer records or secrets into this public repository.

Scope is trybiomod.com. BiomodPro remains deferred unless the owner explicitly requests work there. Preserve product publication holds and original scientific identities. Tests use isolated fixtures and mocked providers, never real orders, payment attempts, emails or customer data.

Owner instruction, November 26, 2026: no "peptide" wording in visible copy, titles, descriptions or structured data (risk to card processing). `tests/no-peptide-wording-v2.cjs` in the release gate enforces it; change that test only when the owner asks. Off-site search work must be real and disclosed: no doorway or redirect sites, and no posts or reviews posing as independent customers.
