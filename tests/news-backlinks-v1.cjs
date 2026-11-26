/* Press releases are linked from the pages they are about and from each other, not only from
 * the /news list. HTML-only rendering of the real components; no network or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolveFilename.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.css'] = module => { module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }); };
global.fetch = async () => { throw new Error('Network forbidden in news back-link tests'); };
const { pressReleases, releasesLinking, otherReleases } = require('../lib/press-releases.ts');
const { pageRecords } = require('../lib/seo-policy.ts');
const { lastmodFor } = require('../lib/sitemap-lastmod.ts');
const { Newsroom, PressReleasePage, RelatedNews } = require('../components/store/newsroom.tsx');
const { SupplierGuide } = require('../components/store/supplier-guide.tsx');
const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));
const links = html => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map(match => ({ href: match[1], text: match[2].replace(/<[^>]+>/g, '').trim() }));
const source = file => fs.readFileSync(path.join(root, 'components/store', file), 'utf8');

// Pages that carry the back-link section, and proof each one really mounts it.
const backlinkPages = { '/quality-standard': 'quality-guide.tsx', '/choosing-a-research-supplier': 'supplier-guide.tsx', '/faq': 'research-faq.tsx' };
for (const [page, file] of Object.entries(backlinkPages)) {
  assert(pageRecords[page]?.eligible, page + ' is an indexed page');
  assert(source(file).includes(`<RelatedNews path="${page}"/>`), file + ' mounts the newsroom back-links for ' + page);
  assert(releasesLinking(page).length > 0, page + ' is named by at least one release');
}

const inbound = Object.fromEntries(pressReleases.map(release => ['/news/' + release.slug, new Set()]));
for (const link of links(render(Newsroom))) if (inbound[link.href]) inbound[link.href].add('/news');
for (const page of Object.keys(backlinkPages)) {
  const html = render(RelatedNews, { path: page });
  assert(html.includes('From the newsroom'), page + ' back-link section has its heading');
  const found = links(html);
  assert.deepEqual(found.map(link => link.href), releasesLinking(page).map(release => '/news/' + release.slug), page + ' links exactly the releases that name it');
  for (const link of found) {
    assert.equal(link.text, pressReleases.find(release => '/news/' + release.slug === link.href).headline, 'Link text is the release headline');
    inbound[link.href].add(page);
  }
}
// The supplier guide is a plain component, so check the section in the full rendered page too.
assert(links(render(SupplierGuide)).some(link => link.href === '/news/guide-to-reading-coa'), 'supplier guide page renders its release link');
// A page no release names shows nothing, not an empty heading.
assert.equal(render(RelatedNews, { path: '/contact' }), '');
assert.equal(render(RelatedNews, { path: '/news/not-a-release' }), '');

for (const release of pressReleases) {
  const self = '/news/' + release.slug;
  const html = render(PressReleasePage, { slug: release.slug });
  const found = links(html).map(link => link.href);
  assert(html.includes('More news'), self + ' lists the other releases');
  assert(!found.includes(self), self + ' does not link to itself');
  for (const other of otherReleases(release.slug)) {
    assert(found.includes('/news/' + other.slug), self + ' links ' + other.slug);
    inbound['/news/' + other.slug].add(self);
  }
  for (const link of release.links) assert(found.includes(link.href), self + ' keeps its own link to ' + link.href);
}
for (const [release, sources] of Object.entries(inbound)) assert(sources.size >= 3, release + ' is linked from at least three pages, found ' + [...sources].join(', '));
// The pages that gained a visible section on November 26 tell search engines they changed.
for (const page of [...Object.keys(backlinkPages), ...Object.keys(inbound)]) assert(lastmodFor(page) >= '2026-11-26', page + ' gained a newsroom link on 2026-11-26 but is dated ' + lastmodFor(page));
assert(!/biomodpro/i.test(render(Newsroom) + pressReleases.map(release => render(PressReleasePage, { slug: release.slug })).join('')));
console.log('PASS: ' + pressReleases.length + ' press releases are each linked from ' + Math.min(...Object.values(inbound).map(set => set.size)) + ' or more pages (news list, the other release and the pages they announce)');
