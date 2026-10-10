# Evidence-faithful vial artwork v1

October 10, 2026. Author: Codex. Scope: nine TryBiomod promotional product images. Source base: shared main 03744e5, including the collaborator's full-order receipt changes. Built-in image editing was used; no lab report or certificate was modified.

## Evidence and change

A direct visual and current-page audit covered all 17 eligible vial listings. Nine displayed >98% HPLC without supporting published evidence for the listed lot. Three matching-lot records instead disclose lower values; two listings have documentation pending; four have different-lot reports that do not establish the listed lot's result.

| Product | Published listed-lot evidence | Replacement asset |
| --- | --- | --- |
| Epitalon 50 mg | Matching lot 407-50-0001: 97.05% + 0.18% | epitalon-50mg-evidence-v1.webp |
| Glutathione 1500 mg | Matching lot 703-1500-0001: 96.01% + 0.18% | glutathione-reduced-l-glutathione-evidence-v1.webp |
| MOTS-c 10 mg | Matching lot 409-10-0001: 97.07% + 0.18% | mots-c-10mg-evidence-v1.webp |
| MOTS-C 40 mg | Lot 701-40-0001: documentation pending | mots-c-40mg-evidence-v1.webp |
| KPV 10 mg | Lot 402-10-0001: documentation pending | kpv-10mg-evidence-v1.webp |
| NAD+ 500 mg | Listed 405-500-0001 differs from report 001-B | nad-500mg-evidence-v1.webp |
| Selank 10 mg | Listed LYO-028-2608-02 differs from report 001-b | selank-evidence-v1.webp |
| Semax 10 mg | Listed LYO-029-2608-01 differs from report 001-R | semax-evidence-v1.webp |
| Tesamorelin 10 mg | Listed 301-10-0001 differs from report 001-B | tesamorelin-10mg-evidence-v1.webp |

The original certificate glyph is a plus sign. Preserve the exact notation as reported; do not add 0.18 to the reported percentage or silently reinterpret it as a confidence interval. See docs/vial-artwork-source-audit-v1.md for the remaining-15 audit, original sources, observation times and limitations.

Removed the unsupported promotional line from each affected illustration, leaving blank white label paper. Retained each product identity and quantity, copper bp / black biomod wordmark with TM, cap, glass, background and framing. SS-31 50 mg already carries no such claim and was left unchanged. Other seven labels were numerically consistent with their published matching-lot records; that is not independent certification of laboratory quality, samples, efficacy or regulatory eligibility.

These remain product illustrations. This edit does not establish that physical printed packaging changed or that contents were newly tested. Original v37 assets remain as version history; current consumer references use new filenames. Original reports, visible results, documentation limitations, stock, pricing, holds and product eligibility remain unchanged.

## Implementation and verification

The nine new assets are in public/products/ and optimized to the existing 1080-square frame at WebP quality 94, approximately 33-37 KB each. Nine entries in lib/vial-branding-v37.json route shared imagePath references, including listings, product galleries, cart/pack and SEO image metadata. No layout or vial-frame measurements were changed.

Generated and optimized artwork is checked for exact name/strength, TM, current branding alignment, consistent framing and absence of added claims. Final regression/build, independent image review and live verification are recorded in the dated work log. This source note alone is not deployment proof. The collaborator's receipt and order-admin changes were merged before this release; they are not attributed to this artwork work.

## Built-in edit prompts

### Epitalon

Edit target: the attached existing BIOMOD Epitalon 50 MG vial product image. Make ONE narrowly scoped correction: remove the text '>98% HPLC' from the bottom of the white label, leaving that small label area blank with its original white curved paper shading. This promotional purity line is not supported by the published lab report; do not replace it with any other claim or value. Preserve the exact square composition, bottle position and dimensions, white background, shadow, glass, powder, copper bands, white cap, cap logo, current copper bp logo, black biomod wordmark and its small TM, and the exact readable text 'EPITALON' and '50 MG'. Preserve all logo proportions, alignment, spacing and label typography. Do not redesign, relight, enlarge, shrink, crop or move the vial. No added text or symbols. Deliver a clean sharp high-resolution square product image matching the reference as closely as possible except the removed purity line.

### MOTS-c 40 mg

Edit target: the attached existing BIOMOD MOTS-C 40 MG vial product image. Make ONE narrowly scoped correction: remove the text '>98% HPLC' from the bottom of the white label, leaving that small label area blank with its original white curved paper shading. The published listing currently lacks a matching certificate, so do not replace the removed line with any other purity, testing or quality claim. Preserve the exact square composition, bottle position and dimensions, white background, shadow, glass, powder, copper bands, white cap, cap logo, current copper bp logo, black biomod wordmark and its small TM, and the exact readable text 'MOTS-C' and '40 MG'. Preserve all logo proportions, alignment, spacing and label typography. Do not redesign, relight, enlarge, shrink, crop or move the vial. No added text or symbols. Deliver a clean sharp high-resolution square product image matching the reference as closely as possible except the removed purity line.

### glutathione-reduced-l-glutathione

