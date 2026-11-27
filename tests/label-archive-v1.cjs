// The dated folder of print-ready labels (owner, Nov 16 2026). The archive this builds is read
// back here entry by entry and every checksum is re-derived with Node's own crc32, because a zip
// that looks fine and extracts wrong is a day of parcels nobody can post. No network, no records.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const zlib = require('node:zlib'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name; m.paths = Module._nodeModulePaths(root);
  m.require = id => id.startsWith('./') || id.startsWith('@/')
    ? load(id.replace(/^@\//, '').replace(/^\.\//, 'lib/') + (id.endsWith('.ts') ? '' : '.ts'))
    : require(id);
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { module: 1, target: 9, esModuleInterop: true } }).outputText, name);
  return m.exports;
}
const A = load('lib/label-archive.ts');
global.fetch = () => { throw Error('Building an archive never reaches the network'); };

// An independent reader: parses the end-of-central-directory, walks the central directory, and
// reads each file back out of its own local header. Nothing here reuses the writer's arithmetic.
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  for (; eocd >= 0; eocd--) if (view.getUint32(eocd, true) === 0x06054b50) break;
  assert(eocd >= 0, 'the archive ends with an end-of-central-directory record');
  const count = view.getUint16(eocd + 10, true), size = view.getUint32(eocd + 12, true), start = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint16(eocd + 8, true), count, 'this disk holds every entry');
  assert.equal(start + size, eocd, 'the central directory ends exactly where the record begins');
  const out = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'central header ' + i);
    const crc = view.getUint32(at + 16, true), comp = view.getUint32(at + 20, true), full = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    // Now the local header the offset points at, and the bytes after it.
    assert.equal(view.getUint32(offset, true), 0x04034b50, 'local header for ' + name);
    const localName = view.getUint16(offset + 26, true), localExtra = view.getUint16(offset + 28, true);
    assert.equal(new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + localName)), name, 'both headers name ' + name + ' the same');
    assert.equal(view.getUint32(offset + 14, true), crc, 'both headers agree on the checksum of ' + name);
    assert.equal(view.getUint16(offset + 8, true), 0, 'stored, not deflated');
    const from = offset + 30 + localName + localExtra;
    const data = bytes.subarray(from, from + comp);
    out.push({ name, crc, size: full, data });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const bytes = (text) => new TextEncoder().encode(text);
const NOON_PACIFIC = Date.parse('2026-11-16T20:00:00Z');   // noon on Nov 16 in Los Angeles

// --- The name is the shipping day, not the server's day ---
assert.equal(A.archiveFolder(NOON_PACIFIC), 'biomod-labels-2026-11-16');
assert.equal(A.archiveName(NOON_PACIFIC), 'biomod-labels-2026-11-16.zip');
// 1 a.m. UTC on the 17th is still the 16th where the parcels are, and the folder has to agree
// with the day the labels were printed or the morning's folder is named tomorrow.
assert.equal(A.archiveFolder(Date.parse('2026-11-17T01:00:00Z')), 'biomod-labels-2026-11-16');

// --- A real archive, read back ---
const archive = A.zipArchive([
  { name: 'Adan-Candelaria-9D76224C.pdf', bytes: bytes('%PDF-1.4 first label') },
  { name: 'Thomas-Fenn-21100479.pdf', bytes: bytes('%PDF-1.4 second label') },
], NOON_PACIFIC);
const read = readZip(archive);
assert.equal(read.length, 2);
assert.deepEqual(read.map(f => f.name), [
  'biomod-labels-2026-11-16/Adan-Candelaria-9D76224C.pdf',
  'biomod-labels-2026-11-16/Thomas-Fenn-21100479.pdf',
], 'every entry sits inside one dated folder, so unzipping never scatters loose files');
for (const file of read) {
  // The checksum is re-derived here rather than trusted: a wrong crc is exactly the failure that
  // looks like a working download until someone tries to open it.
  assert.equal(file.crc, zlib.crc32(Buffer.from(file.data)), 'checksum of ' + file.name);
  assert.equal(file.size, file.data.length, 'declared size matches the bytes of ' + file.name);
}
assert.equal(new TextDecoder().decode(read[0].data), '%PDF-1.4 first label', 'contents survive the round trip');
assert.equal(new TextDecoder().decode(read[1].data), '%PDF-1.4 second label');

