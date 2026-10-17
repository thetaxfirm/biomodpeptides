/* Request lifetime guard (lib/request-lifetime.ts). Pure in-process fakes:
 * no network, Cloudflare bindings, database or customer data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
const { keepRequestAlive } = require('../lib/request-lifetime.ts');

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const context = () => { const kept = []; return { kept, waitUntil: p => kept.push(p), settled: () => Promise.all(kept) }; };
const state = async promise => { const marker = {}; return (await Promise.race([promise.then(() => 'settled'), new Promise(r => setTimeout(() => r(marker), 20))])) === marker ? 'pending' : 'settled'; };
const html = (body, headers = {}) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

(async () => {
  // The source of the live hang: work shared by later requests must stay alive with its creator.
  const shared = deferred();
  const ctx = context();
  const responding = keepRequestAlive(async () => { await shared.promise; return html('<p>ok</p>'); })(new Request('https://trybiomod.com/faq'), {}, ctx);
  assert.equal(ctx.kept.length, 1, 'The request is registered with waitUntil before any await');
  assert.equal(await state(ctx.kept[0]), 'pending', 'The request stays alive while its render waits on shared work');
  shared.resolve();
  const response = await responding;
  assert.equal(await response.text(), '<p>ok</p>', 'Rendered documents reach the client unchanged');
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(ctx.kept.length, 2, 'The streamed body is kept alive too');
  await ctx.settled();

  // A crawler or prefetch that disconnects mid-body: the request still lives through the grace period.
  const slow = context();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('<html>')); } });
  const cancelled = await keepRequestAlive(() => html(stream), 40)(new Request('https://trybiomod.com/shop'), {}, slow);
  await cancelled.body.cancel('client disconnected');
  const started = Date.now();
  await slow.settled();
  assert(Date.now() - started >= 30, 'A disconnected render keeps its I/O context for the grace period');

  // Errors still reach the framework's caller, and the keep-alive itself never rejects.
  const failing = context();
  await assert.rejects(keepRequestAlive(async () => { throw new Error('render failed'); })(new Request('https://trybiomod.com/x'), {}, failing), /render failed/);
  await failing.settled();

  // Bodiless, binary, encoded and redirect responses are returned as the very same object.
  for (const original of [new Response(null, { status: 301, headers: { location: 'https://trybiomod.com/' } }),
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
    html('x', { 'content-encoding': 'br' })]) {
    const c = context();
    assert.equal(await keepRequestAlive(() => original)(new Request('https://trybiomod.com/'), {}, c), original);
    assert.equal(c.kept.length, 1);
  }

  // Without an execution context (local tooling) the handler is called as is.
  const plain = html('plain');
  assert.equal(await keepRequestAlive(() => plain)(new Request('https://trybiomod.com/'), {}, undefined), plain);

  // The deployed worker uses the guard for every HTTP request.
  const worker = fs.readFileSync(require.resolve('../worker.ts'), 'utf8');
  assert.match(worker, /fetch: keepRequestAlive\(storefront\.fetch\.bind\(storefront\)\)/);
  console.log('PASS: every request stays alive until its render settles, including after a client disconnect; responses are unchanged');
})().catch(error => { console.error(error); process.exit(1); });