Edit only the supplied existing BIOMOD GLUTATHIONE 1500 MG vial image. Remove the small text '>98% HPLC' at the bottom of the white label and restore clean blank curved white paper in exactly that area. This promotional purity claim is unsupported by the published record; add NO replacement claim or number. Preserve the exact square composition and vial size, position, amber brown glass, contents, cap, copper bands, shadow and white background. Preserve the current copper bp logo, black biomod wordmark and small TM with the same proportions, level alignment and spacing. Keep all other text exactly 'GLUTATHIONE' and '1500 MG', with the same lettering and case as the reference. No changes to lighting, geometry, framing, color, other label areas, branding or any other object. Sharp high-resolution square output matching the reference except the removed purity line.

### mots-c-10mg

Edit only the supplied existing BIOMOD MOTS-c 10 MG vial image. Remove the small text '>98% HPLC' at the bottom of the white label and restore clean blank curved white paper in exactly that area. This promotional purity claim is unsupported by the published record; add NO replacement claim or number. Preserve the exact square composition and vial size, position, clear glass, contents, cap, copper bands, shadow and white background. Preserve the current copper bp logo, black biomod wordmark and small TM with the same proportions, level alignment and spacing. Keep all other text exactly 'MOTS-c' and '10 MG', with the same lettering and case as the reference. No changes to lighting, geometry, framing, color, other label areas, branding or any other object. Sharp high-resolution square output matching the reference except the removed purity line.

### kpv-10mg

Edit only the supplied existing BIOMOD KPV 10 MG vial image. Remove the small text '>98% HPLC' at the bottom of the white label and restore clean blank curved white paper in exactly that area. This promotional purity claim is unsupported by the published record; add NO replacement claim or number. Preserve the exact square composition and vial size, position, clear glass, contents, cap, copper bands, shadow and white background. Preserve the current copper bp logo, black biomod wordmark and small TM with the same proportions, level alignment and spacing. Keep all other text exactly 'KPV' and '10 MG', with the same lettering and case as the reference. No changes to lighting, geometry, framing, color, other label areas, branding or any other object. Sharp high-resolution square output matching the reference except the removed purity line.

### nad-500mg

Edit only the supplied existing BIOMOD NAD+ 500 MG vial image. Remove the small text '>98% HPLC' at the bottom of the white label and restore clean blank curved white paper in exactly that area. This promotional purity claim is unsupported by the published record; add NO replacement claim or number. Preserve the exact square composition and vial size, position, amber brown glass, contents, cap, copper bands, shadow and white background. Preserve the current copper bp logo, black biomod wordmark and small TM with the same proportions, level alignment and spacing. Keep all other text exactly 'NAD+' and '500 MG', with the same lettering and case as the reference. No changes to lighting, geometry, framing, color, other label areas, branding or any other object. Sharp high-resolution square output matching the reference except the removed purity line.

### selank

Edit only the supplied existing BIOMOD SELANK 10 MG vial image. Remove the small text '>98% HPLC' at the bottom of the white label and restore clean blank curved white paper in exactly that area. This promotional purity claim is unsupported by a matching published lot record; add NO replacement claim or number. Preserve the exact square composition and vial size, position, clear glass, contents, cap, copper bands, shadow and white background. Preserve the current copper bp logo, black biomod wordmark and small TM with the same proportions, level alignment and spacing. Keep all other text exactly 'SELANK' and '10 MG', with the same lettering and case as the reference. No changes to lighting, geometry, framing, color, other label areas, branding or any other object. Sharp high-resolution square output matching the reference except the removed purity line.

### semax

Edit only the supplied existing BIOMOD SEMAX 10 MG vial image. Remove the small text '>98% HPLC' at the bottom of the white label and restore clean blank curved white paper in exactly that area. This promotional purity claim is unsupported by a matching published lot record; add NO replacement claim or number. Preserve the exact square composition and vial size, position, clear glass, contents, cap, copper bands, shadow and white background. Preserve the current copper bp logo, black biomod wordmark and small TM with the same proportions, level alignment and spacing. Keep all other text exactly 'SEMAX' and '10 MG', with the same lettering and case as the reference. No changes to lighting, geometry, framing, color, other label areas, branding or any other object. Sharp high-resolution square output matching the reference except the removed purity line.

### tesamorelin-10mg

Edit only the supplied existing BIOMOD TESAMORELIN 10 MG vial image. Remove the small text '>98% HPLC' at the bottom of the white label and restore clean blank curved white paper in exactly that area. This promotional purity claim is unsupported by a matching published lot record; add NO replacement claim or number. Preserve the exact square composition and vial size, position, clear glass, contents, cap, copper bands, shadow and white background. Preserve the current copper bp logo, black biomod wordmark and small TM with the same proportions, level alignment and spacing. Keep all other text exactly 'TESAMORELIN' and '10 MG', with the same lettering and case as the reference. No changes to lighting, geometry, framing, color, other label areas, branding or any other object. Sharp high-resolution square output matching the reference except the removed purity line.
