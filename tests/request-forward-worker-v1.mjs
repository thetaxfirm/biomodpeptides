// Actual compiled admin routes on isolated D1. Auth and mail are synthetic;
// every outbound request is intercepted and no production bindings are loaded.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { migrationStatements } from './sql-migration-fixture.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), built = path.join(root, 'dist/server');
const config = JSON.parse(await fs.readFile(path.join(built, 'wrangler.json'), 'utf8'));
const modules = (await fs.readdir(built, { recursive: true })).filter(name => /\.(?:m?js)$/.test(name));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trybiomod-request-forward-worker-'));
const origin = 'https://trybiomod.com', sessionId = randomUUID(), recipient = 'recipient@example.invalid';
const user = { id: randomUUID(), email: 'owner@example.invalid', email_confirmed_at: '2026-01-01', user_metadata: { name: 'Synthetic owner' } };
const headers = { origin, 'content-type': 'application/json', cookie: `bm_access=fixture-only; bm_session=${sessionId}` };
const guestHeaders = { ...headers, cookie: `bm_session=${sessionId}` };
let db, mode = 'accepted', forbidden = 0;
const attempts = [], mockAccepted = [];
const mf = new Miniflare({
  name: 'isolated-request-forward', cf: false,
  modules: [config.main, ...modules.filter(name => name !== config.main)].map(name => ({ type: 'ESModule', path: path.join(built, name) })), modulesRoot: built,
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { SUPABASE_URL: 'https://auth.example.invalid', SUPABASE_ANON_KEY: 'fixture-only', STORE_ADMIN_EMAILS: user.email, RESEND_API_KEY: 'synthetic-mail-key', ORDER_EMAIL_FROM: 'Fixture <sender@example.invalid>' },
  d1Databases: { DB: 'isolated-request-forward' }, d1Persist: path.join(temporary, 'd1'),
  outboundService: async request => {
    if (request.url === 'https://auth.example.invalid/auth/v1/user' && request.method === 'GET') {
      assert.equal(request.headers.get('authorization'), 'Bearer fixture-only');
      return Response.json(user);
    }
    if (request.url === 'https://api.resend.com/emails' && request.method === 'POST') {
      assert.equal(request.headers.get('authorization'), 'Bearer synthetic-mail-key');
      const payload = await request.json(), key = request.headers.get('idempotency-key');
      assert.deepEqual(payload.to, [recipient]); assert.equal(payload.reply_to, user.email);
      assert.match(payload.from, /@example\.invalid/); assert.equal(payload.attachments, undefined);
      const id = key?.replace(/^request-forward-/, '');
      const row = await db.prepare('SELECT id,status FROM request_forwards WHERE id=?').bind(id).first();
      assert.equal(row?.status, 'sending', 'Provider call starts only after a durable claim');
      attempts.push({ id, key });
      if (mode === 'rejected') return Response.json({ message: 'Synthetic validation rejection' }, { status: 422 });
      mockAccepted.push(key);
      if (mode === 'lost') throw Error('Synthetic lost response after fixture provider accepted');
      return Response.json({ id: randomUUID() });
    }
    forbidden++; throw Error('Live outbound request prohibited in request-forward fixture');
  },
  log: new Log(LogLevel.ERROR),
});
const post = async (action, payload, selectedHeaders = headers) => {
  const response = await mf.dispatchFetch(origin + '/api/store/' + action, { method: 'POST', headers: selectedHeaders, body: JSON.stringify(payload) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, body: await response.json() };
};
const forward = (id, selectedHeaders = headers) => post('admin-request-forward', { id, to: recipient, note: 'Synthetic internal forward' }, selectedHeaders);
const seed = async () => {
  const id = randomUUID();
  await db.prepare("INSERT INTO requests(id,kind,data,created) VALUES(?,'contact',?,?)").bind(id, JSON.stringify({ name: 'Synthetic customer', email: 'customer@example.invalid', subject: 'Fixture question', message: 'Synthetic inquiry only' }), Date.now()).run();
  return id;
};
const rows = async id => (await db.prepare('SELECT id,status FROM request_forwards WHERE request_id=?').bind(id).all()).results;
const inspectUnknown = async id => {
  const result = await post('admin-request-replies', { ids: [id] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.forwards[id].length, 1); assert.equal(result.body.forwards[id][0].status, 'unknown');
  assert(result.body.activity[id].some(item => item.text.startsWith('Forward status unconfirmed to')));
  assert(!result.body.activity[id].some(item => item.text.startsWith('Forwarded to')));
};
try {
  await mf.ready; db = await mf.getD1Database('DB');
  for (const name of (await fs.readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) {
    await db.batch(migrationStatements(await fs.readFile(path.join(root, 'drizzle', name), 'utf8')).map(sql => db.prepare(sql)));
  }
  await db.prepare('INSERT INTO sessions(id,cart,wishlist,updated) VALUES(?,?,?,?)').bind(sessionId, '[]', '[]', Date.now()).run();
  await db.prepare('INSERT INTO staff(email,name,role,active,created,updated,updated_by) VALUES(?,?,?,?,?,?,?)').bind(recipient, 'Synthetic recipient', 'manager', 1, Date.now(), Date.now(), user.email).run();
  const lostId = await seed();
  const beforeRead = attempts.length;
  const snapshot = await post('admin-request-replies', { ids: [], refreshRequests: true, focusId: lostId });
  assert.equal(snapshot.status, 200); assert.equal(snapshot.body.requests[0].id, lostId);
  assert.equal(snapshot.body.requests[0].data.subject, 'Fixture question');
  const nextId = await seed();
  const updatedSnapshot = await post('admin-request-replies', { ids: [lostId], refreshRequests: true });
  assert.equal(updatedSnapshot.body.requests.length, 2); assert(updatedSnapshot.body.requests.some(row => row.id === nextId));
  assert.equal(attempts.length, beforeRead, 'Refreshing the compiled inbox does not send mail');
  const deniedSnapshot = await post('admin-request-replies', { ids: [], refreshRequests: true }, guestHeaders);
  assert.equal(deniedSnapshot.status, 400); assert.equal(deniedSnapshot.body.requests, undefined);
  let result = await forward(lostId, guestHeaders); assert.equal(result.status, 400); assert.match(result.body.error, /sign in/i);
  result = await post('admin-request-replies', { ids: [lostId] }, guestHeaders); assert.equal(result.status, 400); assert.match(result.body.error, /sign in/i);
  assert.equal(attempts.length, 0); assert.equal((await rows(lostId)).length, 0, 'Anonymous access cannot create a send');
  // The fixture provider accepts the request but its response is lost.
  mode = 'lost'; result = await forward(lostId); assert.equal(result.status, 502); assert.match(result.body.error, /status unconfirmed/);
  assert.equal(mockAccepted.length, 1); assert.equal(attempts.length, 1); assert.equal((await rows(lostId))[0].status, 'sending');
  await inspectUnknown(lostId);
  result = await forward(lostId); assert.equal(result.status, 409); assert.match(result.body.error, /status unconfirmed/);
  assert.equal(attempts.length, 1, 'Retry cannot call the provider with a new random key'); assert.equal((await rows(lostId)).length, 1);
  // Successful provider acceptance followed by failed D1 persistence is also unknown.
  const persistenceId = await seed(); mode = 'accepted';
  await db.prepare("CREATE TRIGGER fixture_forward_persistence_failure BEFORE UPDATE OF status ON request_forwards WHEN NEW.status='accepted' BEGIN SELECT RAISE(ABORT,'synthetic acceptance write failure'); END").run();
  result = await forward(persistenceId); assert.equal(result.status, 502); assert.match(result.body.error, /status unconfirmed/);
  await db.prepare('DROP TRIGGER fixture_forward_persistence_failure').run();
  await inspectUnknown(persistenceId); const afterPersistence = attempts.length;
  result = await forward(persistenceId); assert.equal(result.status, 409); assert.equal(attempts.length, afterPersistence);
  // Definite rejection is retryable; an accepted forward may intentionally be sent again.
  const retryId = await seed(); mode = 'rejected';
  result = await forward(retryId); assert.equal(result.status, 502); assert.match(result.body.error, /provider rejected/); assert.equal((await rows(retryId))[0].status, 'failed');
  mode = 'accepted'; result = await forward(retryId); assert.equal(result.status, 200); assert.equal(result.body.forward.status, 'accepted');
  result = await forward(retryId); assert.equal(result.status, 200); assert.equal(result.body.forward.status, 'accepted');
  assert.equal((await rows(retryId)).filter(row => row.status === 'accepted').length, 2);
  assert.equal(forbidden, 0); assert.equal((await db.prepare('SELECT COUNT(*) n FROM orders').first()).n, 0);
  console.log('PASS: built Worker admin forwarding/auth/read routes; accepted-but-lost response and failed acceptance persistence retain durable unknown locks; repeat attempts stop before provider; definite rejection retries and intentional accepted repeats remain supported. Isolated D1, mocked auth/mail, no live outbound calls.');
} finally { await mf.dispose(); await fs.rm(temporary, { recursive: true, force: true }); }
