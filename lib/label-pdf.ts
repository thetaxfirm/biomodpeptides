/**
 * A carrier label, wrapped in a PDF page that is exactly four inches by six.
 *
 * EasyPost hands back a PNG. A PNG carries no page size, so a browser invents one -- letter,
 * portrait, with margins -- and scales the image to fit it. That is why printing a label used to
 * mean a trip through the print dialog every time (owner, Nov 10 2026).
 *
 * The image is never decoded or re-encoded. A PNG's pixel data is a zlib stream with PNG
 * predictors, and PDF reads exactly that with /FlateDecode and /Predictor 15, so the IDAT bytes are
 * copied across untouched. What prints is the carrier's own artwork, bit for bit: no resampling,
 * no smoothing, nothing that could soften a barcode.
 */
const PT_PER_INCH = 72;
export const LABEL_WIDTH_PT = 4 * PT_PER_INCH;   // 288
export const LABEL_HEIGHT_PT = 6 * PT_PER_INCH;  // 432

export type PngInfo = { width: number; height: number; bitDepth: number; colorType: number; interlace: number; idat: Uint8Array; palette: Uint8Array | null };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** Reads the header and collects the pixel data. Returns null for anything that is not a PNG. */
export function readPng(bytes: Uint8Array): PngInfo | null {
    if (bytes.length < 8 + 25 || SIGNATURE.some((v, i) => bytes[i] !== v)) return null;
    let at = 8, width = 0, height = 0, bitDepth = 0, colorType = -1, interlace = 0;
    let palette: Uint8Array | null = null;
    const parts: Uint8Array[] = [];
    let seenHeader = false;
    while (at + 8 <= bytes.length) {
        const length = u32(bytes, at);
        // A declared length past the end of the buffer means the file is truncated, not that the
        // rest can be guessed at. Refuse rather than embed half a label.
        if (length > bytes.length - at - 12) return null;
        const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
        const from = at + 8;
        if (type === 'IHDR') {
            if (length !== 13) return null;
            width = u32(bytes, from); height = u32(bytes, from + 4);
            bitDepth = bytes[from + 8]; colorType = bytes[from + 9]; interlace = bytes[from + 12];
            seenHeader = true;
        }
        else if (type === 'PLTE') palette = bytes.subarray(from, from + length);
        else if (type === 'IDAT') parts.push(bytes.subarray(from, from + length));
        else if (type === 'IEND') break;
        at = from + length + 4;
    }
    if (!seenHeader || !parts.length || width < 1 || height < 1) return null;
    let size = 0;
    for (const part of parts) size += part.length;
    const idat = new Uint8Array(size);
    let written = 0;
    for (const part of parts) { idat.set(part, written); written += part.length; }
    return { width, height, bitDepth, colorType, interlace, idat, palette };
}

/** How many samples per pixel the colour type carries, or 0 when PDF cannot read it directly. */
function colorsFor(info: PngInfo): number {
    if (info.colorType === 0) return 1;             // greyscale
    if (info.colorType === 2) return 3;             // truecolour
    if (info.colorType === 3) return 1;             // palette index
    return 0;                                        // 4 and 6 carry alpha; 1 and 5 do not exist
}

/**
 * True when the pixel data can be handed to PDF untouched. Interlaced images are stored in seven
 * passes, which is not what /Predictor 15 expects, and an alpha channel needs a soft mask that a
 * shipping label never has any use for.
 */
export function canEmbed(info: PngInfo): boolean {
    if (info.interlace !== 0) return false;
    if (![1, 2, 4, 8, 16].includes(info.bitDepth)) return false;
    if (info.colorType === 3 && (!info.palette || info.palette.length < 3 || info.bitDepth > 8)) return false;
    return colorsFor(info) > 0;
}

const encoder = new TextEncoder();
const bytesOf = (text: string) => encoder.encode(text);
/** PDF strings are Latin-1; a label's artwork is binary, so only the palette needs escaping. */
const pdfHexString = (bytes: Uint8Array) => {
    let out = '<';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out + '>';
};

