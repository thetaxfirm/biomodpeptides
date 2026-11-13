// The reserved-slug list must cover every top-level name the storefront already serves, or a
// restaurant link would be shadowed by a real page and quietly do nothing (owner, Nov 13 2026).
// This suite reads the real route tables so the list cannot silently fall behind the site.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name;
  m.require = id => id.startsWith('./') ? load('lib/' + id.slice(2) + '.ts') : (() => { throw Error('Unexpected dependency ' + id); })();
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, name);
  return m.exports;
}
const P = load('lib/restaurant-partners.ts');
const first = p => String(p).replace(/^\/+/, '').split('/')[0].toLowerCase();

// --- Every top-level page the SEO tables name ---
const seo = fs.readFileSync(path.join(root, 'lib/seo-policy.ts'), 'utf8');
const pagePaths = [...seo.matchAll(/^\s*'(\/[a-z0-9][a-z0-9/-]*)':\s*\{/gim)].map(m => m[1]);
assert(pagePaths.length > 10, 'the page table was read, not missed by the pattern');
for (const page of pagePaths) {
  const segment = first(page);
  if (!segment) continue;
  assert(P.slugReserved(segment), 'storefront page /' + segment + ' is not in RESERVED_SLUGS');
}

// --- Every route the catch-all accepts by name ---
const catchAll = fs.readFileSync(path.join(root, 'app/[...path]/page.tsx'), 'utf8');
const listed = /\[([^\]]*)\]\.includes\(path\)/.exec(catchAll);
assert(listed, 'the catch-all still names its routes in a list');
for (const quoted of listed[1].match(/'[^']+'/g) || []) {
  const segment = first(quoted.slice(1, -1));
  assert(P.slugReserved(segment), 'catch-all route ' + segment + ' is not in RESERVED_SLUGS');
}

// --- Every single-segment legacy redirect ---
const legacy = load('lib/legacy-routes.ts').legacyRoutes;
const singles = Object.keys(legacy).filter(route => !route.includes('/'));
assert(singles.length > 20, 'the legacy table was read, not missed');
for (const route of singles) assert(P.slugReserved(route), 'legacy route ' + route + ' is not reserved');
// Derived, not copied: a new single-segment redirect is reserved without anyone editing a list.
assert(P.slugReserved('signup') && P.slugReserved('my-account') && P.slugReserved('es'));

// --- Every directory served outside the page tree ---
for (const entry of fs.readdirSync(path.join(root, 'app'), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('[') || entry.name.startsWith('(')) continue;
  assert(P.slugReserved(entry.name), 'app route /' + entry.name + ' is not in RESERVED_SLUGS');
}

// --- And the guard actually refuses them ---
assert.equal(P.slugReserved('shop'), true);
assert.equal(P.slugReserved('SHOP'), true, 'case does not matter');
assert.equal(P.slugReserved(' admin '), true, 'nor does stray whitespace');
assert.equal(P.slugReserved('mariospizza15'), false, 'an ordinary restaurant code is fine');
assert.equal(P.slugReserved(''), false); assert.equal(P.slugReserved(null), false);

// A restaurant whose name collides gets no link at all, rather than a renamed one the owner
// does not know about, and so cannot be switched on.
// The link is the code, so a clash needs a name whose code lands on a reserved address.
const clash = P.normalizePartners([{ slot: 1, name: 'Sho', percentOff: 10, active: true }]);
assert.equal(P.codeFromName('Sho', 1, 10), 'SHO10');
assert.equal(P.slugReserved('sho10'), false, 'that one is free, so it works');
assert.equal(clash[0].slug, 'sho10'); assert.equal(clash[0].active, true);
const taken = P.normalizePartners([{ slot: 1, name: 'Shop', percentOff: 0, active: true }]);
assert.equal(taken[0].code, 'SHOP', 'with no discount the code is the bare name');
assert.equal(taken[0].slug, '', 'which the storefront already answers for, so there is no link');
assert.equal(taken[0].active, false, 'and the slot cannot go live');
assert.deepEqual(P.livePartnerCodes(taken), []);
assert.equal(P.partnerCodeForSlug(taken, 'shop'), '', 'and it never resolves');
const fine = P.normalizePartners([{ slot: 1, name: 'The News Room', percentOff: 10, active: true }]);
assert.equal(fine[0].slug, 'thenewsroom10', 'a name merely containing a reserved word is fine');
assert.equal(fine[0].active, true);

// --- Only a single bare segment can ever be a restaurant link ---
assert.equal(P.linkSlugCandidate(['mariospizza15']), 'mariospizza15');
assert.equal(P.linkSlugCandidate(['mariospizza15', 'menu']), '', 'a deeper path is never a link');
assert.equal(P.linkSlugCandidate(['account', 'orders']), '');
assert.equal(P.linkSlugCandidate([]), ''); assert.equal(P.linkSlugCandidate(null), '');
assert.equal(P.linkSlugCandidate(['shop']), '', 'nor is a reserved name');
assert.equal(P.linkSlugCandidate(['signup']), '', 'nor an old redirect address');
assert.equal(P.linkSlugCandidate(['MARIOSPIZZA15']), 'mariospizza15', 'case is normalised');
assert.equal(P.linkSlugCandidate(['marios pizza15']), '', 'a space is not a valid address');
assert.equal(P.linkSlugCandidate(['../etc']), '', 'nor is anything that is not a plain slug');
assert.equal(P.linkSlugCandidate(['x'.repeat(41)]), '', 'nor an over-long one');
// --- The middleware is where a bare address is answered ---
const proxy = fs.readFileSync(path.join(root, 'proxy.ts'), 'utf8');
assert.match(proxy, /linkSlugCandidate\(request\.nextUrl\.pathname\.split\('\/'\)\.filter\(Boolean\)\)/, 'the middleware uses exactly this rule');
assert.match(proxy, /NextResponse\.redirect\(partner, 302\)/, 'and redirects temporarily, never permanently');
assert.match(proxy, /new URL\('\/r\/' \+ slug, request\.nextUrl\.origin\)/, 'handing off to the route that owns the cookie');
assert(proxy.indexOf('canonicalRedirect') < proxy.indexOf('partnerRedirect(request)'), 'the canonical host redirect still wins');
assert.match(proxy, /request\.method !== 'GET' && request\.method !== 'HEAD'/, 'only a plain page request is ever looked up');
assert.match(proxy, /catch \{ return null; \}/, 'an unreadable settings row leaves the storefront as it was');
// The catch-all page is deliberately untouched: reaching the database from it would pull the
// Worker runtime into every harness that renders it.
const page = fs.readFileSync(path.join(root, 'app/[...path]/page.tsx'), 'utf8');
assert(!/restaurant-partners/.test(page), 'the public page never resolves partner links');

console.log('PASS: the reserved-slug list covers every storefront page, named catch-all route, single-segment legacy redirect and app directory; a restaurant name colliding with one gets no link and cannot go live. Read from the real route tables.');
