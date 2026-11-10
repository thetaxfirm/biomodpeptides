# Print label gives a 4x6 page — Nov 10 2026

## What the owner asked

> "these need to be print ready borderless pdf files that are made perfectly for a 4x6 shipping
> label printer ready to print i dont ant to have to edit them or anything i dont want to have to
> make them fit page or anything"

> "i want to brainlessly print them and thats it"

## Why it was wrong

The store never asked EasyPost for a particular label format; it saved whatever `label_url`
returned. For this account that is a **PNG** — all 27 labels on file are `.png` — and **Print
label** linked straight to it.

A PNG carries no page size. The browser invents one, which is letter, portrait, with margins, and
scales the image into it. Hence the print dialog every single time.

Asking EasyPost for PDF instead would not have fixed it: the one PDF label seen in this account
came back letter-sized with the label in a corner, the same problem by a different route. So the
format EasyPost returns is not trusted either way.

## What it does now

`GET /api/admin/label?id=<orderId>`, behind `orders:read`, fetches the stored `labelUrl` and
returns a PDF of exactly one page, 288 x 432 pt — 4.000 x 6.000 in — with MediaBox, CropBox,
TrimBox and BleedBox all at the origin and `/Rotate 0`.

`lib/label-pdf.ts` does the work with no dependencies, so it runs in the Worker.

**The image is never decoded or re-encoded.** A PNG's pixel data is a zlib stream carrying PNG
predictors, and PDF reads exactly that with `/FlateDecode` and `/Predictor 15`. The IDAT bytes are
copied across untouched. What prints is the carrier's own artwork bit for bit at full resolution —
no resampling, no smoothing, nothing that could soften a barcode. Verified against Kim Leader's
real label: the embedded image is pixel-identical to EasyPost's file, and poppler renders the page
at 1200x1800 with ink touching all four edges.

### Shape

A 2:3 label fills the page edge to edge, which is every label this store has bought. Anything else
keeps its proportions and gains white space rather than being stretched: a squeezed barcode is one
the post office cannot read. A landscape label is turned upright so it prints along the roll.

### When it cannot

Interlaced PNGs, and any with an alpha channel, are not something PDF reads directly. Rather than
fail, the route redirects to the carrier's own file: a label that opens awkwardly beats no label.

### Where it is wired

Both **Print label** controls — the queue row and the order panel — and the window that opens right
after a label is bought. The label preview in the order panel still shows the carrier's PNG, since
that is a preview and not a print.

The customer's own "View label" link is untouched; it points at the carrier file and must not
reach an admin route.

The route is read-only: it contains no INSERT, UPDATE or DELETE, and sends `Cache-Control:
no-store`, because a cached label is how yesterday's parcel gets posted twice.

## Checks

`tests/label-pdf-v1.cjs` builds real PNGs byte by byte — correct CRCs, pixel data split across two
IDAT chunks — and asserts: every page box is exactly 4x6 at the origin; one page only; the original
IDAT bytes appear in the output unaltered with `/Predictor 15`; greyscale, truecolour and palette
each map to the right colour space and sample count; alpha, interlaced and palette-without-a-palette
are refused; a truncated file is refused rather than half embedded; a square label is centred and
unstretched; a landscape one is rotated and the content-stream matrix is checked; and every byte
offset in the xref table points at the object it claims.

Mutations verified to fail the suite: changing the page height, swapping contain for cover,
removing the interlace guard, removing rotation, keeping only the first IDAT chunk, removing the
truncation guard, dropping the PNG predictor, and getting the RGB sample count wrong.

`npm run check:release` — TypeScript and 124 isolated suites.

## Printing

The file is exactly the paper size, so there is nothing to fit. If a print dialog is still set to
"Fit to page" or "Shrink oversized pages" it will shrink a correct file anyway; set it to **Actual
Size / 100%** once. No PDF can override that setting from inside.