/**
 * Places the image on the page at its true aspect ratio, centred, never stretched. A label that is
 * already 2:3 fills the page edge to edge, which is every label this store has bought. One that is
 * not keeps its proportions and gains white space: a barcode squeezed to fit the paper is a barcode
 * the post office cannot read.
 */
export function placement(width: number, height: number): { w: number; h: number; x: number; y: number; rotate: boolean } {
    // A landscape label is turned upright so it prints along the roll rather than across it.
    const rotate = width > height;
    const w = rotate ? height : width, h = rotate ? width : height;
    const scale = Math.min(LABEL_WIDTH_PT / w, LABEL_HEIGHT_PT / h);
    const drawW = w * scale, drawH = h * scale;
    return { w: drawW, h: drawH, x: (LABEL_WIDTH_PT - drawW) / 2, y: (LABEL_HEIGHT_PT - drawH) / 2, rotate };
}

/**
 * The finished PDF, or null when the image is one PDF cannot read directly. A null is a signal to
 * send the caller to the carrier's own file: a label that opens awkwardly beats no label at all.
 */
export function labelPdf(png: Uint8Array): Uint8Array | null {
    const info = readPng(png);
    if (!info || !canEmbed(info)) return null;
    const colors = colorsFor(info);
    const space = info.colorType === 3
        ? '[/Indexed /DeviceRGB ' + (info.palette!.length / 3 - 1) + ' ' + pdfHexString(info.palette!) + ']'
        : colors === 3 ? '/DeviceRGB' : '/DeviceGray';
    const put = placement(info.width, info.height);
    // The matrix maps the unit square the image is drawn in onto the page. Rotating swaps the axes
    // and steps the origin across, because PDF rotates about the origin, not about the artwork.
    const matrix = put.rotate
        ? [0, put.h, -put.w, 0, put.x + put.w, put.y].map(n => n.toFixed(4)).join(' ')
        : [put.w, 0, 0, put.h, put.x, put.y].map(n => n.toFixed(4)).join(' ');
    const content = bytesOf('q\n' + matrix + ' cm\n/Im0 Do\nQ\n');

    const objects: Uint8Array[] = [
        bytesOf('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
        bytesOf('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
        bytesOf('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + LABEL_WIDTH_PT + ' ' + LABEL_HEIGHT_PT + ']'
            + ' /CropBox [0 0 ' + LABEL_WIDTH_PT + ' ' + LABEL_HEIGHT_PT + ']'
            + ' /TrimBox [0 0 ' + LABEL_WIDTH_PT + ' ' + LABEL_HEIGHT_PT + ']'
            + ' /BleedBox [0 0 ' + LABEL_WIDTH_PT + ' ' + LABEL_HEIGHT_PT + ']'
            + ' /Rotate 0 /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'),
        concat(
            bytesOf('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + info.width + ' /Height ' + info.height
                + ' /ColorSpace ' + space + ' /BitsPerComponent ' + info.bitDepth + ' /Filter /FlateDecode'
                + ' /DecodeParms << /Predictor 15 /Colors ' + colors + ' /BitsPerComponent ' + info.bitDepth + ' /Columns ' + info.width + ' >>'
                + ' /Length ' + info.idat.length + ' >>\nstream\n'),
            info.idat,
            bytesOf('\nendstream\nendobj\n')),
        concat(bytesOf('5 0 obj\n<< /Length ' + content.length + ' >>\nstream\n'), content, bytesOf('\nendstream\nendobj\n')),
    ];

    const head = bytesOf('%PDF-1.4\n%âãÏÓ\n');
    const offsets: number[] = [];
    let at = head.length;
    for (const object of objects) { offsets.push(at); at += object.length; }
    let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    for (const offset of offsets) xref += String(offset).padStart(10, '0') + ' 00000 n \n';
    xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + at + '\n%%EOF\n';
    return concat(head, ...objects, bytesOf(xref));
}

function concat(...parts: Uint8Array[]): Uint8Array {
    let size = 0;
    for (const part of parts) size += part.length;
    const out = new Uint8Array(size);
    let written = 0;
    for (const part of parts) { out.set(part, written); written += part.length; }
    return out;
}
