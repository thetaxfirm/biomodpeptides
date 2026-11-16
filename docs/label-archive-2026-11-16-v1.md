# Waiting labels download as a dated folder of 4×6 PDFs — Nov 16 2026

## What the owner asked

> "can you fix it when i press the print all lables button it makes it really shitty i want them to
> all be border less 4x6 print ready lables and i just click and it automatically downloads them
> all singles in a folder with the date as the save file so i know where they are coming from"

## What the button used to do

`/api/admin/labels` returned an **HTML page**: a heading, a metadata line, and one `<img>` per
label with `border:1px solid #ccc` around it. Printing that gave browser margins, a header and
footer, a visible border and whatever scaling the browser guessed at. On a 4×6 label printer it was
unusable.

The single-order route next to it (`/api/admin/label?id=…`) had been doing the right thing since
Nov 10: a PDF page exactly four inches by six, borderless, no scaling, press print and walk away.
The bulk button simply never used it.

## What it does now

One press downloads `biomod-labels-2026-11-16.zip`. Inside is a single folder of the same name
holding one PDF per parcel, each the same borderless 4×6 page the single-label route already
serves, each named after whoever it is going to:

```
biomod-labels-2026-11-16/
  Adan-Candelaria-9D76224C.pdf
  Thomas-Fenn-21100479.pdf
  Nick-leonard-A6C7ACE3.pdf
```

A browser cannot be handed a folder, so **the zip is the folder**: every entry sits under one
directory rather than at the archive root, so unzipping always produces that folder instead of
scattering loose files into Downloads. The date is the **Pacific shipping day**, not the server's
UTC day — printing at 5 p.m. in Nevada must not produce a folder named tomorrow.

## The archive — `lib/label-archive.ts`

Entries are STORED rather than deflated. A PDF carrying an already-compressed label image does not
shrink, and storing keeps the writer small enough to read in one sitting, which matters more here
than a few per cent: a wrong byte in an archive is a day of parcels nobody can post.

- **Repeated names are numbered, not overwritten.** Two parcels for the same person on the same day
  would otherwise collide and the second would quietly win on extraction.
- **Names cannot escape the folder.** They are built from saved customer data, so everything
  outside `[A-Za-z0-9._-]` is replaced, runs of dots are collapsed, and leading dots and dashes are
  stripped. `../../etc/passwd` becomes `etc-passwd`.
- **An empty archive is still a valid archive** — just the end-of-central-directory record, not a
  truncated file.

## The route

Read-only, as before: it serves labels the carrier already issued and buys, changes and voids
nothing. Its one query is a `SELECT`, and it calls no writing helper; a test checks that against
what it runs rather than what its messages say.

A label that cannot be fetched or converted is **left out rather than failing the whole download**,
and `X-Label-Count` / `X-Label-Skipped` say what made it, so a short folder is never mistaken for
the whole day's work. At most 60 labels per press, fetched six at a time: waiting labels are
normally a handful, and a hundred carrier fetches in one request is how this stops finishing.

Only the carrier's own `https://` file is ever fetched. The stored value decides what is requested,
so a malformed record stops there rather than becoming a request to anywhere.

## Checks

`tests/label-archive-v1.cjs` builds archives and **reads them back entry by entry** with an
independent parser — end-of-central-directory, central directory, and each local header — and
re-derives every checksum with Node's own `zlib.crc32` rather than trusting the writer's own
arithmetic. A zip that looks fine and extracts wrong is exactly the failure that looks like a
working download until someone tries to open it.

It also covers: the Pacific-day folder name, one folder for every entry, numbered duplicates, name
escaping, byte-for-byte binary round trips, the empty archive, and the route staying read-only and
serving as a download.

Verified outside the suite as well: the archive passes `python3 -m zipfile` CRC testing and
`unzip -t`, and extracts to a folder of individual PDFs.

Mutations verified to fail: counting the end record inside the central directory size, skipping
crc32's final inversion, dropping the folder prefix, letting a repeated name overwrite, letting
doubled dots survive a name, naming the folder from the server's day instead of the shipping day,
serving `inline` instead of `attachment`, and putting the button back to opening a tab.

`npm run check:release` — TypeScript and 133 isolated suites.

## What was removed

`renderLabelSheet` and its HTML. `lib/label-sheet.ts` keeps what it was good at — deciding which
labels are waiting, and describing each one — and `tests/label-sheet-v1.cjs` keeps those checks.

## Known limit

One press is one archive of up to 60 labels. Beyond that the rest wait for a second press; nothing
is lost and nothing is double-printed, because printing changes no order.
