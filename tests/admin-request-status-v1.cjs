/* Actual admin-request POST handler plus in-memory SQLite. All identities are
 * isolated fixtures. No live database, email, customer records or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'app/api/store/[action]/route.ts');
const sql = new DatabaseSync(':memory:');
sql.exec('CREATE TABLE requests(id TEXT PRIMARY KEY,owner TEXT,kind TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL)');
const id = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const missingId = '10000000-0000-4000-8000-000000000003';
const updateSql = "UPDATE requests SET status=? WHERE id=? AND status=? AND kind IN ('contact','stock','affiliate')";
const existenceSql = "SELECT id FROM requests WHERE id=? AND kind IN ('contact','stock','affiliate')";
let role, calls, authorized, writeGate, failure, forbiddenCalls = 0;
const oldFetch = global.fetch;
global.fetch = () => { forbiddenCalls++; throw Error('External network is forbidden'); };
const forbidden = name => () => { forbiddenCalls++; throw Error('Forbidden dependency: ' + name); };
const note = (name, value) => calls.push({ name, value });
const called = name => calls.filter(call => call.name === name);
function checkedAdmin() { assert(authorized, 'Admin authorization must precede all request reads/writes'); }
const dependencies = {
  '@/lib/auth': {
    session: async () => { note('session'); return { id: 'isolated-session' }; },
    rateLimit: async () => note('rateLimit'),
    requireAdmin: async () => {
      note('requireAdmin');
      if (!['owner-admin', 'existing-admin'].includes(role)) throw Error('Administrator access required.');
      authorized = true;
      return { id: role };
    },
  },
  '@/lib/runtime': {
    run: async (query, ...values) => {
      checkedAdmin();
      assert.equal(query, updateSql, 'Only the exact request status may be written');
      note('write-attempt', values);
      if (writeGate) await writeGate.promise;
      if (failure) throw Error('Isolated storage unavailable.');
      const result = sql.prepare(query).run(...values);
      note('write-result', Number(result.changes));
      return { meta: { changes: Number(result.changes) } };
    },
    one: async (query, ...values) => {
      checkedAdmin();
      assert.equal(query, existenceSql, 'Conflict handling must not read request content');
      note('read', values);
      return sql.prepare(query).get(...values) || null;
    },
  },
};
// Staff-role compatibility: the routes call requireStaff(permission); these fixtures model an
// owner (full access), so delegate to the existing requireAdmin stub and its call log.
dependencies['@/lib/auth'].requireStaff = async () => ({ ...(await dependencies['@/lib/auth'].requireAdmin()), role: 'owner' });
dependencies['@/lib/auth'].staffRole = async () => null;

class FixtureResponse extends Response {
  static json(value, options = {}) {
    return new FixtureResponse(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  }
}
const mod = new Module(filename, module);
mod.filename = filename;
mod.paths = Module._nodeModulePaths(path.dirname(filename));
const localRequire = Module.createRequire(filename);
mod.require = name => {
  if (name === 'next/server') return { NextResponse: FixtureResponse, after: forbidden('background callback') };
  if (Object.hasOwn(dependencies, name)) return dependencies[name];
  if (name === 'next/headers' || name.startsWith('@/'))
    return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : forbidden(name + ':' + String(key)) });
  return localRequire(name);
};
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { POST } = mod.exports;
function reset(options = {}) {
  sql.exec('DELETE FROM requests');
  role = options.role || 'owner-admin';
  calls = []; authorized = false; writeGate = null; failure = false;
}
function seed(requestId = id, kind = 'contact', status = 'new') {
  sql.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(requestId, 'isolated-owner', kind,
    JSON.stringify({ subject: 'Isolated inquiry', message: 'Original submitted content', productId: 999999 }), status, 2000000000000);
}
const row = requestId => ({ ...sql.prepare('SELECT * FROM requests WHERE id=?').get(requestId) });
const immutable = value => { const { status, ...rest } = value; return rest; };
const payload = (status, expectedStatus = 'new', requestId = id) => ({ id: requestId, status, expectedStatus });
async function request(body, options = {}) {
  const req = new Request('https://store.example.invalid/api/store/admin-request', {
    method: 'POST',
    headers: { origin: 'https://store.example.invalid', 'content-type': 'application/json', ...options.headers },
    body: options.raw === undefined ? JSON.stringify(body) : options.raw,
  });
  req.nextUrl = new URL(req.url);
  const response = await POST(req, { params: Promise.resolve({ action: 'admin-request' }) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, body: await response.json() };
}
function noStorage() {
  assert.equal(called('write-attempt').length, 0);
  assert.equal(called('read').length, 0);
}
(async () => {
  // Same protected action works for both admin identities, all inbox kinds and
  // every supported transition; resolving/spam marking/reopening have no effects
  // on submitted content, other requests or external systems.
  for (const adminRole of ['owner-admin', 'existing-admin']) {
    for (const kind of ['contact', 'stock', 'affiliate']) {
      reset({ role: adminRole }); seed(id, kind); seed(otherId, 'contact');
      const original = row(id), unrelated = row(otherId);
      for (const status of ['in_progress', 'resolved', 'new', 'spam', 'new', 'reviewed', 'resolved', 'resolved']) {
        const expectedStatus = row(id).status;
        const result = await request(payload(status, expectedStatus));
        assert.equal(result.status, 200, adminRole + '/' + kind + '/' + status);
        assert.deepEqual(result.body, { ok: true, id, status, message: 'Request status updated.' });
        assert.equal(row(id).status, status);
        assert.deepEqual(immutable(row(id)), immutable(original));
        assert.deepEqual(row(otherId), unrelated);
      }
      assert.equal(called('read').length, 0, 'Successful updates do not read personal request content');
    }
  }
  // Legacy saved values are preserved until explicitly reopened; they are not
  // silently mapped, auto-approved, or newly accepted as target statuses.
  for (const legacy of ['reviewed', 'approved', 'rejected', 'legacy pending']) {
    reset(); seed(id, 'affiliate', legacy);
    const result = await request(payload('new', legacy));
    assert.equal(result.status, 200); assert.equal(row(id).status, 'new');
  }
  for (const unauthorized of ['signedout', 'customer']) {
    reset({ role: unauthorized }); seed();
    const result = await request(payload('resolved'));
    assert.equal(result.status, 400); assert.match(result.body.error, /Administrator access required/);
    noStorage(); assert.equal(row(id).status, 'new');
  }
  // Existing origin/body limits guard this endpoint before session/admin work.
  for (const options of [
    { headers: { origin: 'https://other.example.invalid' }, expected: 403 },
    { headers: { origin: '' }, expected: 403 },
    { headers: { 'content-length': '30001' }, expected: 413 },
    { headers: { 'content-type': 'text/plain' }, expected: 400 },
    { raw: '[1]', expected: 400 }, { raw: 'null', expected: 400 },
    { raw: '{', expected: 400 }, { raw: ' '.repeat(30001), expected: 413 },
  ]) {
    reset(); seed(); const result = await request(payload('resolved'), options);
    assert.equal(result.status, options.expected); assert.equal(calls.length, 0); noStorage();
  }
  const bad = [
    { ...payload('new'), id: missingId + '%' }, { ...payload('new'), id: ' ' + id },
    { ...payload('new'), id: [id] }, { ...payload('new'), id: "' OR 1=1 --" },
    ...['approved', 'rejected', 'deleted', 'cart_resolved', 'In progress', 'NEW', ''].map(status => payload(status)),
    { ...payload('new'), status: null },
    ...[null, '', 1, {}, 'x'.repeat(51)].map(expectedStatus => payload('new', expectedStatus)),
  ];
  for (const body of bad) {
    reset(); seed(); const result = await request(body);
    assert.equal(result.status, 400, JSON.stringify(body)); noStorage(); assert.equal(row(id).status, 'new');
  }
  reset(); seed();
  let result = await request({ id, status: 'resolved' });
  assert.equal(result.status, 400); assert.equal(result.body.code, 'request_refresh_required');
  assert.match(result.body.error, /Refresh/); noStorage();

  // Exact IDs only; internal cart-import workflow cannot be altered through inbox.
  reset(); seed(); const before = row(id);
  result = await request(payload('resolved', 'new', missingId));
  assert.equal(result.status, 404); assert.deepEqual(result.body, { error: 'Request not found.' });
  assert.deepEqual(row(id), before);
  for (const kind of ['cart_import', 'unknown']) {
    reset(); seed(id, kind, 'cart_pending'); const before = row(id);
    result = await request(payload('resolved', 'cart_pending'));
    assert.equal(result.status, 404); assert.deepEqual(row(id), before);
  }
  reset(); seed(id, 'contact', 'in_progress');
  result = await request(payload('resolved', 'new'));
  assert.equal(result.status, 409); assert.equal(result.body.code, 'request_status_conflict');
  assert.match(result.body.error, /Refresh/); assert.equal(row(id).status, 'in_progress');
  assert.deepEqual(called('read').map(call => call.value), [[id]]);
  assert(!JSON.stringify(result.body).includes('Original submitted content'));

  // Two admins acting on the same saved value race at SQLite's conditional UPDATE:
  // exactly one changes the row; the other receives a conflict, never overwrites.
  reset(); seed(); seed(otherId);
  let release; writeGate = { promise: new Promise(resolve => { release = resolve; }) };
  const first = request(payload('in_progress')), second = request(payload('spam'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(called('write-attempt').length, 2); assert.equal(row(id).status, 'new');
  release(); const raced = await Promise.all([first, second]); writeGate = null;
  assert.deepEqual(raced.map(value => value.status).sort(), [200, 409]);
  assert.equal(called('write-result').reduce((total, call) => total + call.value, 0), 1);
  assert.equal(row(id).status, raced.find(value => value.status === 200).body.status);
  assert.equal(row(otherId).status, 'new');

  // Storage failure does not acknowledge a saved status or replay the mutation.
  reset(); seed(); failure = true; result = await request(payload('resolved'));
  assert.equal(result.status, 400); assert.equal(called('write-attempt').length, 1);
  assert.equal(row(id).status, 'new'); assert.equal(result.body.ok, undefined);
  assert.equal(forbiddenCalls, 0, 'No mail, outbox, affiliate approval, account, order or network operations');
  console.log('Admin request status: actual route validation, admin/origin guards, exact SQLite updates, legacy reopen, missing/conflict and concurrent compare-and-set PASS');
})().finally(() => { global.fetch = oldFetch; sql.close(); }).catch(error => { console.error(error); process.exitCode = 1; });