// --- Two parcels for the same person on the same day both survive ---
const twins = readZip(A.zipArchive([
  { name: 'Sam-Miklosko.pdf', bytes: bytes('one') },
  { name: 'Sam-Miklosko.pdf', bytes: bytes('two') },
  { name: 'Sam-Miklosko.pdf', bytes: bytes('three') },
], NOON_PACIFIC));
assert.deepEqual(twins.map(f => f.name.split('/')[1]), ['Sam-Miklosko.pdf', 'Sam-Miklosko-2.pdf', 'Sam-Miklosko-3.pdf'],
  'a repeated name is numbered rather than silently overwriting the first on extraction');
assert.deepEqual(twins.map(f => new TextDecoder().decode(f.data)), ['one', 'two', 'three']);

// --- Names come from saved customer data, so they must not be able to escape the folder ---
for (const [given, expected] of [
  ['../../etc/passwd', 'etc-passwd'],
  ['..\\..\\windows\\system32', 'windows-system32'],
  ['/absolute/path.pdf', 'absolute-path.pdf'],
  ['....//....//x.pdf', 'x.pdf'],
  ['a\u0000b\u001fc.pdf', 'a-b-c.pdf'],
  ['report..pdf', 'report.pdf'],
  ['a...b..c.pdf', 'a.b.c.pdf'],
  ['', 'fallback.pdf'],
  ['...', 'fallback.pdf'],
]) assert.equal(A.safeEntryName(given, 'fallback.pdf'), expected, JSON.stringify(given));
const hostile = readZip(A.zipArchive([{ name: '../../escape.pdf', bytes: bytes('x') }], NOON_PACIFIC));
assert.equal(hostile[0].name, 'biomod-labels-2026-11-16/escape.pdf');
for (const file of hostile) {
  assert(!file.name.includes('..'), 'no entry can climb out of the folder');
  assert.equal(file.name.split('/').length, 2, 'and no entry invents a deeper path');
  assert(!file.name.startsWith('/'), 'nor an absolute one');
}

// --- An empty archive is still a valid one, not a truncated file ---
const empty = A.zipArchive([], NOON_PACIFIC);
assert.deepEqual(readZip(empty), []);
assert.equal(empty.length, 22, 'just the end-of-central-directory record');

// --- Binary is carried byte for byte; a PDF is not text ---
const binary = new Uint8Array(512);
for (let i = 0; i < binary.length; i++) binary[i] = (i * 7) % 256;
const back = readZip(A.zipArchive([{ name: 'label.pdf', bytes: binary }], NOON_PACIFIC))[0];
assert.deepEqual(Buffer.from(back.data), Buffer.from(binary), 'every byte of a binary entry survives');
assert.equal(back.crc, zlib.crc32(Buffer.from(binary)));
assert.equal(A.crc32(binary), zlib.crc32(Buffer.from(binary)), 'our crc32 agrees with the platform on binary input');
assert.equal(A.crc32(new Uint8Array(0)), zlib.crc32(Buffer.alloc(0)), 'and on nothing at all');

