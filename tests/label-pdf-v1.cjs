// Label printing (owner, Nov 10 2026): a bought label becomes a page exactly 4in x 6in so that
// pressing print is the whole job. Synthetic PNGs built here; no network, no orders, no carrier.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const zlib = require('node:zlib'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name; m.require = id => { throw Error('Unexpected dependency ' + id); };
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, name);
  return m.exports;
}
const L = load('lib/label-pdf.ts');

// --- A real PNG, built byte by byte, so the parser is tested against the actual format. ---
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const be32 = n => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'); return Buffer.concat([be32(data.length), t, data, be32(crc32(Buffer.concat([t, data])))]); };
function png({ width, height, bitDepth = 8, colorType = 0, interlace = 0, palette = null, raw = null }) {
  const samples = colorType === 2 ? 3 : 1;
  const rowBytes = Math.ceil((width * samples * bitDepth) / 8);
  const body = raw || Buffer.concat(Array.from({ length: height }, (_, y) => {
    const row = Buffer.alloc(rowBytes + 1); row[0] = 0;               // filter: none
    for (let i = 0; i < rowBytes; i++) row[i + 1] = (y * 7 + i * 13) & 0xff;
    return row;
  }));
  const ihdr = Buffer.concat([be32(width), be32(height), Buffer.from([bitDepth, colorType, 0, 0, interlace])]);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (palette) parts.push(chunk('PLTE', palette));
  // Two IDATs on purpose: a PNG may split its pixel data, and a reader that takes only the first
  // produces a PDF that opens and is silently wrong, which is the worst kind of wrong for a label.
  const z = zlib.deflateSync(body);
  parts.push(chunk('IDAT', z.subarray(0, 10)), chunk('IDAT', z.subarray(10)), chunk('IEND', Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
}
const text = bytes => Buffer.from(bytes).toString('latin1');

// --- Reading ---
const grey = png({ width: 1200, height: 1800 });
const info = L.readPng(grey);
assert.equal(info.width, 1200); assert.equal(info.height, 1800);
assert.equal(info.bitDepth, 8); assert.equal(info.colorType, 0); assert.equal(info.interlace, 0);
assert.equal(text(info.idat), text(zlib.deflateSync(Buffer.concat(Array.from({ length: 1800 }, (_, y) => {
  const row = Buffer.alloc(1201); row[0] = 0;
  for (let i = 0; i < 1200; i++) row[i + 1] = (y * 7 + i * 13) & 0xff;
  return row;
})))), 'every IDAT is joined, in order');
assert.equal(L.readPng(new Uint8Array([1, 2, 3])), null, 'a short buffer is not a PNG');
assert.equal(L.readPng(new Uint8Array(40)), null, 'nor is a buffer with no signature');
// A chunk claiming more bytes than exist is a truncated download, not something to guess at.
const truncated = grey.slice(0, grey.length - 40);
assert.equal(L.readPng(truncated), null, 'a truncated file is refused rather than half embedded');

// --- What PDF can carry directly ---
assert.equal(L.canEmbed(L.readPng(grey)), true, 'greyscale');
assert.equal(L.canEmbed(L.readPng(png({ width: 8, height: 8, colorType: 2 }))), true, 'truecolour');
assert.equal(L.canEmbed(L.readPng(png({ width: 8, height: 8, colorType: 3, bitDepth: 8, palette: Buffer.alloc(9) }))), true, 'palette');
assert.equal(L.canEmbed(L.readPng(png({ width: 8, height: 8, colorType: 3, bitDepth: 8 }))), false, 'a palette image with no palette is refused');
assert.equal(L.canEmbed(L.readPng(png({ width: 8, height: 8, colorType: 6 }))), false, 'alpha needs a soft mask a label never uses');
assert.equal(L.canEmbed(L.readPng(png({ width: 8, height: 8, colorType: 4 }))), false, 'greyscale with alpha too');
assert.equal(L.canEmbed(L.readPng(png({ width: 8, height: 8, interlace: 1 }))), false, 'interlaced is seven passes, not what the predictor expects');
assert.equal(L.labelPdf(png({ width: 8, height: 8, colorType: 6 })), null, 'and an unreadable image yields no PDF at all');
assert.equal(L.labelPdf(new Uint8Array([1, 2, 3])), null);

// --- The page is exactly four inches by six, every time ---
assert.equal(L.LABEL_WIDTH_PT, 288); assert.equal(L.LABEL_HEIGHT_PT, 432);
const pdf = text(L.labelPdf(grey));
for (const box of ['MediaBox', 'CropBox', 'TrimBox', 'BleedBox'])
  assert(pdf.includes('/' + box + ' [0 0 288 432]'), box + ' is exactly 4in x 6in at the origin');
assert(pdf.includes('/Rotate 0'), 'and never asks the printer to turn it');
assert(pdf.startsWith('%PDF-1.4'), 'it is a PDF'); assert(pdf.trimEnd().endsWith('%%EOF'), 'and a complete one');
assert.equal((pdf.match(/\/Type \/Page[^s]/g) || []).length, 1, 'one page, so one press of print is one label');

// --- The carrier's artwork is copied, never redrawn ---
assert(pdf.includes('/Filter /FlateDecode'), 'the pixel data is handed over as it arrived');
assert(pdf.includes('/DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns 1200 >>'), 'with the PNG predictor PDF reads natively');
assert(pdf.includes('/ColorSpace /DeviceGray'));
assert(pdf.includes('/Width 1200'), 'at full resolution'); assert(pdf.includes('/Height 1800'));
assert(pdf.includes(text(L.readPng(grey).idat)), 'the original bytes are present, unaltered');
assert(text(L.labelPdf(png({ width: 8, height: 8, colorType: 2 }))).includes('/ColorSpace /DeviceRGB'));
const indexed = text(L.labelPdf(png({ width: 4, height: 4, colorType: 3, bitDepth: 8, palette: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]) })));
assert(indexed.includes('/ColorSpace [/Indexed /DeviceRGB 2 <ff000000ff000000ff>]'), 'a palette is carried across as an indexed space, highest index and all');
assert(indexed.includes('/Colors 1'), 'and its samples are single indices, not three channels');

