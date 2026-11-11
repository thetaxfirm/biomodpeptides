# A downloaded label is named after the recipient — Nov 11 2026

## What the owner asked

> "can yuo make the name of the download of each lable the name of the person its going to so when
> i downlaod the shipping lables the name of the lable is the persons nale rathe rthan lable"

## Before

Three places named a label file, and none of them named a person:

| Where | Was | Now |
|---|---|---|
| Print label, the 4x6 PDF | `label-A8D80C15-4x6.pdf` | `Kim Leader A8D80C15.pdf` |
| Track page, Download label | `Order A8D80C15 label.png` | `Kim Leader A8D80C15.png` |
| The `download` attribute on that link | same as above | same as above |

A folder of files called `label-<id>` tells you nothing while matching printed labels to boxes.

## Why the order number stays on the end

Two orders for one person on one day is not hypothetical here: **#5EAFA34B** and **#9F9C7AA0**, both
Sam Miklosko, both Nov 8. Named by person alone they would download as `Sam Miklosko.pdf` and
`Sam Miklosko (1).pdf`, which is the confusion this change exists to remove. The eight-character
order number keeps them apart and still reads at a glance.

## `lib/label-filename.ts`

`safeNamePart()` removes everything an operating system or an HTTP header would choke on:

- The characters Windows rejects outright: `\ / : * ? " < > |`
- Control characters. Not all of them are whitespace, so collapsing runs of space does not cover
  this on its own — a NUL or DEL would otherwise reach the header as `%00` in the encoded copy.
- Leading and trailing dots and spaces: Windows refuses a trailing dot, and a leading one hides the
  file on Unix.
- Anything past 60 characters.

`labelFileName()` falls back to `Order <NUMBER> label` when the address carries no usable name, so
a missing name never produces a file called `.pdf`.

`contentDisposition()` writes the name twice: a plain ASCII `filename=` every client understands,
and an RFC 5987 `filename*=UTF-8''` so an accented or non-Latin name survives in the browsers that
read it. `José Muñoz` downloads under its real name and falls back to `Jos Muoz …` rather than
raw bytes in the header. A name written entirely in another alphabet strips to nothing in the ASCII
copy, so the extension is kept and given something to hold — `A8D80C15.pdf`, never `.pdf`.

## Checks

`tests/label-filename-v1.cjs`: the name leads and the order number separates two files for the same
customer; every rejected character class is removed; four separate control characters are checked
individually and confirmed absent from both the name and the encoded header; dot and space trimming;
length capping; three kinds of missing name all reach the fallback; the header carries both forms,
stays entirely within ASCII, contains exactly the two quotes that delimit the name, and still names
a file when the input has no ASCII at all. The three call sites are asserted wired.

Mutations verified to fail the suite: removing the illegal-character strip, removing the control-
character strip, dropping the order number, removing the dot trim, and removing quote escaping from
the header.

`tests/parcel-sheet-v1.cjs` now loads sibling library modules for real rather than refusing them.
The download's file name is part of what that page promises, and a stub would have hidden a break
in it.

`npm run check:release` — TypeScript and 125 isolated suites.

## Note

The 4x6 PDF is still served `inline`, so Print label opens it rather than dropping a file in
Downloads. The file name applies when it is saved. The Track page's Download label is unchanged in
that respect: it still sends `attachment` when asked to.
