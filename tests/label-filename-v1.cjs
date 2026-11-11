// Downloaded labels are named after the recipient (owner, Nov 11 2026). Pure functions; no I/O.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name; m.require = id => { throw Error('Unexpected dependency ' + id); };
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, name);
  return m.exports;
}
const F = load('lib/label-filename.ts');
const ID = 'a8d80c15-6783-4052-81e9-e690bcfe7cd8';

// --- The name leads, the order number keeps two of them apart ---
assert.equal(F.labelFileName(ID, 'Kim Leader', 'pdf'), 'Kim Leader A8D80C15.pdf');
assert.equal(F.labelFileName(ID, 'Kim Leader', 'png'), 'Kim Leader A8D80C15.png');
// Two orders for one person is why the number stays: without it a folder gets "name (1).pdf".
const a = F.labelFileName('5eafa34b-cc12-4c58-9c08-8899f59607b8', 'Sam Miklosko', 'pdf');
const b = F.labelFileName('9f9c7aa0-afc0-46de-8c89-1d2c3127453e', 'Sam Miklosko', 'pdf');
assert.notEqual(a, b, 'the same customer twice still gets two distinct files');
assert.equal(a, 'Sam Miklosko 5EAFA34B.pdf'); assert.equal(b, 'Sam Miklosko 9F9C7AA0.pdf');

// --- Nothing that breaks a file system, a shell or an HTTP header ---
assert.equal(F.safeNamePart('Kim / Leader'), 'Kim Leader', 'a slash would read as a directory');
assert.equal(F.safeNamePart('a\\b:c*d?e"f<g>h|i'), 'a b c d e f g h i', 'every character Windows rejects');
assert(!F.safeNamePart('Kim\r\nSet-Cookie: x=1').includes('\n'), 'a newline cannot split the header in two');
// Not every control character is whitespace, so collapsing runs of space does not cover this on
// its own: a NUL or a DEL would otherwise reach the header as %00 in the encoded copy.
for (const bad of ['\u0000', '\u0007', '\u001f', '\u007f']) {
  const out = F.safeNamePart('Kim' + bad + 'Leader');
  assert.equal(out, 'Kim Leader', JSON.stringify(bad) + ' is removed');
  assert(!/[\u0000-\u001f\u007f]/.test(out), JSON.stringify(bad) + ' never survives');
  assert(!F.contentDisposition('inline', F.labelFileName(ID, 'Kim' + bad + 'Leader', 'pdf')).includes('%0'), 'nor reaches the encoded header');
}
assert.equal(F.safeNamePart('  Kim   Leader  '), 'Kim Leader', 'runs of space collapse');
assert.equal(F.safeNamePart('.hidden'), 'hidden', 'a leading dot would hide the file');
assert.equal(F.safeNamePart('Kim Leader.'), 'Kim Leader', 'Windows refuses a trailing dot');
assert.equal(F.safeNamePart('x'.repeat(200)).length, 60, 'long names are cut to a sane length');
assert.equal(F.safeNamePart('x'.repeat(200), 10).length, 10);

// --- No name recorded is not a file called ".pdf" ---
assert.equal(F.labelFileName(ID, '', 'pdf'), 'Order A8D80C15 label.pdf');
assert.equal(F.labelFileName(ID, null, 'pdf'), 'Order A8D80C15 label.pdf');
assert.equal(F.labelFileName(ID, undefined, 'pdf'), 'Order A8D80C15 label.pdf');
assert.equal(F.labelFileName(ID, '///', 'pdf'), 'Order A8D80C15 label.pdf', 'a name that cleans away to nothing falls back too');
assert.equal(F.labelFileName(ID, '   ', 'pdf'), 'Order A8D80C15 label.pdf');
assert.equal(F.orderNumber(ID), 'A8D80C15');

// --- The header carries the name twice so an accent survives ---
const plain = F.contentDisposition('inline', 'Kim Leader A8D80C15.pdf');
assert.equal(plain, 'inline; filename="Kim Leader A8D80C15.pdf"; filename*=UTF-8\'\'Kim%20Leader%20A8D80C15.pdf');
const accented = F.contentDisposition('attachment', 'José Muñoz A8D80C15.pdf');
assert(accented.startsWith('attachment; filename="Jos Muoz A8D80C15.pdf"'), 'the quoted copy is plain ASCII, never raw bytes');
assert(accented.includes("filename*=UTF-8''Jos%C3%A9%20Mu%C3%B1oz%20A8D80C15.pdf"), 'and the encoded copy keeps the real name');
assert(!/[^\x20-\x7e]/.test(accented), 'the whole header stays within ASCII');
// A quote or backslash in the ASCII copy would end the quoted string early.
const tricky = F.contentDisposition('inline', 'He said "hi" A8D80C15.pdf');
assert.equal((tricky.match(/"/g) || []).length, 2, 'exactly the two quotes that delimit the name');
assert(!tricky.includes('\\'));
assert.equal(F.contentDisposition('inline', '日本.pdf').split(';')[1].trim(), 'filename="label.pdf"', 'a name with no ASCII at all still has a usable fallback');

// --- Wiring: every label download uses it ---
const route = fs.readFileSync(path.join(root, 'app/api/admin/label/route.ts'), 'utf8');
assert.match(route, /contentDisposition\('inline', labelFileName\(id, saved\.address\?\.name, 'pdf'\)\)/, 'the 4x6 PDF is named after the recipient');
assert(!/filename="label-/.test(route), 'and no longer called label-<id>');
const sheet = fs.readFileSync(path.join(root, 'lib/parcel-sheet.ts'), 'utf8');
assert.match(sheet, /labelFile: labelFileName\(order\.id, a\.name, 'png'\)/, 'so is the parcel page download');
assert(!/'Order ' \+ number\.slice\(1\) \+ ' label\.png'/.test(sheet));
const parcel = fs.readFileSync(path.join(root, 'app/api/admin/parcel/route.ts'), 'utf8');
assert.match(parcel, /contentDisposition\(req\.nextUrl\.searchParams\.get\('download'\) \? 'attachment' : 'inline', entry\.labelFile\)/);

console.log('PASS: a downloaded label is named after the person it is going to, with the order number keeping two of the same name apart, every character a file system or HTTP header would choke on removed, a fallback when no name was recorded, and both the ASCII and UTF-8 forms in the header.');
