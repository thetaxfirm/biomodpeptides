# Softgel gallery sources and limits

Updated September 12, 2026.

The eight softgel detail pages use the original 1600 x 1067 BIOMOD packaging photographs already in `public/products/*-packaging-v9.jpg`. Bottle front, box front and alternate box-face views are clipped SVG viewports over those same files. They are not newly photographed angles, generated label art, or retouched packaging. Bottle-only listing artwork remains separate.

The original store provides one current-style composite per product. Its older rear-view renders and the six flat wraps in the Pro reference archive are superseded. Some have formula discrepancies, and the flat wraps print a vegetable shell. No current approved gelatin back-label or carton dielines were available. The new detail view does not enlarge the old Supplement Facts/other-ingredients side. Original composites remain identified as original packaging, with the gelatin update stated separately.

`lib/softgel-details.ts` transcribes formulation amounts from BIOMOD-supplied label references for AZURE, BIONIC, LUMEN, SCULPTOR, DELTA and ERASER; NEXUS and CHISEL amounts come from their original package contents panels. The owner-confirmed September 6 gelatin correction is recorded in the Pro copy rules and label module. MCT oil and sunflower lecithin are documented for the six label-backed formulations only. The complete inactive declaration is not assumed for NEXUS or CHISEL. LUMEN's existing astaxanthin specification discrepancy stays unresolved rather than silently selecting a quantity.

The readable Ingredients view is HTML information, not an image of a current printed label or a batch assay. It contains no dosing instructions. Current full-label requests go to the existing contact form with the product prefilled; viewing the link sends nothing.

Validation: TypeScript; catalog-removal regression; desktop AZURE view selection, enlargement, previous/next wrap and modal focus; all eight ingredient panels at 390px without horizontal overflow; mobile ERASER enlargement; contact subject prefill. Initial controls are disabled until hydration so early clicks cannot be lost. SVG titles use a single text node to avoid server/client title parsing mismatches.
