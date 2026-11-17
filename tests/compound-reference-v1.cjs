/* Compound reference, comparison and lot-lookup pages: identifiers agree with the catalog, titles fit
 * the result line, every page is in the sitemap while its products are published, the pages render one
 * h1 with links only to published products, and the FAQPage markup repeats the visible questions.
 * HTML-only render with stubbed SEO dependencies: no network, credentials or data writes. */
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
global.fetch = async () => { throw new Error('Network forbidden in compound reference tests'); };

const publication = require('../lib/seo-publication-v1.json');
const env = { SEO_PUBLIC_ORIGIN: publication.origin, SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true', SEO_REVIEWED_PRODUCT_SLUGS: publication.productSlugs.join(',') };
const { products } = require('../lib/catalog.ts');
const snapshot = { verified: true, products: products.map(product => ({ ...product })) };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent?.filename.endsWith('/lib/commerce.ts') && request === './runtime') return { runtime: () => env, setting: async (key, fallback) => fallback,
    all: async () => { throw new Error('Unexpected database read'); }, one: async () => { throw new Error('Unexpected database read'); } };
  if (parent?.filename.endsWith('/lib/seo.ts')) {
    if (request === './runtime') return { runtime: () => env };
    if (request === 'next/headers') return { headers: async () => new Map([['host', new URL(publication.origin).host]]) };
    if (request === './public-catalog') return { publicCatalog: async () => snapshot };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { seoConfig, sitemapPaths, mayIndex, pageInfo, productReviewBlocks, isPeptideVial } = require('../lib/seo-policy.ts');
const { compounds, comparisons, compoundQuestions, publishedCompound, isPeptideCompound, isPeptideComparison } = require('../lib/compound-reference.ts');
const { eligibleDiscovery, vialName } = require('../lib/product-discovery.ts');
const { routeStructuredData } = require('../lib/seo.ts');
const { StoreProvider } = require('../components/store/provider.tsx');
const { CompoundIndex, CompoundPage, ComparisonPage, VerifyCoa } = require('../components/store/compound-reference.tsx');
const { ProductResearchDetails } = require('../components/store/product-research-details.tsx');
const config = seoConfig(env);
const render = child => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, child));
const productLinks = html => [...new Set([...html.matchAll(/href="\/product\/([^"#?]+)"/g)].map(m => m[1]))];
const disclaimer = 'Biomod does not provide dosing or medical advice.';
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const validCas = cas => { const m = /^(\d{2,7})-(\d\d)-(\d)$/.exec(cas); return Boolean(m) && (m[1] + m[2]).split('').reverse().reduce((s, d, i) => s + (i + 1) * Number(d), 0) % 10 === Number(m[3]); };

(async () => {
  const sitemap = sitemapPaths(config);
  for (const c of compounds) {
    assert(validCas(c.cas), c.slug + ' CAS check digit');
    for (const slug of c.products) assert(products.some(p => p.slug === slug), c.slug + ': ' + slug + ' exists');
    const single = products.find(p => p.slug === c.products[0]);
    assert.equal(single.casNumber, c.cas, c.slug + ': CAS agrees with the catalog listing');
    assert(/^C\d+H\d+/.test(c.formula) && /^\d+(\.\d+)?$/.test(c.weight) && c.cid > 0, c.slug + ' molecular data');
    if (c.sequence && c.residues && !c.sequence.includes('·')) assert.equal((c.sequence.match(/[A-Z][a-z]{2}/g) || []).length, c.residues, c.slug + ' residue count');
    const info = pageInfo('/compounds/' + c.slug);
    assert((info.title + ' | Biomod Research Supply Company').length <= 70, c.slug + ' title fits: ' + info.title);
    assert(info.description.length <= 160 && info.description.endsWith('.'), c.slug + ' description fits and ends on a full sentence: ' + info.description);
    // Peptide wording (owner instruction, November 14, 2026): a compound page says "peptide" exactly when its
    // single-compound vial is titled a peptide vial. NAD+ is a coenzyme and is never called one.
    const peptide = isPeptideCompound(c);
    assert.equal(peptide, isPeptideVial(single), c.slug + ': peptide wording agrees with its product title');
    assert.equal(/\bpeptide\b/i.test(info.description), peptide, c.slug + ' description peptide wording');
    assert(publishedCompound(c), c.slug + ' has a published product');
    assert(mayIndex('/compounds/' + c.slug, new URLSearchParams(), config) && sitemap.includes('/compounds/' + c.slug), c.slug + ' indexed and in the sitemap');

    const html = render(React.createElement(CompoundPage, { slug: c.slug }));
    assert.equal((html.match(/<h1\b/g) || []).length, 1, c.slug + ': one h1');
    assert(html.includes(c.formula) && html.includes(c.cas) && html.includes(c.weight + ' g/mol'), c.slug + ': reference data visible');
    assert(html.includes('https://pubchem.ncbi.nlm.nih.gov/compound/' + c.cid), c.slug + ': PubChem source linked');
    const links = productLinks(html);
    assert(links.length > 0 && links.every(slug => c.products.includes(slug)), c.slug + ': links only its own products');
    assert(links.every(slug => !productReviewBlocks[slug] && publication.productSlugs.includes(slug)), c.slug + ': no held product linked');
    assert(!/dos(e|ing)\b|inject|reconstitut/i.test(text(html).replace(disclaimer, '')), c.slug + ': no dosing or handling wording');
    assert.equal(/<h2[^>]*>[^<]*\bpeptide\b/i.test(html), peptide, c.slug + ': heading peptide wording');
    const asked = compoundQuestions(c, []).find(q => q.question === 'Is ' + c.name + ' a peptide?');
    assert(asked && asked.answer.startsWith(peptide ? 'Yes, ' + c.name + ' is a peptide. ' : 'No. ') && asked.answer.endsWith(c.summary), c.slug + ': peptide question answered from the reviewed summary');
    assert(html.includes('Is ' + c.name.replace(/&/g, '&amp;') + ' a peptide?'), c.slug + ': peptide question visible');

    // Question markup repeats the visible questions and answers.
    const visible = [...html.matchAll(/<h3>([^<]+)<\/h3><p>([^<]+)<\/p>/g)].map(m => text(m[1]).trim());
    const data = await routeStructuredData('/compounds/' + c.slug, config);
    const faq = data['@graph'].find(node => node['@type'] === 'FAQPage');
    assert(faq, c.slug + ' FAQPage');
    assert.deepEqual(faq.mainEntity.map(q => q.name), visible, c.slug + ': FAQPage questions match the page');
    const expected = compoundQuestions(c, c.products.map(slug => products.find(p => p.slug === slug)).filter(eligibleDiscovery).map(vialName));
    assert.deepEqual(faq.mainEntity.map(q => q.acceptedAnswer.text), expected.map(q => q.answer));
    assert(data['@graph'].some(node => node['@type'] === 'BreadcrumbList'), c.slug + ' breadcrumbs');
  }
  // Run & Gun is a blend: it links to the CJC-1295 No DAC reference, which lists it after the single vial.
  assert.deepEqual(compounds.find(c => c.slug === 'cjc-1295-no-dac').products, ['cjc-1295-no-dac-10mg', 'run-gun-10mg']);
  // Sprays and softgels whose catalog identity names a referenced compound are listed under it, after the
  // vial, so the reference page links them and they link back (November 17, 2026). BIONIC holds BPC-157
  // arginate, a different salt, so it is listed under KPV only.
  const formats = { 'aod-9604': ['softgel-chisel-aod-9604'], 'bpc-157': ['forge-bpc-157-spray', 'klow-spray'], epitalon: ['softgel-delta-pinealon-epithalon'],
    'ghk-cu': ['glow-spray', 'klow-spray'], kpv: ['klow-spray', 'softgel-bionic-bpc-157-arginate-kpv-vitamin-e'], nad: ['flux-nad-spray'],
    'pt-141': ['ignite-pt-141-oxy-spray'], selank: ['equil-selank-spray'], semax: ['apex-semax-spray'] };
  for (const [slug, listedFormats] of Object.entries(formats)) {
    const c = compounds.find(x => x.slug === slug);
    assert.deepEqual(c.products.slice(1), listedFormats, slug + ': spray and softgel listings follow the vial');
    for (const productSlug of listedFormats) {
      const p = products.find(x => x.slug === productSlug);
      const identity = p.identity.toLowerCase().replace('epithalon', 'epitalon');
      assert(identity.includes(c.name.toLowerCase()), productSlug + ': catalog identity names ' + c.name + ' (' + p.identity + ')');
      if (!publication.productSlugs.includes(productSlug) || productReviewBlocks[productSlug]) continue;
      assert(productLinks(render(React.createElement(CompoundPage, { slug }))).includes(productSlug), slug + ' reference page links ' + productSlug);
      const back = render(React.createElement(ProductResearchDetails, { product: p }));
      assert(back.includes('href="/compounds/' + compounds.find(x => x.products.includes(productSlug)).slug + '"'), productSlug + ' links back to a compound reference');
    }
  }
  assert(!compounds.find(c => c.slug === 'bpc-157').products.includes('softgel-bionic-bpc-157-arginate-kpv-vitamin-e'), 'BPC-157 arginate is not listed as BPC-157');

  for (const x of comparisons) {
    const info = pageInfo('/compare/' + x.slug);
    assert((info.title + ' | Biomod Research Supply Company').length <= 70, x.slug + ' title fits');
    assert(sitemap.includes('/compare/' + x.slug), x.slug + ' in the sitemap');
    const html = render(React.createElement(ComparisonPage, { slug: x.slug }));
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert(html.includes('href="/compounds/' + x.a + '"') && html.includes('href="/compounds/' + x.b + '"'), x.slug + ' links both references');
    assert(!/dos(e|ing)\b|inject|reconstitut/i.test(text(html).replace(disclaimer, '')), x.slug + ' wording');
    assert(info.description.length <= 160 && info.description.endsWith('Research use only.'), x.slug + ' description fits: ' + info.description);
    assert.equal(/\bpeptides\b/i.test(info.description), isPeptideComparison(x), x.slug + ' description peptide wording');
    assert.equal((html.match(/<h2[^>]*>[^<]*\bpeptide\b/gi) || []).length, [x.a, x.b].filter(slug => isPeptideCompound(compounds.find(c => c.slug === slug))).length, x.slug + ': each peptide heading says so');
  }

  const index = render(React.createElement(CompoundIndex));
  assert.equal((index.match(/<h1\b/g) || []).length, 1);
  assert(/<h1>Peptide and compound reference<\/h1>/.test(index), 'index heading names peptides');
  assert(compounds.filter(c => !isPeptideCompound(c)).map(c => c.slug).join() === 'nad', 'only NAD+ is not a peptide');
  for (const c of compounds) assert(index.includes('href="/compounds/' + c.slug + '"'), 'index links ' + c.slug);
  for (const x of comparisons) assert(index.includes('href="/compare/' + x.slug + '"'), 'index links ' + x.slug);
  const verify = render(React.createElement(VerifyCoa));
  assert(/<label for="verify-lot">/.test(verify) && /<input[^>]+id="verify-lot"/.test(verify), 'lot field is labelled');
  for (const p of ['/compounds', '/verify']) assert(sitemap.includes(p) && mayIndex(p, new URLSearchParams(), config), p + ' indexed');

  // Product pages lead to their reference, and the footer lists the hub and the lot lookup.
  assert(fs.readFileSync(path.join(root, 'components/store/product-research-details.tsx'), 'utf8').includes("'/compounds/' + compound.slug"));
  // Product pages also lead to every published side-by-side page for their compound, and to no other.
  let comparisonProducts = 0;
  for (const product of products.filter(eligibleDiscovery)) {
    const html = render(React.createElement(ProductResearchDetails, { product }));
    const c = compounds.find(x => x.products.includes(product.slug));
    const expected = c && publishedCompound(c) ? comparisons.filter(x => (x.a === c.slug || x.b === c.slug) && publishedCompound(compounds.find(y => y.slug === x.a)) && publishedCompound(compounds.find(y => y.slug === x.b))).map(x => '/compare/' + x.slug).sort() : [];
    const linked = [...new Set([...html.matchAll(/href="(\/compare\/[^"]+)"/g)].map(m => m[1]))].sort();
    assert.deepEqual(linked, expected, product.slug + ': links exactly its published comparisons');
    if (expected.length) comparisonProducts++;
  }
  assert(comparisonProducts >= 8, 'products in published comparison pairs link them (found ' + comparisonProducts + ')');
  const footer = fs.readFileSync(path.join(root, 'components/store/content.tsx'), 'utf8');
  assert(footer.includes('href="/compounds"') && footer.includes('href="/verify"'));
  console.log(`PASS: ${compounds.length} compound references and ${comparisons.length} comparisons agree with the catalog CAS, fit the result line, are in the sitemap, render one h1 with only published product links, and their FAQPage matches the visible questions; lot lookup and hub indexed`);
})().catch(error => { console.error(error); process.exit(1); });
