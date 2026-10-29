/* Buy-intent titles, visible product questions and their FAQPage markup, with isolated settings.
 * No network, credentials, production bindings or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { products } = require('../lib/catalog.ts');
const publication = require('../lib/seo-publication-v1.json');
const { seoConfig, pageInfo, sitemapPaths } = require('../lib/seo-policy.ts');
const { productQuestions, productLabel } = require('../lib/product-questions.ts');
const { researchFaqGroups, researchFaqSchemaItems } = require('../lib/research-faq.ts');
const origin = publication.origin;
const env = { SEO_PUBLIC_ORIGIN: origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') };
const config = seoConfig(env);
const snapshot = { verified: true, products: products.map(product => ({ ...product })) };
const originalLoad = Module._load;
global.fetch = async () => { throw new Error('Network forbidden in search tests'); };
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/commerce.ts') && request === './runtime') return {
    runtime: () => env, setting: async (key, fallback) => fallback,
    all: async () => { throw new Error('Unexpected database read'); }, one: async () => { throw new Error('Unexpected database read'); },
  };
  if (parent?.filename.endsWith('/lib/seo.ts')) {
    if (request === './runtime') return { runtime: () => env };
    if (request === 'next/headers') return { headers: async () => new Map([['host', 'trybiomod.com']]) };
    if (request === './public-catalog') return { publicCatalog: async () => snapshot };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { routeStructuredData, routeMetadata } = require('../lib/seo.ts');
const node = (data, type) => data['@graph'].find(item => item['@type'] === type);

(async () => {
  // Searched phrases appear in titles and descriptions where they are true.
  assert.match(pageInfo('/').title, /^Buy Research Compounds/);
  assert.match(pageInfo('/shop').title, /^Buy Research Compounds/);
  assert.match(pageInfo('/faq').title, /Buy Research Compounds/);
  assert.match(pageInfo('/').description, /BPC-157 10mg/);
  const bpc = products.find(p => p.slug === 'bpc-157-10mg');
  assert.equal(productLabel(bpc), 'BPC-157 10mg');
  const wolverine = products.find(p => p.slug === 'wolverine-10mg');
  assert(productQuestions(bpc).some(q => q.answer.join(' ').includes('BPC157 and BPC 157')));
  assert(productQuestions(wolverine).some(q => q.id === 'blend-contents' && q.answer.join(' ').includes('not 10 mg of BPC-157 plus 10 mg of TB-500')));
  assert(productQuestions(bpc).some(q => q.id === 'compare-blend'));
  assert(productQuestions(wolverine).some(q => q.id === 'compare-blend'));

  assert.equal(pageInfo('/product/bpc-157-10mg').title, 'Buy BPC-157 10mg Vials');
  assert.equal(pageInfo('/product/bpc-157-10mg').name, 'BPC-157 10mg Research Vial');
  assert.equal(routeMetadata('/product/bpc-157-10mg', new URLSearchParams(), config).title.absolute, 'Buy BPC-157 10mg Vials | Biomod Research Supply Company');
  for (const path of sitemapPaths(config).filter(path => ['/', '/shop', '/faq'].includes(path) || path.startsWith('/product/'))) {
    const info = pageInfo(path), title = path === '/' ? info.title : info.title + ' | Biomod Research Supply Company';
    assert(title.length <= 70, 'Title fits a result line: ' + title);
    assert(info.description.length <= 160, 'Description fits a result snippet: ' + path);
    assert(!/\b(dos(e|ing)|treat|cure|heal|human use)\b/i.test(info.title + ' ' + info.description.replace(/not for human or animal use/i, '')), 'No dosing or medical claims: ' + path);
  }

  for (const slug of publication.productSlugs) {
    const path = '/product/' + slug;
    const data = await routeStructuredData(path, config);
    const product = products.find(p => p.slug === slug);
    assert.equal(node(data, 'Product').name, pageInfo(path).name, slug + ': Product name has no "Buy" prefix');
    const faq = node(data, 'FAQPage');
    assert(faq, slug + ': FAQPage present');
    const visible = productQuestions(snapshot.products.find(p => p.id === product.id));
    assert.deepEqual(faq.mainEntity.map(q => [q.name, q.acceptedAnswer.text]), visible.map(q => [q.question, q.answer.join(' ')]), slug + ': markup mirrors visible questions');
    assert.equal(faq.mainEntity[0].name, `How do I buy ${productLabel(product)}?`);
  }
  assert.equal(node(await routeStructuredData('/product/bpc-157-10mg', config), 'FAQPage').mainEntity[0].name, 'How do I buy BPC-157 10mg?');

  const faqData = await routeStructuredData('/faq', config);
  const faq = node(faqData, 'FAQPage');
  assert.equal(faq.mainEntity[0].name, 'How do I buy research compounds from Biomod?');
  assert.equal(faq.mainEntity.length, researchFaqSchemaItems().length);
  assert(!faq.mainEntity.some(q => q.name === 'Where does Biomod ship?'), 'Live-rendered shipping answer stays out of the markup');
  assert.equal(researchFaqGroups[0].questions[0].href, '/shop');
  for (const path of ['/', '/shop', '/about']) assert(!node(await routeStructuredData(path, config), 'FAQPage'), path + ': no FAQPage without visible questions');

  const org = node(faqData, 'Organization');
  assert.equal(org.logo, origin + '/brand/logo-navy-tm-v36.png');
  assert(fs.statSync(require('node:path').join(__dirname, '../public/brand/logo-navy-tm-v36.png')).size > 1000);
  console.log('PASS: buy-intent titles within length, Product names without "Buy", product and /faq FAQPage mirror visible answers, PNG logo');
})().catch(error => { console.error(error); process.exit(1); });
