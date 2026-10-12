/* Actual API GET/POST handlers with isolated dependencies. No real database,
 * secrets, customer records, outbound mail, order/payment/cart actions or network.
 * Outbox SQL/concurrency/integrity are separately exercised by coa-delivery-v1. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'app/api/store/[action]/route.ts');
const requestId = '10000000-0000-4000-8000-000000000001';
const account = { id: 'isolated-account', email: 'account@example.invalid' };
const contact = { name: 'Isolated request', email: 'requester@example.invalid', subject: 'COA request: HEAT-R 30mg / 102-30-0001', message: 'Isolated documentation request.' };
const env = Object.freeze({ fixture: 'isolated', DB: Object.freeze({ fixture: 'isolated-db' }) });
const now = 2000000000000;
let scenario, calls, saved, afterJobs = [], backgroundErrors = [], draining = false, responseReturned = false, forbiddenCalls = 0;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function after(callback) {
  note('after-register');
  assert.equal(typeof callback, 'function');
  assert(scenario.publicRequest && saved.has(requestId), 'Only a persisted public inquiry schedules background delivery');
  if (scenario.registrationFailure) throw Error('PRIVATE_AFTER_REGISTRATION_FAILURE');
  afterJobs.push(callback);
}
async function drainAfter() {
  const queued = afterJobs.splice(0);
  draining = true;
  try { await Promise.all(queued.map(callback => callback())); }
  finally { draining = false; }
  assert.deepEqual(backgroundErrors, [], 'Background dependency assertions must not be swallowed by allSettled');
}
function assertBackground(kind) {
  const names = kind === 'contact' ? ['background-coa', 'background-request-alert'] : ['background-request-alert'];
  assert.deepEqual(calls.filter(call => call.name.startsWith('background-')).map(call => call.name), names);
  for (const name of names) {
    assert.equal(called(name).length, 1);
    assert.deepEqual(called(name)[0].value, { requestId, purpose: name.slice('background-'.length), limit: 1 });
  }
}
const oldFetch = global.fetch;
global.fetch = () => { forbiddenCalls++; throw Error('External network is forbidden'); };
const forbidden = name => () => { forbiddenCalls++; throw Error('Forbidden dependency: ' + name); };
const note = (name, value) => { calls.push({ name, value }); };
const called = name => calls.filter(call => call.name === name);
const checkedAdmin = () => assert(called('admin-ok').length, 'Admin authorization must precede sensitive reads/writes');
const status = value => ({ status: value, reason: value === 'accepted' ? 'accepted_by_email_provider' : 'fixture', acceptedAt: value === 'accepted' ? now : null, canProcess: value === 'queued' });
const dependencies = {
  '@/lib/change-history': { withAuditDb: (db, actor) => { assert.equal(db, env.DB); assert(['staff','system'].includes(actor.actorType)); return db; }, recordChange: async (db, event) => { checkedAdmin(); assert.equal(db,env.DB); assert.equal(event.status,'attempted'); assert.equal(event.action,'coa.process_requested'); }, auditRun: forbidden('unrelated admin audit write') },
  '@/lib/checkout-recovery': { recoveryAdminStatus: async()=>{checkedAdmin();return {enabled:false,jobs:[]};} },
  '@/lib/auth': {
    customer: async () => { note('customer'); return scenario.role === 'signedout' ? null : account; },
    requireAdmin: async () => { note('requireAdmin'); if (scenario.role !== 'admin') throw Error('Administrator access required.'); note('admin-ok'); return account; },
    requireCustomer: async () => { note('requireCustomer'); if (scenario.role === 'signedout') throw Error('Please sign in.'); return account; },
    session: async secure => { note('session', secure); return { id: 'isolated-session' }; },
    rateLimit: async (...args) => note('rateLimit', args),
  },
  '@/lib/runtime': {
    runtime: () => env, uid: () => requestId, timestamp: () => now,
    parse: (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } },
    run: async (sql, ...args) => {
      assert.equal(sql, 'INSERT INTO requests(id,owner,kind,data,created) VALUES(?,?,?,?,?)', 'Only the requested isolated inquiry insertion is permitted');
      note('persist', args);
      if (scenario.persistFailure) throw Error('Isolated inquiry storage unavailable.');
      const [id, owner, kind, data, created] = args;
      saved.set(id, { id, owner, kind, data, created });
      return { meta: { changes: 1 } };
    },
    all: async sql => {
      checkedAdmin(); note('all', sql);
      if (sql.startsWith('SELECT * FROM requests ')) return [...saved.values()];
      if (sql.startsWith('SELECT id,owner,status,total,data,created FROM orders ') || sql === 'SELECT * FROM campaigns') return [];
      throw Error('Unexpected read: ' + sql);
    },
    one: forbidden('database one'), database: () => { checkedAdmin(); return env.DB; },
  },
  '@/lib/product-batch': {adminBatchRecords:async(db,products)=>{checkedAdmin();assert.equal(db,env.DB);assert.deepEqual(products,[]);return [];}},
  '@/lib/commerce': { config: async () => { checkedAdmin(); note('config'); return {}; }, catalog: async visible => { checkedAdmin(); assert.equal(visible, false); note('catalog'); return []; } },
  '@/lib/private-presentation': { presentationData: value => value },
  '@/lib/catalog-visibility': { adminOrderView: value => value, currentSelection: () => true },
  '@/lib/seo-policy': { seoConfig: () => ({}), searchReport: () => ({}) },
  '@/lib/coa-outbox': {
    coaAutomationStatus: async (receivedEnv, ids) => { checkedAdmin(); assert.deepEqual(receivedEnv, env); assert.deepEqual(ids, [...saved.keys()]); note('coa-status', ids); return { config: { enabled: true, replyTo: 'reply@example.invalid', notifyTo: null }, mailConfigured: true, sender: 'BIOMOD <sender@example.invalid>', approvedReportCount: 3, requests: Object.fromEntries(ids.map(id => [id, { coa: status('queued'), alert: null }])) }; },
    enqueueCoaRequest: async (receivedEnv, id) => {
      assert.deepEqual(receivedEnv, env); assert.equal(id, requestId); note('enqueue-coa', id);
      if (scenario.publicRequest) assert(saved.has(id), 'The contact must be durably persisted before queueing'); else checkedAdmin();
      if (scenario.enqueueGate) await scenario.enqueueGate;
      if (scenario.enqueueFailure) throw Error('PRIVATE_MAIL_QUEUE_FAILURE');
      return status('queued');
    },
    enqueueRequestAlert: async (receivedEnv, id) => {
      assert.deepEqual(receivedEnv, env); assert.equal(id, requestId); assert(saved.has(id), 'The inquiry must be durably persisted before the alert'); note('enqueue-alert', id);
      if (scenario.alertGate) await scenario.alertGate;
      if (scenario.alertFailure) throw Error('PRIVATE_ALERT_QUEUE_FAILURE');
      return status('queued');
    },
    saveCoaConfig: async (receivedEnv, value) => { checkedAdmin(); assert.deepEqual(receivedEnv, env); note('save-coa-config', value); return value; },
    processCoaOutbox: async (receivedEnv, value) => {
      if (scenario.publicRequest) {
        note('background-' + value.purpose, value);
        try {
          assert(draining && responseReturned, 'Processing must begin only in the explicit post-response callback');
          assert.deepEqual(receivedEnv, env); assert(saved.has(value.requestId));
          const kind = saved.get(value.requestId).kind;
          assert(['coa', 'request-alert'].includes(value.purpose));
          assert(kind === 'contact' || value.purpose === 'request-alert', 'Partner requests cannot process a COA');
          assert.deepEqual(value, { requestId, purpose: value.purpose, limit: 1 }, 'First attempt is restricted to the generated inquiry ID and one purpose');
        } catch (error) { backgroundErrors.push(error); throw error; }
        if (scenario.providerGate) await scenario.providerGate;
        if (scenario.backgroundFailure === 'both' || scenario.backgroundFailure === value.purpose) throw Error('PRIVATE_BACKGROUND_PROVIDER_FAILURE');
        return { processed: 1, accepted: 1, review: 0 };
      }
      checkedAdmin(); assert.deepEqual(receivedEnv, env);
      assert.deepEqual(value, { requestId, purpose: 'coa', limit: 1 }, 'Manual COA action must not claim a generic request-alert');
      assert.equal(called('enqueue-coa').length, 1); note('process-coa', value); return { processed: 1, accepted: 1, review: 0 };
    },
    coaDeliveryStatuses: async (receivedEnv, ids) => { checkedAdmin(); assert.deepEqual(receivedEnv, env); assert.deepEqual(ids, [requestId]); assert.equal(called('process-coa').length, 1); note('delivery-status'); return { [requestId]: { coa: scenario.deliveryStatus === null ? null : status(scenario.deliveryStatus || 'accepted'), alert: null } }; },
  },
};
// Staff-role compatibility: the routes call requireStaff(permission); these fixtures model an
// owner (full access), so delegate to the existing requireAdmin stub and its call log.
dependencies['@/lib/auth'].requireStaff = async () => ({ ...(await dependencies['@/lib/auth'].requireAdmin()), role: 'owner' });
dependencies['@/lib/auth'].staffRole = async () => null;
dependencies['@/lib/staff'] = require('./staff-module-fixture.cjs').loadStaffModule();
dependencies['@/lib/staff-store'] = { staffDirectory: async () => { checkedAdmin(); return { ready: true, owners: [], staff: [], audit: [] }; }, saveStaffMember: async () => { throw Error('Staff writes are outside this suite'); } };

class FixtureResponse extends Response {
  static json(value, options = {}) { return new FixtureResponse(JSON.stringify(value), { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }); }
}
const mod = new Module(filename, module);
mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
const localRequire = Module.createRequire(filename);
mod.require = name => {
  if (name === 'next/server') return { NextResponse: FixtureResponse, after };
  if (name === 'next/headers') return { cookies: forbidden('cookies') };
  if (Object.hasOwn(dependencies, name)) return dependencies[name];
  if (name.startsWith('@/')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : forbidden(name + ':' + String(key)) });
  return localRequire(name);
};
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const { GET, POST } = mod.exports;
function reset(options = {}) { assert.equal(afterJobs.length, 0, 'Drain or explicitly inspect scheduled work before resetting'); scenario = { role: 'admin', ...options }; calls = []; saved = new Map(); backgroundErrors = []; draining = false; responseReturned = false; }
async function request(action, data, headers = {}) {
  const method = data === undefined ? 'GET' : 'POST';
  const req = new Request('https://store.example.invalid/api/store/' + action, { method, ...(method === 'POST' ? { headers: { origin: 'https://store.example.invalid', 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) } : {}) });
  req.nextUrl = new URL(req.url);
  const response = await (method === 'GET' ? GET : POST)(req, { params: Promise.resolve({ action }) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  responseReturned = true;
  return { status: response.status, body: await response.json() };
}
(async () => {
  // Neither unauthenticated nor ordinary signed-in visitors may read queues or act.
  for (const role of ['signedout', 'customer']) {
    reset({ role }); let result = await request('admin'); assert.equal(result.status, 400); assert.deepEqual(calls.map(c => c.name), ['customer', 'requireAdmin']);
    for (const [action, body] of [['admin-coa-config', { enabled: true, replyTo: 'reply@example.invalid' }], ['admin-coa-process', { id: requestId }]]) {
      reset({ role }); result = await request(action, body); assert.equal(result.status, 400); assert.deepEqual(calls.map(c => c.name), ['session', 'rateLimit', 'requireAdmin']);
    }
  }
  reset(); let result = await request('admin-coa-process', { id: requestId }, { origin: 'https://other.example.invalid' }); assert.equal(result.status, 403); assert.equal(calls.length, 0);
  reset(); result = await request('admin-coa-config', { enabled: true, replyTo: 'reply@example.invalid' }, { 'content-length': '30001' }); assert.equal(result.status, 413); assert.equal(calls.length, 0);
  reset(); result = await request('admin-coa-config', { enabled: 'true', replyTo: 'invalid' }); assert.equal(result.status, 400); assert.equal(called('save-coa-config').length, 0);
  reset(); result = await request('admin-coa-process', { id: 'not-an-existing-request-id' }); assert.equal(result.status, 400); assert.equal(called('enqueue-coa').length, 0); assert.equal(called('process-coa').length, 0);

  reset(); saved.set(requestId, { id: requestId, kind: 'contact', created: now, data: JSON.stringify(contact) });
  result = await request('admin'); assert.equal(result.status, 200); assert.equal(result.body.coaAutomation.approvedReportCount, 3); assert.equal(result.body.requests[0].data.email, contact.email); assert.equal(called('coa-status').length, 1); assert(!calls.some(c => /enqueue|process|save/.test(c.name)), 'Admin refresh must not queue or send'); assert.equal(called('after-register').length, 0); assert.equal(afterJobs.length, 0);
  reset({ role: 'signedout' }); result = await request('coa-originals'); assert.equal(result.status, 404); assert.equal(called('coa-status').length, 0); assert.equal(called('after-register').length, 0);
  reset(); result = await request('admin-coa-config', { enabled: true, replyTo: 'reply@example.invalid', notifyTo: null, recipient: 'intruder@example.invalid', base64: 'NOT_AN_ATTACHMENT', sender: 'unexpected@example.invalid' }); assert.equal(result.status, 200); assert.deepEqual(called('save-coa-config')[0].value, { enabled: true, replyTo: 'reply@example.invalid', notifyTo: null });

  // A saved public inquiry returns before post-response mail begins. Enqueue failures
  // do not turn the accepted inquiry into a failure or select a body-supplied ID.
  for (const failures of [{}, { enqueueFailure: true }, { alertFailure: true }, { enqueueFailure: true, alertFailure: true }]) {
    reset({ role: 'signedout', publicRequest: true, ...failures });
    result = await request('contact', { ...contact, id: '99999999-0000-4000-8000-000000000001', recipient: 'intruder@example.invalid', filename: 'forged.pdf' });
    assert.equal(result.status, 200); assert.equal(result.body.id, requestId); assert.match(result.body.message, /saved/);
    assert.equal(called('persist').length, 1); assert.equal(called('enqueue-coa').length, 1); assert.equal(called('enqueue-alert').length, 1);
    assert.equal(called('process-coa').length, 0); assert(!calls.some(call => call.name.startsWith('background-')), 'No processing is awaited by the public response');
    assert.equal(called('after-register').length, 1); assert.equal(afterJobs.length, 1);
    assert(calls.findIndex(call => call.name === 'persist') < calls.findIndex(call => call.name === 'enqueue-coa'));
    assert(calls.findIndex(call => call.name === 'enqueue-alert') < calls.findIndex(call => call.name === 'after-register'));
    assert.deepEqual(JSON.parse(saved.get(requestId).data), contact); assert.equal(saved.get(requestId).owner, null); assert.equal(saved.get(requestId).kind, 'contact');
    assert(!JSON.stringify(result.body).includes('PRIVATE_')); assert(!Object.hasOwn(result.body, 'status'));
    await drainAfter(); assertBackground('contact');
  }
  // Queue persistence must settle before callback registration; otherwise a fast
  // callback could run before its durable job exists and miss the first attempt.
  const enqueueGate = deferred(), alertGate = deferred();
  reset({ role: 'signedout', publicRequest: true, enqueueGate: enqueueGate.promise, alertGate: alertGate.promise });
  let responseDone = false; const waitingResponse = request('contact', contact).then(value => { responseDone = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.size, 1); assert.equal(called('enqueue-coa').length, 1); assert.equal(called('enqueue-alert').length, 1);
  assert.equal(responseDone, false); assert.equal(called('after-register').length, 0);
  enqueueGate.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(responseDone, false); assert.equal(called('after-register').length, 0);
  alertGate.resolve(); result = await waitingResponse; assert.equal(result.status, 200); assert.equal(afterJobs.length, 1);
  await drainAfter(); assertBackground('contact');

  // Hold the provider indefinitely: the saved response is already available and
  // neither purpose's pending first attempt can change it or mutate the request.
  const gate = deferred(); reset({ role: 'signedout', publicRequest: true, providerGate: gate.promise });
  result = await request('contact', contact); assert.equal(result.status, 200); assert.equal(afterJobs.length, 1);
  const savedBefore = JSON.stringify([...saved.values()]), replyBefore = JSON.stringify(result);
  let backgroundDone = false; const pending = drainAfter().then(() => { backgroundDone = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(backgroundDone, false); assertBackground('contact');
  assert.equal(JSON.stringify(result), replyBefore); gate.resolve(); await pending;
  assert.equal(JSON.stringify([...saved.values()]), savedBefore); assert.equal(called('persist').length, 1);

  // Each processing rejection is contained in after(), without leaking provider
  // detail or preventing the other purpose from receiving its own first attempt.
  for (const backgroundFailure of ['coa', 'request-alert', 'both']) {
    reset({ role: 'signedout', publicRequest: true, backgroundFailure });
    result = await request('contact', contact); assert.equal(result.status, 200);
    await assert.doesNotReject(() => drainAfter()); assertBackground('contact'); assert(!JSON.stringify(result).includes('PRIVATE_'));
  }
  for (const kind of ['contact', 'affiliate']) {
    reset({ role: 'customer', publicRequest: true, registrationFailure: true });
    result = await request(kind, kind === 'contact' ? contact : { website: 'https://partner.example.invalid', message: 'Isolated partner request' });
    assert.equal(result.status, 200); assert.match(result.body.message, /saved/); assert.equal(saved.size, 1);
    assert.equal(called('after-register').length, 1); assert.equal(afterJobs.length, 0); assert(!calls.some(call => call.name.startsWith('background-')));
    assert(!JSON.stringify(result.body).includes('PRIVATE_AFTER'));
  }
  // No durable inquiry means no enqueue and no scheduled callback.
  for (const example of [
    { kind: 'contact', options: { persistFailure: true }, body: contact, status: 400 },
    { kind: 'contact', options: {}, body: { ...contact, website: 'honeypot' }, status: 200 },
    { kind: 'contact', options: {}, body: { ...contact, email: 'invalid' }, status: 400 },
    { kind: 'affiliate', options: { persistFailure: true }, body: { website: 'https://partner.example.invalid', message: 'Isolated partner request' }, status: 400 },
    { kind: 'affiliate', options: { role: 'signedout' }, body: { website: 'https://partner.example.invalid', message: 'Isolated partner request' }, status: 400 },
    { kind: 'affiliate', options: {}, body: { website: '', message: '' }, status: 400 },
  ]) {
    reset({ role: 'customer', publicRequest: true, ...example.options }); result = await request(example.kind, example.body);
    assert.equal(result.status, example.status); assert.equal(saved.size, 0);
    assert.equal(called('enqueue-coa').length, 0); assert.equal(called('enqueue-alert').length, 0);
    assert.equal(called('after-register').length, 0); assert.equal(afterJobs.length, 0);
  }
  // Partner alerts bind the authenticated account email and generated request ID.
  // They never process a COA, even if arbitrary subject/recipient fields are sent.
  for (const failures of [{}, { alertFailure: true }, { backgroundFailure: 'request-alert' }]) {
    reset({ role: 'customer', publicRequest: true, ...failures });
    result = await request('affiliate', { id: '99999999-0000-4000-8000-000000000001', website: 'https://partner.example.invalid', message: 'Isolated partner request', email: 'intruder@example.invalid', subject: contact.subject });
    assert.equal(result.status, 200); assert.equal(saved.get(requestId).owner, account.id); assert.equal(JSON.parse(saved.get(requestId).data).email, account.email);
    assert.equal(called('enqueue-coa').length, 0); assert.equal(called('enqueue-alert').length, 1); assert.equal(afterJobs.length, 1);
    assert.equal(called('process-coa').length, 0); assert(!calls.some(call => call.name.startsWith('background-')));
    await assert.doesNotReject(() => drainAfter()); assertBackground('affiliate');
  }

  // Admin selects an existing request ID only. Body-supplied recipients/documents are ignored.
  for (const deliveryStatus of ['accepted', 'duplicate', 'queued', 'sending', 'manual_review', null]) {
    reset({ deliveryStatus }); result = await request('admin-coa-process', { id: requestId, recipient: 'intruder@example.invalid', subject: 'Replacement subject', filename: 'replacement.pdf', base64: 'FORGED_BYTES' });
    assert.equal(result.status, 200); assert.deepEqual(calls.map(c => c.name), ['session', 'rateLimit', 'requireAdmin', 'admin-ok', 'enqueue-coa', 'process-coa', 'delivery-status']); assert.equal(called('enqueue-alert').length, 0); assert.equal(called('after-register').length, 0); assert.equal(afterJobs.length, 0);
    assert(!JSON.stringify(result.body).includes('intruder') && !JSON.stringify(result.body).includes('FORGED_BYTES'));
    if (deliveryStatus === 'accepted') { assert.match(result.body.message, /provider accepted/); assert.match(result.body.message, /Inbox delivery is not yet confirmed/); }
    else assert(!result.body.message.includes('provider accepted'), 'Unconfirmed results must not claim mail acceptance');
  }
  reset({ enqueueFailure: true }); result = await request('admin-coa-process', { id: requestId }); assert.equal(result.status, 400); assert.equal(called('process-coa').length, 0); assert.equal(called('delivery-status').length, 0);
  assert.equal(forbiddenCalls, 0);
  console.log('PASS: actual COA API routes authorize before sensitive reads/writes; same-origin/body gates; validated settings and request ID only; inquiry persistence survives enqueue/registration/background failures; explicit after-response per-inquiry delivery; manual report-only processing; honest mail status; no network, real records or commerce mutations.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = oldFetch; });
