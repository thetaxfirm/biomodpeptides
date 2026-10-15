/* Actual protected route, real isolated request SQL, stubbed bounded metadata. No runtime access or mail. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../app/api/store/[action]/route.ts');
const sql = new DatabaseSync(':memory:');
sql.exec('CREATE TABLE requests(id TEXT PRIMARY KEY,kind TEXT,status TEXT,data TEXT,created INTEGER)');
const env = Object.freeze({ DB: Object.freeze({ fixture: true }) });
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const seed = (n, { kind = 'contact', status = 'new', created = n, data = JSON.stringify({ name: 'Fixture ' + n, message: 'Synthetic question' }) } = {}) => sql.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(id(n), kind, status, data, created);
let authorized = false, allow = true, forbiddenCount = 0, reads = [], batches = [];
const forbidden = label => () => { forbiddenCount++; throw Error('Forbidden side effect: ' + label); };
global.fetch = forbidden('network');
const checked = () => assert(authorized, 'Staff authorization precedes request data and metadata reads');
const metadata = field => async (received, ids) => {
  checked(); assert.equal(received, env); assert(ids.length <= 200); assert.equal(new Set(ids).size, ids.length);
  batches.push({ field, ids: [...ids] });
  return Object.fromEntries(ids.map(requestId => [requestId, field === 'issues' ? { issue: 'other' } : [{ fixture: field }]]));
};
const dependencies = {
  '@/lib/auth': { session: async () => ({ id: 'fixture-session' }), rateLimit: async () => undefined, requireStaff: async permission => { assert.equal(permission, 'requests:write'); if (!allow) throw Error('Administrator access required.'); authorized = true; return { email: 'fixture-owner@example.invalid', role: 'owner' }; } },
  '@/lib/runtime': {
    runtime: () => env,
    parse: (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } },
    all: async (query, ...args) => { checked(); assert.match(query, /^SELECT id,kind,status,data,created FROM requests /); assert.match(query, /ORDER BY created DESC,id DESC LIMIT 200$/); reads.push({ query, args }); return sql.prepare(query).all(...args); },
    one: async (query, ...args) => { checked(); assert.match(query, /WHERE id=\? AND kind IN \('contact','stock','affiliate'\)$/); assert.equal(args.length, 1); reads.push({ query, args }); return sql.prepare(query).get(...args) || null; },
    run: forbidden('database mutation'), database: forbidden('raw database'),
  },
  '@/lib/request-replies': { summarizeRequestReplies: metadata('replies'), prepareRequestReply: forbidden('draft'), autoDraftNewRequest: forbidden('auto draft') },
  '@/lib/request-forward': { forwardsFor: metadata('forwards'), activityFor: metadata('activity'), forwardRequest: forbidden('forward') },
  '@/lib/request-cases': { issuesFor: metadata('issues') },
  '@/lib/request-external': { externalRepliesFor: metadata('external') },
};
class FixtureResponse extends Response { static json(value, options = {}) { return new FixtureResponse(JSON.stringify(value), { ...options, headers: { 'content-type': 'application/json', ...options.headers } }); } }
const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename)); const localRequire = Module.createRequire(filename);
mod.require = name => {
  if (name === 'next/server') return { NextResponse: FixtureResponse, after: forbidden('background jobs') };
  if (Object.hasOwn(dependencies, name)) return dependencies[name];
  if (name.startsWith('@/') || name === 'next/headers') return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : forbidden(name + ':' + String(key)) });
  return localRequire(name);
};
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const reset = (access = true) => { allow = access; authorized = false; reads = []; batches = []; };
async function request(body, origin = 'https://store.example.invalid') {
  const req = new Request('https://store.example.invalid/api/store/admin-request-replies', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  req.nextUrl = new URL(req.url);
  const response = await mod.exports.POST(req, { params: Promise.resolve({ action: 'admin-request-replies' }) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, body: await response.json() };
}
function expectMetadata(body, ids) { for (const key of ['replies', 'forwards', 'activity', 'issues', 'external']) assert.deepEqual(Object.keys(body[key]).sort(), [...new Set(ids)].sort(), key + ' covers every requested and fresh ID'); }
(async () => {
  try {
    reset(false); assert.equal((await request({ ids: [], refreshRequests: true })).status, 400); assert.equal(reads.length, 0); assert.equal(batches.length, 0);
    reset(); assert.equal((await request({ ids: [], refreshRequests: true }, 'https://outside.example.invalid')).status, 403); assert.equal(authorized, false);
    for (const body of [{ ids: [id(1)], refreshRequests: 'yes' }, { ids: [id(1)], focusId: 'not-a-uuid' }, { ids: Array.from({ length: 201 }, (_, n) => id(n)) }, { ids: 'all' }]) {
      reset(); assert.equal((await request(body)).status, 400); assert.equal(reads.length, 0); assert.equal(batches.length, 0);
    }
    reset(); let r = await request({ ids: [id(1), id(1)] }); assert.equal(r.status, 200); assert.equal(Object.hasOwn(r.body, 'requests'), false); assert.equal(reads.length, 0); expectMetadata(r.body, [id(1)]);
    reset(); r = await request({ ids: [], refreshRequests: true, focusId: null }); assert.deepEqual(r.body.requests, []); expectMetadata(r.body, []);

    for (let n = 1; n <= 205; n++) seed(n, { kind: n % 3 === 0 ? 'affiliate' : n % 3 === 1 ? 'contact' : 'stock', status: n === 3 ? 'deleted' : n % 7 === 0 ? 'resolved' : 'new' });
    seed(901, { kind: 'coa_link', created: 10000 }); seed(902, { kind: 'cart_import', created: 10001 });
    reset(); r = await request({ ids: [id(1)], refreshRequests: true }); assert.equal(r.status, 200); assert.equal(r.body.requests.length, 200); assert.equal(r.body.requests[0].id, id(205)); assert.equal(r.body.requests.at(-1).id, id(6)); assert.equal(typeof r.body.requests[0].data, 'object'); assert.equal(r.body.requests[0].data.name, 'Fixture 205'); assert(!r.body.requests.some(row => [id(901), id(902)].includes(row.id))); expectMetadata(r.body, [id(1), ...r.body.requests.map(row => row.id)]);
    reset(); r = await request({ ids: [], refreshRequests: true, focusId: id(3) }); assert.equal(r.body.requests.length, 201); assert.equal(r.body.requests.at(-1).id, id(3)); assert.equal(r.body.requests.at(-1).status, 'deleted'); expectMetadata(r.body, r.body.requests.map(row => row.id)); assert.equal(reads.length, 2);
    reset(); r = await request({ ids: [], refreshRequests: true, focusId: id(205) }); assert.equal(r.body.requests.length, 200); assert.equal(reads.length, 1, 'Already-loaded focus avoids duplicate lookup');
    for (const focusId of [id(999), id(901)]) { reset(); r = await request({ ids: [], refreshRequests: true, focusId }); assert.equal(r.body.requests.length, 200); assert(!r.body.requests.some(row => row.id === focusId), 'Missing/non-inbox row is not exposed'); }

    const previous = Array.from({ length: 200 }, (_, n) => id(1000 + n));
    reset(); r = await request({ ids: previous, refreshRequests: true, focusId: id(3) }); expectMetadata(r.body, [...previous, ...r.body.requests.map(row => row.id)]); assert.equal(Object.keys(r.body.replies).length, 401); assert.equal(batches.length, 15, '401 IDs use three bounded chunks for five metadata helpers'); assert(batches.every(batch => batch.ids.length <= 200));
    const snapshotBefore = JSON.stringify(r.body.requests);
    seed(206, { data: 'null' }); reset(); r = await request({ ids: [], refreshRequests: true }); assert.equal(r.body.requests[0].id, id(206), 'Fresh request appears without reopening administration'); assert.deepEqual(r.body.requests[0].data, {}, 'Malformed legacy object does not break inbox rendering'); assert.notEqual(JSON.stringify(r.body.requests), snapshotBefore);
    assert.equal(forbiddenCount, 0, 'No provider, mail, background draft or database mutation was attempted');
    console.log('PASS: protected request refresh returns latest 200 plus exact older/deleted focus, discovers new rows, preserves bounded metadata for original/fresh IDs, keeps legacy calls compatible, excludes other record kinds, and performs no writes or sends.');
  } finally { sql.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