// --- Shape: filled when it fits, never stretched when it does not ---
const exact = L.placement(1200, 1800);
assert.deepEqual(exact, { w: 288, h: 432, x: 0, y: 0, rotate: false }, 'a 2:3 label fills the page edge to edge');
const square = L.placement(1000, 1000);
assert.equal(square.w, 288); assert.equal(square.h, 288);
assert.equal(square.x, 0); assert.equal(square.y, 72, 'a square label is centred, not squashed');
assert.equal(square.w / square.h, 1, 'its proportions are untouched: a stretched barcode will not scan');
const wide = L.placement(1800, 1200);
assert.equal(wide.rotate, true, 'a landscape label is turned upright for the roll');
assert.equal(wide.w, 288); assert.equal(wide.h, 432, 'and then fills the page');
assert.equal(L.placement(1200, 1800).rotate, false);
// The matrix for a rotated label steps the origin across, because PDF turns about the origin.
assert(text(L.labelPdf(png({ width: 180, height: 120 }))).includes('0.0000 432.0000 -288.0000 0.0000 288.0000 0.0000 cm'), 'rotation is applied in the content stream');
assert(pdf.includes('288.0000 0.0000 0.0000 432.0000 0.0000 0.0000 cm'), 'and an upright label is placed without rotation');

// --- The byte offsets in the table point where they say ---
const bytes = L.labelPdf(grey), flat = text(bytes);
const startxref = Number(/startxref\s+(\d+)/.exec(flat)[1]);
assert.equal(flat.slice(startxref, startxref + 4), 'xref', 'startxref lands on the table');
const rows = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(flat);
assert.equal(Number(rows[1]), 6, 'five objects and the free head');
const offsets = rows[2].trim().split('\n').slice(1).map(line => Number(line.slice(0, 10)));
offsets.forEach((offset, i) => assert.equal(flat.slice(offset, offset + 8).trim().split(' ')[0], String(i + 1), 'object ' + (i + 1) + ' begins where the table says'));

// --- Wiring: the admin prints through the route, not the carrier's raw file ---
const routeSource = fs.readFileSync(path.join(root, 'app/api/admin/label/route.ts'), 'utf8');
assert.match(routeSource, /requireStaff\('orders:read'\)/, 'staff only');
assert.match(routeSource, /\/\^https:\\\/\\\/\[\^\\s\]\+\$\/i\.test\(source\)/, 'only an https carrier file is ever fetched');
assert.match(routeSource, /'Cache-Control': 'no-store'/, 'a cached label is how a parcel gets posted twice');
assert.match(routeSource, /NextResponse\.redirect\(source, 302\)/, 'an unreadable format still gets the operator a label');
assert(!/DELETE|INSERT|UPDATE/i.test(routeSource), 'printing changes nothing');
for (const file of ['components/store/orders-admin.tsx', 'components/store/shipping-admin.tsx']) {
  const ui = fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(ui, /href=\{'\/api\/admin\/label\?id=' \+ encodeURIComponent\(o(rder)?\.id\)\}/, file + ' prints through the 4x6 route');
  assert(!/href=\{s\.labelUrl\}/.test(ui), file + ' no longer links the raw carrier file to print');
}
assert.match(fs.readFileSync(path.join(root, 'components/store/shipping-admin.tsx'), 'utf8'),
  /window\.open\('\/api\/admin\/label\?id=' \+ encodeURIComponent\(order\.id\)/, 'and a freshly bought label opens print-ready');

console.log('PASS: a bought label becomes a single page exactly 4in x 6in, with the carrier artwork copied byte for byte at full resolution, never stretched, landscape turned upright, unreadable formats handed back to the carrier file, and every Print label control routed through it. Synthetic PNGs only.');
