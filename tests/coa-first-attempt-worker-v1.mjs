import { migrationStatements } from './sql-migration-fixture.mjs';
// Actual built POST routes + after()/waitUntil + isolated D1. All outbound services
// are intercepted. Only synthetic customers, inquiries, auth and report bytes exist.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, Log, LogLevel } from 'miniflare';
const require = createRequire(import.meta.url), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fsSync.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, f);
const { saveCoaConfig, enqueueCoaRequest } = require('../lib/coa-outbox.ts');
const registry = require('./fixtures/coa-originals-v1.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), built = path.join(root, 'dist/server');
const config = JSON.parse(await fs.readFile(path.join(built, 'wrangler.json'), 'utf8'));
const modulePaths = (await fs.readdir(built, { recursive: true })).filter(name => /\.(?:m?js)$/.test(name));
const modules = [config.main, ...modulePaths.filter(name => name !== config.main)].map(name => ({ type: 'ESModule', path: path.join(built, name) }));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trybiomod-coa-first-attempt-'));
const origin = 'https://store.example.invalid';
const fixtureKey = 'isolated-provider-fixture-not-a-real-secret';
const sender = 'BIOMOD Fixture <no-reply@example.invalid>';
const settings = { enabled: true, replyTo: 'reply@example.invalid', notifyTo: 'owner-alerts@example.invalid' };
const account = { id: '50000000-0000-4000-8000-000000000001', email: 'partner@example.invalid', email_confirmed_at: '2026-10-11T00:00:00Z', user_metadata: { name: 'Synthetic partner' } };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const withTimeout = async (promise, message, ms = 5000) => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => timer = setTimeout(() => reject(Error(message)), ms))]); } finally { clearTimeout(timer); } };
const until = async (test, message) => { const started = Date.now(); while (!await test()) { if (Date.now() - started > 5000) throw Error(message); await new Promise(resolve => setTimeout(resolve, 10)); } };
let DB, hold = null, providerMode = 'accepted', forbiddenOutbound = 0, authCalls = 0;
const calls = [], outboundErrors = [];
const mf = new Miniflare({
  name: 'isolated-coa-first-attempt', cf: false,
  modules, modulesRoot: built,
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { RESEND_API_KEY: fixtureKey, ORDER_EMAIL_FROM: sender, SUPABASE_URL: 'https://identity.example.invalid', SUPABASE_ANON_KEY: 'isolated-auth-fixture' },
  d1Databases: { DB: 'isolated-first-attempt-database' }, d1Persist: path.join(temporary, 'd1'),
  outboundService: async request => {
    try {
      if (request.url === 'https://identity.example.invalid/auth/v1/user' && request.method === 'GET') {
        assert.equal(request.headers.get('authorization'), 'Bearer isolated-access-fixture'); authCalls++;
        return new Response(JSON.stringify(account), { headers: { 'content-type': 'application/json' } });
      }
      if (request.url !== 'https://api.resend.com/emails' || request.method !== 'POST') { forbiddenOutbound++; throw Error('Unexpected outbound service'); }
      assert.equal(request.headers.get('authorization'), 'Bearer ' + fixtureKey);
      const key = request.headers.get('idempotency-key');
      const row = await DB.prepare('SELECT * FROM coa_delivery_outbox WHERE idempotency_key=?').bind(key).first();
      assert(row, 'Only durably queued messages may be processed');
      const payload = await request.json();
      assert.equal(payload.from, row.sender); assert.equal(payload.reply_to, row.reply_to);
      assert.deepEqual(payload.to, [row.recipient]); assert.equal(payload.subject, row.subject); assert.equal(payload.text, row.body);
      assert(!JSON.stringify(payload).includes('PRIVATE_FIXTURE_MESSAGE'));
      if (row.purpose === 'coa') {
        const report = registry.reports.find(item => item.sha256 === row.document_hash); assert(report);
        assert.equal(payload.attachments?.length, 1); assert.equal(payload.attachments[0].filename, report.filename);
        assert.equal(payload.attachments[0].content, report.base64);
        assert.equal(createHash('sha256').update(Buffer.from(payload.attachments[0].content, 'base64')).digest('hex'), report.sha256);
      } else { assert.equal(row.recipient, settings.notifyTo); assert.equal(payload.attachments, undefined); }
      const index = calls.push({ requestId: row.request_id, purpose: row.purpose, key });
      if (hold) await hold.promise;
      if (providerMode === 'unavailable') throw Error('Isolated provider temporarily unavailable');
      return new Response(JSON.stringify({ id: `60000000-0000-4000-8000-${String(index).padStart(12, '0')}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      if (error.message !== 'Isolated provider temporarily unavailable') outboundErrors.push(error.message);
      throw error;
    }
  },
  log: new Log(LogLevel.ERROR),
});
try {
  await mf.ready; DB = await mf.getD1Database('DB');
  for (const name of (await fs.readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await fs.readFile(path.join(root, 'drizzle', name), 'utf8');
    await DB.batch(migrationStatements(sql).map(statement => DB.prepare(statement)));
  }
  await DB.batch(registry.reports.map(report => DB.prepare('INSERT INTO coa_original_reports VALUES(?,?,1)').bind(report.sha256, JSON.stringify(report))));
  const env = { DB, RESEND_API_KEY: fixtureKey, ORDER_EMAIL_FROM: sender };
  await saveCoaConfig(env, settings);
  const report = registry.reports[0], subject = `COA request: ${report.productName} / ${report.lot}`;
  const payload = email => ({ name: 'Synthetic inquiry', email, subject, message: 'PRIVATE_FIXTURE_MESSAGE', id: 'body-id-must-not-be-used', recipient: 'intruder@example.invalid', filename: 'forged.pdf' });
  const post = async (action, data, extraHeaders = {}) => {
    const response = await mf.dispatchFetch(origin + '/api/store/' + action, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const rows = id => DB.prepare('SELECT * FROM coa_delivery_outbox WHERE request_id=? ORDER BY purpose').bind(id).all().then(value => value.results);
  const allRows = () => DB.prepare('SELECT * FROM coa_delivery_outbox').all().then(value => value.results);
  const requestCount = () => DB.prepare('SELECT COUNT(*) n FROM requests').first().then(row => row.n);
  const oldId = '70000000-0000-4000-8000-000000000001';
  await DB.prepare('INSERT INTO requests(id,kind,data,created) VALUES(?,?,?,?)').bind(oldId, 'contact', JSON.stringify(payload('older-fixture@example.invalid')), Date.now() - 86400000).run();
  await enqueueCoaRequest(env, oldId);

  // A held provider proves the actual saved POST response does not wait for mail.
  hold = deferred();
  let response = await withTimeout(post('contact', payload('first-fixture@example.invalid')), 'Saved response waited for provider instead of using after()/waitUntil');
  assert.equal(response.status, 200); assert.match(response.body.message, /saved/); assert.match(response.body.id, /^[a-f0-9-]{36}$/);
  const firstId = response.body.id; assert.notEqual(firstId, oldId);
  await until(() => calls.length === 2, 'Built response lifecycle did not start both scoped background attempts. Rebuild before running this test.');
  assert.deepEqual(calls.map(call => call.purpose).sort(), ['coa', 'request-alert']); assert(calls.every(call => call.requestId === firstId));
  assert((await rows(firstId)).every(row => row.status === 'sending' && row.attempts === 1));
  const claimEvents = (await DB.prepare("SELECT * FROM change_events WHERE entity_type='email_job' AND action='email_job.update'").all()).results.filter(event => JSON.parse(event.changes).some(change => change.field === 'Status' && change.after === 'sending'));
  assert.equal(claimEvents.length, 2, 'Actual D1 UPDATE RETURNING claims are audited before provider completion');
  for (const event of claimEvents) { assert.equal(event.actor, 'Inquiry delivery automation'); assert.equal(event.actor_type, 'system'); assert.equal(event.source, 'system'); }
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM change_context').first()).n, 0, 'No actor context spans pending provider calls');
  assert.equal((await rows(oldId))[0].attempts, 0, 'A new request must not drain an unrelated historical job');
  hold.resolve(); hold = null;
  await until(async () => (await rows(firstId)).every(row => row.status === 'accepted'), 'Background accepted state did not persist after the response');
  assert.equal(calls.length, 2);

  // A repeated report inquiry does not resend an accepted recipient/report pair.
  response = await post('contact', payload('first-fixture@example.invalid')); assert.equal(response.status, 200);
  await until(async () => (await rows(response.body.id)).find(row => row.purpose === 'request-alert')?.status === 'accepted', 'Duplicate inquiry alert was not processed');
  assert.equal((await rows(response.body.id)).find(row => row.purpose === 'coa').status, 'duplicate');
  assert.equal(calls.length, 3); assert.equal(calls.filter(call => call.purpose === 'coa').length, 1);

  // Unmatched reports require review; only the configured owner's generic alert runs.
  response = await post('contact', { ...payload('unmatched-fixture@example.invalid'), subject: 'COA request: unknown / absent-lot' });
  assert.equal(response.status, 200);
  await until(async () => (await rows(response.body.id)).find(row => row.purpose === 'request-alert')?.status === 'accepted', 'Unmatched inquiry alert not processed');
  assert.equal((await rows(response.body.id)).find(row => row.purpose === 'coa').status, 'manual_review'); assert.equal(calls.length, 4);

  // Affiliate uses the authenticated account identity and only configured-owner alert.
  response = await post('affiliate', { website: 'https://partner.example.invalid', message: 'PRIVATE_FIXTURE_MESSAGE', email: 'intruder@example.invalid' }, { cookie: 'bm_access=isolated-access-fixture' });
  assert.equal(response.status, 200); assert.equal(authCalls, 1);
  const affiliate = await DB.prepare("SELECT * FROM requests WHERE kind='affiliate'").first();
  assert.equal(affiliate.owner, account.id); assert.equal(JSON.parse(affiliate.data).email, account.email);
  await until(async () => (await rows(affiliate.id))[0]?.status === 'accepted', 'Affiliate alert not processed');
  assert.equal((await rows(affiliate.id)).length, 1); assert.equal(calls.length, 5); assert.equal(calls.at(-1).purpose, 'request-alert');

  // Invalid, foreign-origin, honeypot and signed-out affiliate requests never start mail.
  const beforeRequests = await requestCount();
  for (const [action, data, headers, status] of [
    ['contact', { ...payload('invalid'), email: 'not-an-email' }, {}, 400],
    ['contact', payload('blocked@example.invalid'), { origin: 'https://other.example.invalid' }, 403],
    ['contact', { ...payload('trap@example.invalid'), website: 'honeypot' }, {}, 200],
    ['affiliate', { website: 'https://partner.example.invalid', message: 'Synthetic' }, {}, 400],
  ]) { assert.equal((await post(action, data, headers)).status, status); }
  assert.equal(await requestCount(), beforeRequests); assert.equal(calls.length, 5);

  // Provider outage cannot change a saved response and does not immediately replay.
  providerMode = 'unavailable';
  response = await post('contact', payload('failure-fixture@example.invalid')); assert.equal(response.status, 200); assert.match(response.body.message, /saved/);
  const failedId = response.body.id;
  await until(async () => { const values = await rows(failedId); return values.length === 2 && values.every(row => row.status === 'queued' && row.attempts === 1 && row.next_attempt_at > Date.now()); }, 'Failed first attempts did not remain durably queued with backoff');
  assert.equal(calls.length, 7); assert(!JSON.stringify(response.body).includes('provider'));
  const admin = await mf.dispatchFetch(origin + '/api/store/admin'); assert.equal(admin.status, 400); await admin.text();
  assert.equal(calls.length, 7, 'A GET must not start/retry any queued email');

  // Disabled configuration still saves inquiries but creates no mail jobs.
  await saveCoaConfig(env, { ...settings, enabled: false });
  response = await post('contact', payload('disabled-fixture@example.invalid')); assert.equal(response.status, 200);
  assert.equal((await rows(response.body.id)).length, 0); assert.equal(calls.length, 7);
  assert.equal((await rows(oldId))[0].attempts, 0);
  assert.equal((await allRows()).filter(row => row.status === 'accepted').length, 5);
  assert.equal(forbiddenOutbound, 0); assert.deepEqual(outboundErrors, []);
  for (const table of ['orders','profiles','addresses','customer_carts']) assert.equal((await DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n, 0, 'Full schema contains no commerce/customer records');
  const history = (await DB.prepare('SELECT * FROM change_events').all()).results;
  const updates = history.filter(event => event.action === 'email_job.update'); assert(updates.length >= 14);
  for (const event of updates) { assert.equal(event.actor, 'Inquiry delivery automation'); assert.equal(event.source, 'system'); }
  for (const privateValue of ['PRIVATE_FIXTURE_MESSAGE', 'first-fixture@example.invalid', account.email, settings.replyTo, settings.notifyTo, registry.reports[0].base64]) assert(!JSON.stringify(history).includes(privateValue), 'History does not copy customer identity or mail contents');
  console.log('PASS: actual built contact/affiliate POST after()/waitUntil starts only saved-request mail, response precedes held provider, original bytes unchanged, owner-only alerts, dedupe/manual-review/disabled/failure safety, no historical drain or GET processing. All auth/email services synthetic and intercepted.');
} finally {
  hold?.resolve(); await mf.dispose(); await fs.rm(temporary, { recursive: true, force: true });
}
