# Run & Gun vial image repair

The live Run & Gun 10 mg listing already existed at `/product/run-gun-10mg`, but its active v37 SVG failed XML parsing because the accessible title contained an unescaped ampersand. Escaped that character. The underlying artwork, branding, catalog, pricing, stock and documentation were not changed.

The existing artwork reads IPA 5MG / CJC 5MG, total 10 MG. The live listing identifies the blend as Ipamorelin + CJC-1295 No DAC and shows $49.99. The existing identity and lot-reconciliation notes remain in place; this artwork repair does not establish batch identity or assay results.

## Verification

- Before: SVG parser failed and live browser showed a broken image.
- After: SVG rendered successfully, production build passed, and the live product page displayed the full vial correctly.
- Live browser reported no warnings or errors.
- This release was built from deployed commit 8cfb82d plus this single-asset fix, excluding pending product additions in the development checkout.
- Worker version: f3d0a196-9e94-409f-a803-04412f3ab2e5
- Live screenshot: /tmp/biomod-run-gun-live-fixed-v1.png
