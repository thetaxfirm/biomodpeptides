# TryBiomod batch-library search v1

October 10, 2026. Author: Codex. Base: `a0d3b38ed3b1f20c48827b6bfa823e8b64f57949`; local HEAD and origin/main were checked before edits. Scope: `/testing` search only. Implementation released through shared main in 945189f; root verification is recorded in docs/seo-work-log/2026-10-10-v7.md.

## Verified defect

The existing `Testing` component required a literal lowercase substring. Read-only execution against the actual catalog returned no records for `BPC157`, `BPC 157`, `MOTS C`, `SS31`, `SS31 50mg` or the published BPC-157 report reference `V260304-6 010`. Hyphenated product names worked. This is a document-discovery defect, not a measured ranking or lost-sale result.

## Bounded change

`lib/batch-search.ts` uses the existing reviewed product matcher for names, aliases, forms and listed strengths. It separately matches complete public SKU, listed-lot, certificate-lot and report identifiers. Case, spaces and hyphens may vary; every digit and leading zero must remain. Combined queries must agree with one record: `BPC157 10mg V260304-6 010` works; a different product or strength with that report does not. Identifier digits cannot supply a requested mg/mcg/g/mL quantity.

The helper reads current public product facts and the specific record's displayed certificate identifiers. It does not search raw PDF text, file paths, sample names, historical identity fields, private notes or other source metadata. Existing restricted records exclude certificate identifiers from lookup. Their underlying identities, documentation policy and visibility are not changed.

`components/store/testing.tsx` calls the helper, retains the conjunctive product/lot/status filters, and adds SKU/report to the field hint with a 200-character limit. Document rendering is unchanged. SS-31 50 mg still says documentation pending and has no PDF; a search cannot borrow SS-31 10 mg's report. Mismatched lots retain their warning. Generic peptide queries inherit the existing publication controls.

## Verification and remaining release work

Passed: `tests/batch-search-v1.cjs`, `tests/testing-discovery-v1.cjs`, `tests/product-search-peptide-v1.cjs`, `tests/search-readable-facts-v1.cjs`, `tsc --noEmit --incremental false`, and `git diff --check`. Tests use actual catalog/batch records plus isolated restricted-metadata fixtures; no network, order or customer writes. Independent read-only review found no blocking issue.

Owned files: the helper, Testing component, new batch-search test, and this document. The concurrent SKU-schema correction in `lib/seo.ts` and `tests/product-schema-identifiers-v1.cjs` belongs to the other agent; the unrelated SS-31/Wolverine inventory drafts remain untouched.

Root owns build, commit, deployment and live browser verification. Before marking complete, type the original failing product queries and a full report reference into the actual Testing field; check a pending record, a mismatch, and combined filters. Use the existing measurement opt-out for QA. No live calls, external messages, production deployment, commit or push occurred in this task.
