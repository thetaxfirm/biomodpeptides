/* Owner instruction, November 26, 2026: no "peptide" wording on the public site again, because of
 * the risk to credit card processing (it was restored November 15 for search, and removed before on
 * October 17 and 23). The store is Biomod Research Supply Company selling research compounds.
 * Reads repository source and data only; no network, database or customer data.
 *
 * Two checks:
 * 1. What visitors and search engines see: every published page's title and description, product
 *    names, FAQ, collections, compound reference, product questions, press and llms.txt.
 * 2. Every source line that mentions the word, so new copy cannot slip in anywhere (it did on
 *    October 28, after the first guard was removed). The only allowed uses are hidden ones listed
 *    below: redirects from old addresses, category slugs, search synonyms, lab-report matching
 *    and spam filters. Comments are ignored. To allow the word again, the owner must ask, and this
 *    test is changed in that same commit. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, f);
const root = path.join(__dirname, '..');
// The former domain and the shared mailbox are addresses, not product wording.
const strip = text => String(text).replace(/biomodpeptides/gi, '');
const has = text => /peptide/i.test(strip(text));
const found = [];
const check = (where, text) => { if (has(text)) found.push(where + ': ' + (strip(text).match(/.{0,50}peptide.{0,50}/i) || [''])[0]); };

// 1. Public text.
const { pageRecords, pageInfo, sitemapPaths, seoConfig } = require('../lib/seo-policy.ts');
const release = require('../lib/seo-publication-v1.json');
const config = seoConfig({ SEO_PUBLIC_ORIGIN: release.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: release.productSlugs.join(',') });
const routes = sitemapPaths(config);
assert(routes.length > 50, 'The sitemap lists the published pages');
for (const route of routes) {
  const info = pageInfo(route);
  check(route + ' title/description', [info.title, info.description, info.name].join(' '));
  check(route + ' address', route);
}
for (const [route, record] of Object.entries(pageRecords)) check(route + ' record', record.title + ' ' + record.description);
const { researchFaqGroups } = require('../lib/research-faq.ts');
check('FAQ', JSON.stringify(researchFaqGroups));
const { pressReleases, pressBoilerplate } = require('../lib/press-releases.ts');
check('press boilerplate', pressBoilerplate);
for (const r of pressReleases) check('press ' + r.slug, JSON.stringify(r));
const { collections } = require('../lib/collections.ts');
for (const c of collections) check('collection ' + c.slug, [c.name, c.title, c.description, c.intro].join(' '));
const ref = require('../lib/compound-reference.ts');
for (const c of ref.compounds) check('compound ' + c.slug, JSON.stringify(c) + ref.compoundTitle(c) + ref.compoundDescription(c) + JSON.stringify(ref.compoundQuestions(c, [])));
for (const x of ref.comparisons) check('comparison ' + x.slug, x.intro + ref.comparisonTitle(x) + ref.comparisonDescription(x));
const { products } = require('../lib/catalog.ts');
const { productQuestions } = require('../lib/product-questions.ts');
const { productNameVariants } = require('../lib/product-names.ts');
for (const p of products) {
  check('product ' + p.slug + ' categories', JSON.stringify(p.categories.map(c => c.name)));
  check('product ' + p.slug + ' questions', JSON.stringify(productQuestions(p)));
}
check('product name variants', JSON.stringify(productNameVariants));
const { llmsText } = require('../lib/llms-text.ts');
check('llms.txt', llmsText(release.origin, routes, products));

// 2. Every source line. Allowed hidden uses, per file; anything else fails with file and line.
const allowed = {
  'lib/legacy-routes.ts': /./, // old biomodpeptides.com addresses that redirect here
  'app/storefront-v9.css': /data-format=research-peptides/,
  'components/store/experience.tsx': /query\.category === 'research-peptides'/,
  'lib/catalog.ts': /c\.slug === 'research-peptides'/,
  'lib/product-search.ts': /peptideVialSlugs|peptides: 'peptide'|wanted\.includes\('peptide'\)|reviewedPeptide/,
  'lib/product-batch.ts': /lyophilized peptide/, // matches the form the lab wrote on its report
  'lib/testing.ts': /'BIOMOD PEPTIDES'/, // the name the labs print on their reports
  'lib/request-issues.ts': /SELLER_INTRO|SELLER_OFFER/, // spam filter for supplier pitches
  'lib/reply-gate.ts': /SELLER_WORDS/,
};
const comment = line => /^\s*(\/\/|\*|\/\*)/.test(line);
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [path.join(dir, e.name)] : []);
const files = ['app', 'components', 'lib'].flatMap(walk);
assert(files.length > 100, 'Source files found');
for (const file of files) {
  fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, i) => {
    if (comment(line) || !has(line)) return;
    const rule = allowed[file.split(path.sep).join('/')];
    if (!rule || !rule.test(line)) found.push(file + ':' + (i + 1) + ': ' + line.trim().slice(0, 140));
  });
}

assert.deepEqual(found, [], '"peptide" is back in public wording:\n' + found.join('\n'));
console.log('PASS: no "peptide" in ' + routes.length + ' page titles and descriptions, product names, FAQ, collections, compound reference, product questions, press or llms.txt; every source mention is a listed hidden use');
