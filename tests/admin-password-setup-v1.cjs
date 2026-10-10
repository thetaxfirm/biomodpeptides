/* Real auth helpers with isolated runtime, cookies and HTTP fixtures.
 * Never reads credentials or calls a live auth service, database or mailbox. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../lib/auth.ts');
const env = {
  SUPABASE_URL: 'https://auth-fixture.example.invalid',
  SUPABASE_ANON_KEY: 'isolated-public-key',
  STORE_ADMIN_EMAILS: 'chris@biomodcompounds.com, ash@biomodcompounds.com',
};
const cookies = new Map();
const cookieWrites = [];
const cookieJar = {
  get: name => cookies.has(name) ? { value: cookies.get(name) } : undefined,
  set: (...args) => { cookieWrites.push(args); throw new Error('Recovery must not establish an authenticated session'); },
  delete: name => { cookieWrites.push(['delete', name]); cookies.delete(name); },
};
const runtime = {
  runtime: () => env,
  one: async () => { throw new Error('Database access is forbidden in this auth-only test'); },
  run: async () => { throw new Error('Database writes are forbidden in this auth-only test'); },
  uid: () => { throw new Error('Session creation is forbidden in this auth-only test'); },
  timestamp: () => 0,
};
const calls = [];
let response = { status: 200, body: {} };
const originalFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  assert.equal(new URL(url).origin, env.SUPABASE_URL, 'Only the isolated provider is addressed');
  calls.push({ url: String(url), method: init.method, headers: { ...init.headers }, body: init.body ? JSON.parse(init.body) : undefined });
  return new Response(JSON.stringify(response.body), { status: response.status });
};
const subject = new Module(sourcePath, module);
subject.filename = sourcePath;
subject.paths = module.paths;
subject.require = request => {
  if (request === 'next/headers') return { cookies: async () => cookieJar };
  if (request === './runtime') return runtime;
  throw new Error('Unexpected dependency: ' + request);
};
subject._compile(ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, sourcePath);
const auth = subject.exports;

async function recovery(email, endpoint, normalized = email.trim().toLowerCase()) {
  const start = calls.length;
  const result = await auth.requestPasswordRecovery(email, 'https://trybiomod.com');
  assert.equal(result, undefined, 'Provider tokens or account state must not be returned from setup');
  assert.equal(calls.length, start + 1, 'Exactly one email request, without account lookup/enumeration');
  const call = calls.at(-1);
  const url = new URL(call.url);
  assert.equal(url.pathname, '/auth/v1/' + endpoint);
  assert.deepEqual([...url.searchParams.keys()], ['redirect_to']);
  assert.equal(url.searchParams.get('redirect_to'), 'https://trybiomod.com/reset-password');
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.body, endpoint === 'otp' ? { email: normalized, create_user: true } : { email: normalized });
  assert.equal(call.headers.Authorization, undefined, 'Setup cannot use an existing customer token');
  assert.equal(call.headers.apikey, 'isolated-public-key');
  assert.equal(cookieWrites.length, 0, 'An email request does not log the recipient in');
}

(async () => {
  try {
    for (const email of ['chris@biomodcompounds.com', 'ash@biomodcompounds.com', 'CHRIS@BIOMODCOMPOUNDS.COM', '  Ash@BioModCompounds.Com  '])
      assert.equal(auth.isAdminEmail(email), true, 'Exact owner-approved addresses accept normalized case and whitespace');
    for (const email of ['', ' ', 'buyer@example.invalid', 'ash+other@biomodcompounds.com', 'xash@biomodcompounds.com', 'ash@biomodcompounds.com.evil.invalid', 'ash@sub.biomodcompounds.com', 'chris@biomodcompounds.co'])
      assert.equal(auth.isAdminEmail(email), false, 'No partial address or domain grants administrator access');
    const originalAdmins = env.STORE_ADMIN_EMAILS;
    for (const setting of [undefined, '', ' ,  , ']) {
      env.STORE_ADMIN_EMAILS = setting;
      assert.equal(auth.isAdminEmail(''), false);
      assert.equal(auth.isAdminEmail('ash@biomodcompounds.com'), false, 'An empty or absent allowlist fails closed');
    }
    env.STORE_ADMIN_EMAILS = '  CHRIS@BIOMODCOMPOUNDS.COM , ash@biomodcompounds.com  ';
    assert.equal(auth.isAdminEmail('chris@biomodcompounds.com'), true, 'Runtime allowlist entries normalize case and whitespace');
    env.STORE_ADMIN_EMAILS = originalAdmins;

    // Existing and new admin accounts use the same possession-verifying link flow.
    // The application does not enumerate account existence or set a password.
    response = { status: 200, body: {} };
    await recovery('ash@biomodcompounds.com', 'otp');
    response = { status: 200, body: { id: 'isolated-existing-admin' } };
    await recovery('chris@biomodcompounds.com', 'otp');
    await recovery('  ASH@BIOMODCOMPOUNDS.COM  ', 'otp');
    await recovery(' CHRIS@BIOMODCOMPOUNDS.COM ', 'otp');
    await recovery(' Buyer@Example.Invalid ', 'recover', 'buyer@example.invalid');
    for (const email of ['ash+other@biomodcompounds.com', 'xash@biomodcompounds.com', 'ash@biomodcompounds.com.evil.invalid'])
      await recovery(email, 'recover');

    // Even an unexpected provider payload must remain inside the server boundary.
    response = { status: 200, body: { access_token: 'isolated-access-sentinel', refresh_token: 'isolated-refresh-sentinel', password: 'isolated-password-sentinel' } };
    await recovery('ash@biomodcompounds.com', 'otp');
    await recovery('buyer@example.invalid', 'recover');
    for (const call of calls) assert.equal(Object.hasOwn(call.body || {}, 'password'), false, 'Setup never creates or transmits a temporary password');

    for (const status of [400, 401, 429, 500]) {
      response = { status, body: { message: 'private-provider-detail', access_token: 'isolated-access-sentinel' } };
      for (const email of ['ash@biomodcompounds.com', 'buyer@example.invalid']) {
        await assert.rejects(auth.requestPasswordRecovery(email, 'https://trybiomod.com'), error => {
          assert.equal(error.message, 'This account request could not be completed. Please check your details.');
          assert.ok(!error.message.includes('private-provider-detail'));
          return true;
        });
      }
    }
    const beforeUnavailable = calls.length;
    const publicKey = env.SUPABASE_ANON_KEY;
    env.SUPABASE_ANON_KEY = undefined;
    await assert.rejects(auth.requestPasswordRecovery('ash@biomodcompounds.com', 'https://trybiomod.com'), /Customer sign-in is being connected/);
    assert.equal(calls.length, beforeUnavailable, 'Missing auth configuration never sends an email request');
    env.SUPABASE_ANON_KEY = publicKey;

    // Authorization still requires a validated provider identity and confirmation.
    cookies.set('bm_access', 'isolated-session-token');
    for (const email of ['chris@biomodcompounds.com', 'ash@biomodcompounds.com', 'ASH@BIOMODCOMPOUNDS.COM']) {
      response = { status: 200, body: { id: 'isolated-admin', email, email_confirmed_at: '2026-10-10T00:00:00Z', user_metadata: { name: 'Isolated admin' }, access_token: 'isolated-access-sentinel' } };
      const user = await auth.requireAdmin();
      assert.deepEqual(user, { id: 'isolated-admin', email, name: 'Isolated admin' });
      assert.equal(calls.at(-1).method, 'GET');
      assert.equal(new URL(calls.at(-1).url).pathname, '/auth/v1/user');
      assert.equal(calls.at(-1).headers.Authorization, 'Bearer isolated-session-token');
    }
    for (const email of ['chris@biomodcompounds.com', 'ash@biomodcompounds.com']) {
      response = { status: 200, body: { id: 'isolated-unverified', email, email_confirmed_at: null } };
      await assert.rejects(auth.requireAdmin(), /Please sign in to continue/);
    }
    for (const email of ['buyer@example.invalid', 'ash+other@biomodcompounds.com', 'ash@biomodcompounds.com.evil.invalid']) {
      response = { status: 200, body: { id: 'isolated-customer', email, email_confirmed_at: '2026-10-10T00:00:00Z' } };
      await assert.rejects(auth.requireAdmin(), /Administrator access is required/);
    }
    response = { status: 401, body: { message: 'Expired fixture token' } };
    await assert.rejects(auth.requireAdmin(), /Please sign in to continue/);
    cookies.clear();
    const beforeAnonymous = calls.length;
    await assert.rejects(auth.requireAdmin(), /Please sign in to continue/);
    assert.equal(calls.length, beforeAnonymous, 'Anonymous admin access does not call the provider');
    assert.equal(cookieWrites.length, 0);
    console.log('PASS: separate admin password setup by verified email link, preserved Chris access, exact allowlist, ordinary recovery, generic failures and no password/session exposure');
  } finally {
    global.fetch = originalFetch;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