// --- The route serves it as a download, and still buys nothing ---
const route = fs.readFileSync(path.join(root, 'app/api/admin/labels/route.ts'), 'utf8');
assert.match(route, /contentDisposition\('attachment', archiveName\(now\)\)/, 'it downloads rather than opening a tab');
assert.match(route, /'Content-Type': 'application\/zip'/);
assert.match(route, /labelPdf\(/, 'each entry is the same borderless 4x6 PDF the single label route serves');
assert.match(route, /requireStaff\('orders:fulfill'\)/);
// Read-only, checked against what it runs rather than what it says: its one query is a SELECT,
// and it calls none of the writing helpers.
const code = route.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const queries = code.match(/"(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*?"/gi) || [];
assert.match(code, /printableOrders\(database\(\), 'labels'/, 'selection is delegated to the complete eligible database queue');
assert.equal(queries.length, 0, 'the route does not issue ad-hoc writes or limited queries');
assert.match(route, /Label download manifest v1\.txt/);
assert(!/\brun\(|\bauditRun\(|\brecordChange\(/.test(code), 'it calls no writing helper: printing a label never changes an order');
assert.match(route, /\/\^https:\\\/\\\/\[\^\\s\]\+\$\/i\.test\(entry\.labelUrl\)/, 'only the carrier own https file is ever fetched');
const ui = fs.readFileSync(path.join(root, 'components/store/orders-admin.tsx'), 'utf8');
assert.match(ui, /href="\/api\/admin\/labels" download/, 'the button downloads');
assert.doesNotMatch(ui, /href="\/api\/admin\/labels" target/, 'and no longer opens a print page');

console.log('PASS: waiting labels download as one dated folder of borderless 4x6 PDFs; the archive is read back entry by entry with every checksum re-derived from Node\'s own crc32, repeated names are numbered rather than overwritten, names built from customer data cannot escape the folder, binary survives byte for byte, an empty archive is still valid, and the route stays read-only. No network.');

// Exercise the actual route with deterministic carrier responses. The manifest must disclose every
// omitted file and remaining batch inside the downloaded artifact, including a complete outage.
(async()=>{
  class NextResponse extends Response { static json(v,init){return new NextResponse(JSON.stringify(v),init);} }
  let calls=[], unavailable=false, permitted=true;
  const filename=path.join(root,'app/api/admin/labels/route.ts'),m=new Module(filename,module);m.filename=filename;
  const fixture=[1,2,3].map(n=>({id:'fixture-'+n,created:1,status:'paid',data:{address:{name:'Fixture '+n},shipment:{status:'pre_transit',labelUrl:'https://carrier.invalid/'+n,tracking:'FIXTURE'+n}}}));
  m.require=id=>({
    'next/server':{NextResponse},'@/lib/auth':{requireStaff:async p=>{assert.equal(p,'orders:fulfill');if(!permitted)throw Error('denied');}},
    '@/lib/runtime':{database:()=>null,timestamp:()=>NOON_PACIFIC},
    '@/lib/order-queue-db':{printableOrders:async(_db,kind,offset,limit)=>{calls.push({kind,offset,limit});return{orders:fixture,total:65};}},
    '@/lib/label-pdf':{labelPdf:bytes=>bytes},
  }[id]||load(id.replace(/^@\//,'')+'.ts'));
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:1,target:9}}).outputText,filename);
  global.fetch=async url=>{assert.match(url,/^https:\/\/carrier\.invalid\/[123]$/);return new Response('%PDF-fixture',{status:unavailable||url.endsWith('/2')?503:200});};
  const request={nextUrl:new URL('https://trybiomod.com/api/admin/labels?offset=60')};
  const response=await m.exports.GET(request);assert.equal(response.status,200);assert.deepEqual(calls,[{kind:'labels',offset:60,limit:60}]);
  let entries=readZip(new Uint8Array(await response.arrayBuffer()));
  let manifest=new TextDecoder().decode(entries.find(e=>e.name.endsWith('.txt')).data);
  assert.equal(response.headers.get('X-Label-Count'),'2');assert.equal(response.headers.get('X-Label-Skipped'),'1');assert.equal(response.headers.get('X-Label-Total'),'65');
  assert.match(manifest,/Batch 61-63 of 65/);assert.match(manifest,/labels\?offset=63/);assert.match(manifest,/#FIXTURE-: carrier file could not be downloaded or converted/);
  unavailable=true;const outage=await m.exports.GET(request);entries=readZip(new Uint8Array(await outage.arrayBuffer()));
  assert.equal(entries.length,1,'all-file failure still returns the manifest');manifest=new TextDecoder().decode(entries[0].data);assert.match(manifest,/0 labels prepared/);assert.equal((manifest.match(/carrier file could not/g)||[]).length,3);
  permitted=false;calls=[];assert.equal((await m.exports.GET(request)).status,403);assert.deepEqual(calls,[]);
  console.log('PASS: actual label route includes failed files and continuation counts in the ZIP manifest; an all-provider outage returns an explicit zero-label manifest; unauthorized requests read nothing. No network.');
})().catch(error=>{console.error(error);process.exitCode=1;});
