/* Newsroom and press releases: indexable, in the sitemap and llms.txt, with matching NewsArticle markup.
 * Isolated settings; no network or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { products } = require('../lib/catalog.ts');
const publication = require('../lib/seo-publication-v1.json');
const { seoConfig, pageInfo, sitemapPaths, mayIndex } = require('../lib/seo-policy.ts');
const { pressReleases, pressReleaseAt, pressBoilerplate } = require('../lib/press-releases.ts');
const { llmsText } = require('../lib/llms-text.ts');
const origin = publication.origin;
const env = { SEO_PUBLIC_ORIGIN: origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') };
const config = seoConfig(env);
const snapshot = { verified: true, products: products.map(product => ({ ...product })) };
const originalLoad = Module._load;
global.fetch = async () => { throw new Error('Network forbidden in newsroom tests'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/commerce.ts') && request === './runtime') return { runtime: () => env, setting: async (k, f) => f, all: async () => { throw new Error('db'); }, one: async () => { throw new Error('db'); } };
  if (parent?.filename.endsWith('/lib/seo.ts')) {
    if (request === './runtime') return { runtime: () => env };
    if (request === 'next/headers') return { headers: async () => new Map([['host', 'trybiomod.com']]) };
    if (request === './public-catalog') return { publicCatalog: async () => snapshot };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { routeStructuredData } = require('../lib/seo.ts');

(async () => {
  assert(pressReleases.length >= 2);
  const paths = sitemapPaths(config);
  assert(paths.includes('/news'));
  const banned = /\b(dos(e|ing)|treat(s|ment)?|cure|heal(s|ing)?|clinically|FDA[- ]approved|best|#1|guarantee)\b|biomodpro/i;
  for (const release of pressReleases) {
    const path = '/news/' + release.slug;
    assert(paths.includes(path), path + ' in sitemap');
    assert(mayIndex(path, new URLSearchParams(), config));
    assert.equal(pressReleaseAt(path), release);
    assert.equal(pageInfo(path).title, release.headline);
    assert((release.headline + ' | Biomod Research Supply Company').length <= 70, 'Title fits a result line: ' + release.headline);
    assert(release.summary.length <= 160, 'Summary fits a snippet: ' + release.slug);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(release.date));
    assert(!banned.test([release.headline, release.summary, ...release.body].join(' ').replace(/does not provide dosing or medical advice/i, '')), 'No medical, dosing, ranking or held-site claims: ' + release.slug);
    for (const link of release.links) assert(link.href.startsWith('/') && !/biomodpro/i.test(link.href));
    const data = await routeStructuredData(path, config);
    const article = data['@graph'].find(node => node['@type'] === 'NewsArticle');
    assert(article, path + ' NewsArticle');
    assert.equal(article.headline, release.headline);
    assert.equal(article.datePublished, release.date);
    assert.equal(article.publisher['@id'], origin + '/#organization');
    assert.equal(article.articleBody, release.body.join(' '));
  }
  assert(!mayIndex('/news/not-a-release', new URLSearchParams(), config));
  assert(!pageInfo('/news/not-a-release').eligible);
  assert(!(await routeStructuredData('/faq', config))['@graph'].some(node => node['@type'] === 'NewsArticle'));
  assert(!/biomodpro/i.test(pressBoilerplate));
  const llms = llmsText(origin, paths, snapshot.products);
  assert(llms.includes('## News and press releases'));
  for (const release of pressReleases) assert(llms.includes(`[${release.headline}](${origin}/news/${release.slug})`));
  assert(llms.indexOf('## News and press releases') < llms.indexOf('## Research products'));
  console.log('PASS: newsroom and ' + pressReleases.length + ' press releases indexable, in sitemap and llms.txt, with NewsArticle markup and no medical, ranking or BiomodPro claims');
})().catch(error => { console.error(error); process.exit(1); });
