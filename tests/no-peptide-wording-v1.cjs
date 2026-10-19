/* Owner instruction, October 17, 2026: no "peptide" wording on the public site; the store is
 * Biomod Research Supply Company. Reads repository source only; no network or data. Allowed:
 * the filed softgel marks (shown only on softgel pages) and official compound names in catalog
 * data (Delta Sleep-Inducing Peptide, Epitalon Tetrapeptide, Copper Tripeptide-1), and the former
 * domain biomodpeptides.com as history. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const root = path.join(__dirname, '..');
const { pageRecords, pageInfo, sitemapPaths, seoConfig } = require('../lib/seo-policy.ts');
const { pressReleases, pressBoilerplate } = require('../lib/press-releases.ts');
const { researchFaqGroups } = require('../lib/research-faq.ts');
const release = require('../lib/seo-publication-v1.json');
// The former domain stays as history (owner, October 17); it is an address, not product wording.
const word = { test: text => /peptide/i.test(String(text).replace(/biomodpeptides\.com/gi, '')) };
const marks = /(The Original|World[’']s First) Peptide Softgel™/g;
const identities = /Delta Sleep-Inducing Peptide|Epitalon Tetrapeptide|Copper Tripeptide-1/g;

const config = seoConfig({ SEO_PUBLIC_ORIGIN: release.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: release.productSlugs.join(',') });
for (const route of sitemapPaths(config)) {
  const info = pageInfo(route);
  assert(!word.test(info.title + ' ' + info.description.replace(identities, '')), route + ': title and description');
  assert(!word.test(route), route + ': address');
}
for (const [route, record] of Object.entries(pageRecords)) if (route !== '/softgels') assert(!word.test(record.title + ' ' + record.description), route);
assert(!word.test(pressBoilerplate));
for (const r of pressReleases) assert(!word.test(JSON.stringify(r)), 'press release ' + r.slug);
assert(!word.test(JSON.stringify(researchFaqGroups)), 'FAQ');

// Visible copy in page components. The softgel story keeps the filed marks.
const visible = ['app/layout.tsx', 'app/page.tsx', 'lib/seo.ts', 'lib/llms-text.ts', 'components/store/content.tsx', 'components/store/catalog.tsx',
  'components/store/home-vials.tsx', 'components/store/research-vial-index.tsx', 'components/store/supplier-guide.tsx', 'components/store/quality-guide.tsx',
  'components/store/product-research-details.tsx', 'components/store/newsroom.tsx', 'components/store/brand-story.tsx', 'lib/product-description.ts'];
for (const file of visible) {
  let source = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('brand-story.tsx')) {
    // Marks may appear only in the softgel note and softgel sections, never on the About page.
    const about = source.slice(source.indexOf('export function AboutBrand'));
    assert(!word.test(about) && !/TrademarkNote/.test(about), 'About page carries no softgel mark');
    source = source.replace(marks, '');
  }
  assert(!word.test(source), file + ' contains peptide wording');
}
const footer = fs.readFileSync(path.join(root, 'components/store/content.tsx'), 'utf8');
assert(!/TrademarkNote/.test(footer), 'The sitewide footer no longer carries the softgel marks');
assert(/<TrademarkNote\/>/.test(fs.readFileSync(path.join(root, 'components/store/softgels.tsx'), 'utf8')), 'The softgel page keeps the trademark note');
console.log('PASS: no peptide wording in public titles, descriptions, addresses, press, FAQ or page copy; softgel marks only on softgel pages');
