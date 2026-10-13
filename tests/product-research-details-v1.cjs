/* Real SSR integration with isolated catalog fixtures. No network, database or orders. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.css'] = module => { module.exports = new Proxy({ __esModule: true }, { get: (target, key) => key === '__esModule' ? true : key === 'default' ? new Proxy({}, { get: (_, name) => String(name) }) : String(key) }); };

const { products, money } = require('../lib/catalog.ts');
const { packContents, packSizes } = require('../lib/packs.ts');
const { eligibleDiscovery } = require('../lib/product-discovery.ts');
const { productReviewBlocks } = require('../lib/seo-policy.ts');
const { batchFor, batchPath, batchRecords, batchStatus, batchStatusLabel, certificateFor, matchingCertificateFor, laboratoryDocuments } = require('../lib/testing.ts');
const { VialSizeLinks, ProductResearchDetails } = require('../components/store/product-research-details.tsx');
const { ProductPage, ProductCard } = require('../components/store/catalog.tsx');
const { Experience } = require('../components/store/experience.tsx');
const { StoreProvider } = require('../components/store/provider.tsx');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const asText = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const before = JSON.stringify(products);
const documentsBefore = JSON.stringify({ batchRecords, laboratoryDocuments });
const statusesBefore = batchRecords.map(record => [record.record_id, batchStatus(record)]);
const ten = products.find(product => product.slug === 'mots-c-10mg');
const forty = products.find(product => product.slug === 'mots-c-40mg');
assert(ten && forty);
assert.equal(batchStatus(batchFor(ten.id)), 'matched');
assert.equal(batchStatus(batchFor(forty.id)), 'pending');

// Deliberately differ from saved values to prove that the live provider catalog
// controls displayed prices/stock rather than a statically imported price list.
const fixture = products.map(product => product.id === ten.id ? { ...product, price: 4321, inStock: false } : product.id === forty.id ? { ...product, price: 12345, inStock: true, purchasable: true, stockQuantity: 8 } : product);
const currentForty = fixture.find(product => product.id === forty.id);
const sizeHTML = render(VialSizeLinks, { product: currentForty, products: fixture });
const items = [...sizeHTML.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => match[1]);
assert.equal(items.length, 2);
assert(items[0].includes('href="/product/mots-c-10mg"') && items[0].includes('10 mg') && items[0].includes('Out of stock'));
assert(items[1].includes('href="/product/mots-c-40mg" aria-current="page"') && items[1].includes('40 mg') && items[1].includes('In stock'));
assert(!sizeHTML.includes('$') && !sizeHTML.includes('/testing'), 'compact navigation leaves the price and documents to the selected product');
assert.equal((sizeHTML.match(/aria-current="page"/g) || []).length, 1);
assert(!sizeHTML.includes('.pdf'), 'size navigation does not reuse a sibling certificate');
assert.equal(render(VialSizeLinks, { product: ten, products: fixture.filter(product => product.id !== forty.id) }), '', 'partial families are not guessed');
const held = products.find(product => product.slug === 'tb500-10mg');
assert.equal(render(VialSizeLinks, { product: held, products }), '');

let eligibleCount = 0;
for (const product of products) {
  const html = render(ProductResearchDetails, { product });
  if (!eligibleDiscovery(product)) {
    assert.equal(html, '', product.slug + ': held/unreviewed items receive no new FAQ promotion');
    continue;
  }
  eligibleCount++;
  assert.equal((html.match(/<h3\b/g) || []).length, 2);
  assert(html.includes(escape(product.name)) && html.includes(escape(packContents(product))));
  if (product.sku) assert(html.includes(escape(product.sku)));
  assert(asText(html).includes('Pack sizes of ' + packSizes.slice(0, -1).join(', ') + ' or ' + packSizes.at(-1) + ' count complete vials.'));
  assert(html.includes('href="/testing?product=' + product.id + '"'));
  assert(html.includes('href="/quality-standard#read-the-results"'));
  assert(!/<(?:button|details|script)\b|\bhidden=|aria-hidden=/.test(html), 'answers remain readable in initial HTML');
  const status = batchStatus(batchFor(product.id));
  if (status === 'matched') assert(html.includes('lot number matching this listing'));
  else assert(html.includes('Contact BIOMOD to request the COA for the listed lot.') && !html.includes('lot number matching this listing'));
}
assert.equal(eligibleCount, 17);

const expectedStudies = {
  'semax': ['Semax research context', 'https://link.springer.com/article/10.1186/1471-2164-15-228', '10.1186/1471-2164-15-228'],
  'selank': ['Selank research context', 'https://www.frontiersin.org/journals/pharmacology/articles/10.3389/fphar.2016.00031/full', '10.3389/fphar.2016.00031'],
  'aod-9604-10mg': ['AOD-9604 research context', 'https://pubmed.ncbi.nlm.nih.gov/25208511/', '10.1002/dta.1715'],
  'tesamorelin-10mg': ['Tesamorelin research context', 'https://pubmed.ncbi.nlm.nih.gov/17214611/', '10.1111/j.1742-7843.2007.00008.x'],
  'nad-500mg': ['NAD+ research context', 'https://pubmed.ncbi.nlm.nih.gov/28497978/', '10.1089/ars.2017.7014'],
  'kisspeptin-10mg': ['Kisspeptin-10 research context', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5419131/', '10.1210/me.2009-0013'],
  'pt-141-10mg': ['PT-141 research context', 'https://pubmed.ncbi.nlm.nih.gov/15226502/', '10.1073/pnas.0400491101'],
  'kpv-10mg': ['KPV research context', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2431115/', '10.1053/j.gastro.2007.10.026'],
  'epitalon-50mg': ['Epitalon research context', 'https://pubmed.ncbi.nlm.nih.gov/12937682/', '10.1023/a:1025493705728'],
  'dsip-10mg': ['DSIP research context', 'https://pubmed.ncbi.nlm.nih.gov/265572/', '10.1073/pnas.74.3.1282'],
  'glutathione-reduced-l-glutathione': ['Reduced glutathione research context', 'https://pubmed.ncbi.nlm.nih.gov/11419750/', '10.1016/s0378-4347(01)00081-0'],
  'thymosin-alpha-1-10mg': ['Thymosin Alpha-1 research context', 'https://pubmed.ncbi.nlm.nih.gov/265536/', '10.1073/pnas.74.2.725'],
  'bpc-157-10mg': ['BPC-157 research context', 'https://pubmed.ncbi.nlm.nih.gov/25415472/', '10.3390/molecules191119066'],
  'mots-c-10mg': ['MOTS-c research context', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4350682/', '10.1016/j.cmet.2015.02.009'],
  'mots-c-40mg': ['MOTS-c research context', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4350682/', '10.1016/j.cmet.2015.02.009'],
  'ss-31-10mg': ['SS-31 research context', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3976619/', '10.1111/bph.12468'],
  'ss-31-50mg': ['SS-31 research context', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3976619/', '10.1111/bph.12468'],
};
const researchSection = html => html.match(/<section class="research" aria-labelledby="product-research-heading">[\s\S]*?<\/section>/)?.[0];
const researchedSlugs = [];
for (const product of products) {
  const html = render(ProductResearchDetails, { product });
  const context = researchSection(html);
  const expected = expectedStudies[product.slug];
  if (!expected) {
    assert.equal(context, undefined, product.slug + ': unrelated or held products receive no molecule research section');
    continue;
  }
  researchedSlugs.push(product.slug);
  assert(eligibleDiscovery(product));
  assert(context?.includes('<h2 id="product-research-heading">' + expected[0] + '</h2>'));
  assert(context.includes('href="' + expected[1] + '"') && context.includes('DOI: ' + expected[2]), 'The primary citation and DOI are visible in initial HTML');
  assert.deepEqual([...context.matchAll(/<a href="(https:\/\/[^"]+)"/g)].map(match => match[1]), [expected[1]], product.slug + ': the research section cites only its own reviewed primary source');
  const materialLabel = ['glutathione-reduced-l-glutathione', 'thymosin-alpha-1-10mg', 'aod-9604-10mg', 'nad-500mg'].includes(product.slug) ? 'Study material' : 'Models studied';
  assert(context.includes('<dt>' + materialLabel + '</dt>') && context.includes('<dt>Study focus</dt>'));
  assert(context.includes('does not verify a BIOMOD batch or establish suitability for human use'));
  assert(context.includes('href="' + escape(batchPath(batchFor(product.id))) + '"'), 'The context links to this product record, including a pending record, rather than a sibling COA');
  assert(!/<(?:button|details|script)\b|\bhidden=|aria-hidden=|\.pdf|FAQPage|MedicalEntity|MedicalStudy/.test(context), 'Research copy is visible without adding medical markup or a substituted document');
  assert(!/\b(?:dosage|dose|benefit|treats|cures|clinically proven|absorption|purity|acetate)\b/i.test(context), 'Research context makes no product efficacy, dosing, salt or purity claim');
  assert(html.indexOf('product-questions-heading') < html.indexOf('product-research-heading'), 'Research context follows the existing questions');
  if (['epitalon-50mg', 'dsip-10mg'].includes(product.slug)) {
    assert(!/\b(?:human treatment|human clinical trial|patients?|therapeutic|recommended|anti[- ]?aging|rejuvenation|insomnia|sleep aid|sleep quality|life extension|extends? lifespan|injectable)\b/i.test(context), 'Epitalon and DSIP literature is not presented as a human treatment or product benefit');
    assert(!context.includes('manufactured') && !context.includes('manufacturing origin') && !context.includes('amino-acid sequence'), 'No manufacturing, sequence, or origin is inferred for either product');
  }
  if (product.slug === 'semax') {
    assert(context.includes('synthetic seven-amino-acid peptide') && context.includes('Medvedeva'));
    assert(context.includes('Rats following experimental focal ischemia') && context.includes('frontoparietal cortex'));
    assert(context.includes('Transcript levels') && context.includes('immune and vascular processes'));
  } else if (product.slug === 'selank') {
    assert(context.includes('seven-amino-acid peptide related to tuftsin') && context.includes('Selank or GABA'));
    assert(context.includes('Rat frontal cortex') && context.includes('samples pooled by experimental group and time point'));
    assert(context.includes('targeted real-time PCR panel') && context.includes('do not establish direct receptor binding'));
  } else if (product.slug === 'aod-9604-10mg') {
    assert(context.includes('AOD9604 as a modified C-terminal fragment') && context.includes('residues 177–191 with an added N-terminal tyrosine'));
    assert(context.includes('Urine for analytical detection') && context.includes('serum and urine used for in-vitro metabolism experiments'));
    assert(context.includes('identification of metabolites') && context.includes('not the method used for the BIOMOD certificate'));
  } else if (product.slug === 'tesamorelin-10mg') {
    assert(context.includes('tesamorelin as TH9507') && context.includes('modified 44-residue growth hormone-releasing factor analogue'));
    assert(context.includes('Rat, dog and human plasma') && context.includes('animal experiments in pigs, rats and dogs'));
    assert(context.includes('plasma stability, GH and IGF-1 biomarkers') && context.includes('adverse findings in dogs under its experimental conditions'));
  } else if (product.slug === 'nad-500mg') {
    assert(context.includes('NAD+ and NADH are the oxidized and reduced forms') && !/\bpeptide\b/i.test(context), 'NAD+ is a redox cofactor, not a peptide or an interchangeable NADH product');
    assert(context.includes('Cultured mammalian cells and mouse tissues.') && context.includes('LC-MS measurement'));
    assert(context.includes('changes between oxidized and reduced forms during extraction') && context.includes('does not establish the test method used for a BIOMOD lot'));
  } else if (product.slug === 'kisspeptin-10mg') {
    assert(context.includes('Kisspeptin-10 is the peptide name in this catalog; 10 mg is the listed vial content.'), 'Peptide identity and vial mass remain separate');
    assert(context.includes('HEK 293 and genetically modified MDA-MB-231 cell cultures.'));
    assert(context.includes('Receptor internalization and desensitization') && context.includes('GRK2, beta-arrestin and ERK1/2'));
  } else if (product.slug === 'pt-141-10mg') {
    assert(context.includes('PT-141, a synthetic alpha-MSH analogue'));
    assert(context.includes('Female rats under defined estrogen and progesterone conditions.'));
    assert(context.includes('solicitation, lordosis and pacing') && context.includes('locomotor activity and conditioned place preference'));
  } else if (product.slug === 'kpv-10mg') {
    assert(context.includes('KPV is the tripeptide Lys-Pro-Val.'));
    assert(context.includes('Intestinal epithelial cell cultures, Jurkat T cells and mouse models of intestinal inflammation.'));
    assert(context.includes('PepT1-mediated uptake, NF-κB and MAPK signaling'));
  } else if (product.slug === 'epitalon-50mg') {
    assert(context.includes('Khavinson and colleagues examined the peptide Epithalon in a 2003 cell-culture study.'));
    assert(context.includes('Cultured human fetal fibroblasts.'));
    assert(context.includes('Telomerase activity, expression of its catalytic subunit, and telomere length.'));
    assert(context.includes('This cell-culture study was not a clinical trial.'));
    assert(!context.includes('265572') && !context.includes('Rabbits') && !context.includes('electroencephalogram'), 'Epitalon receives only its own cell-culture study');
  } else if (product.slug === 'dsip-10mg') {
    assert(context.includes('DSIP is described in research literature as a nine-amino-acid peptide.'));
    assert(context.includes('Rabbits, with comparisons of synthetic DSIP and related peptides.'));
    assert(context.includes('Peptide characterization and comparison of delta and spindle electroencephalogram (EEG) patterns.'));
    assert(!context.includes('12937682') && !context.includes('Telomerase') && !context.includes('human fetal'), 'DSIP receives only its own rabbit study');
  } else if (product.slug === 'glutathione-reduced-l-glutathione') {
    assert(context.includes('Reduced glutathione (GSH) and oxidized glutathione (GSSG) are distinct forms.'));
    assert(context.includes('Collected human blood-cell samples: peripheral blood mononuclear cells.'));
    assert(context.includes('Simultaneous measurement of GSH and GSSG') && context.includes('(LC-MS)'));
    assert(context.includes('analytical method is separate from the method reported on the product certificate'));
    assert(!context.includes('265536') && !context.includes('calf thymus'));
  } else if (product.slug === 'thymosin-alpha-1-10mg') {
    assert(context.includes('28-amino-acid peptide') && context.includes('1977 sequence study'));
    assert(context.includes('Peptide material isolated from calf thymus'));
    assert(context.includes('Isolation and amino-acid sequence analysis.'));
    assert(context.includes('does not establish this product&#x27;s manufacturing origin'));
    assert(!context.includes('11419750') && !context.includes('LC-MS'));
  } else if (product.slug === 'bpc-157-10mg') {
    assert(context.includes('BPC-157 is described in research literature as a 15-amino-acid peptide.'));
    assert(context.includes('Tendon fibroblasts cultured from rat Achilles tendon.'));
    assert(context.includes('Growth-hormone-receptor expression and related cell signaling.'));
    assert(context.includes('Chang et al. (2014), Molecules'));
    assert(!context.includes('AMPK') && !context.includes('cardiolipin') && !context.includes('PMC4350682') && !context.includes('PMC3976619'), 'BPC-157 receives only its own research source');
  } else if (product.slug.startsWith('mots-c')) {
    assert(context.includes('16-amino-acid, mitochondrial-derived peptide') && context.includes('2015'));
    assert(context.includes('Cultured cells and mice.') && context.includes('Folate and purine metabolism') && context.includes('AMPK-related signaling'));
    assert(!context.includes('cardiolipin') && !context.includes('PMC3976619') && !context.includes('25415472'), 'MOTS-c receives only its own research source');
  } else if (['ss-31-10mg', 'ss-31-50mg'].includes(product.slug)) {
    assert(context.includes('four-amino-acid peptide') && context.includes('2014'));
    assert(context.includes('Artificial lipid membranes and mitochondria isolated from rat kidneys.'));
    for (const topic of ['cardiolipin', 'electron transfer', 'oxygen consumption', 'ATP synthesis']) assert(context.includes(topic));
    assert(!context.includes('AMPK') && !context.includes('PMC4350682') && !context.includes('25415472'), 'SS-31 receives only its own research source');
  }
}
assert.deepEqual(researchedSlugs.sort(), Object.keys(expectedStudies).sort(), 'Exactly 17 current eligible pages receive literature context');
assert.equal(render(ProductResearchDetails, { product: { ...ten, slug: 'mots-c-unreviewed-size' } }), '', 'Unknown sizes do not inherit a name-based research mapping');
const bpc157 = products.find(product => product.slug === 'bpc-157-10mg');
assert(bpc157);
assert.equal(render(ProductResearchDetails, { product: { ...bpc157, slug: 'bpc-157-unreviewed-size' } }), '', 'The BPC-157 context cannot promote an unreviewed size');
for (const slug of Object.keys(expectedStudies)) {
  const product = products.find(product => product.slug === slug);
  assert(product && eligibleDiscovery(product));
  assert.equal(render(ProductResearchDetails, { product: { ...product, slug: slug + '-unreviewed-size' } }), '', slug + ': an unreviewed size cannot inherit research context');
}
for (const slug of Object.keys(expectedStudies)) {
  const previous = productReviewBlocks[slug];
  try {
    productReviewBlocks[slug] = 'Temporary test hold';
    assert.equal(render(ProductResearchDetails, { product: products.find(product => product.slug === slug) }), '', 'A later publication hold excludes both questions and research context');
  } finally {
    if (previous === undefined) delete productReviewBlocks[slug];
    else productReviewBlocks[slug] = previous;
  }
}

const renderPage = (slug, catalog = products) => renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: catalog }, React.createElement(ProductPage, { slug })));
// Literature does not reconcile lots. Tesamorelin separately has a reviewed original matching-lot report; other gaps remain unchanged.
const remainingBatchEvidence = {
  'semax': [788, 'pending', 'LYO-029-2608-01', '001-R'],
  'selank': [785, 'pending', 'LYO-028-2608-02', '001-b'],
  'aod-9604-10mg': [758, 'matched', '406-10-0001', '406-10-0001'],
  'tesamorelin-10mg': [755, 'matched', '301-10-0001', '301-10-0001'],
  'nad-500mg': [752, 'pending', '405-500-0001', '001-B'],
  'kisspeptin-10mg': [751, 'matched', '404-10-0001', '404-10-0001'],
  'pt-141-10mg': [750, 'matched', '403-10-0001', '403-10-0001'],
  'kpv-10mg': [749, 'pending', '402-10-0001', null],
};
for (const [slug, [heading, source]] of Object.entries(expectedStudies)) {
  const html = renderPage(slug);
  const context = researchSection(html);
  assert(context?.includes(heading) && context.includes('href="' + source + '"'), slug + ': actual product SSR includes the visible primary study');
  assert(html.indexOf('product-questions-heading') < html.indexOf('product-research-heading'));
  assert(html.indexOf('product-research-heading') < html.indexOf('product-tabs'), 'Research context follows questions without reordering purchase/specification controls');
  const current = products.find(product => product.slug === slug);
  const currentRecord = batchFor(current.id);
  assert(context.includes('href="' + escape(batchPath(currentRecord)) + '"'), slug + ': actual page links to its own current batch record');
  assert(html.includes(escape(current.name)) && html.includes(money(current.price)) && html.includes('Pack size'), slug + ': name, current price and pack controls are preserved');
  const currentPassport = html.match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
  assert(currentPassport?.includes(escape(batchStatusLabel(currentRecord))), slug + ': the actual page retains its own certificate status');
  const evidence = remainingBatchEvidence[slug];
  if (evidence) {
    assert.deepEqual([current.id, batchStatus(currentRecord), currentRecord.product_lot, currentRecord.certificate_lot], evidence, slug + ': existing lot evidence is unchanged');
    assert(currentPassport.includes('<dt>Listed product lot</dt><dd>' + escape(evidence[2]) + '</dd>'));
    const certificate = matchingCertificateFor(currentRecord);
    assert(currentPassport.includes('<dt>Certificate lot</dt><dd>' + escape(certificate?.batch_number || 'Not listed') + '</dd>'));
    if (certificate) assert(currentPassport.includes('href="' + escape(certificate.url) + '"'), slug + ': original PDF remains attached only to its own record');
    else assert(!currentPassport.includes('.pdf'), slug + ': pending evidence never borrows a certificate');
    if (evidence[1] !== 'matched') {
      assert(currentPassport.includes('Not verified for this lot') && !currentPassport.includes('Matching-lot certificate'), slug + ': literature does not validate the listed lot');
    }
  }
}
const productHTML = renderPage(forty.slug, fixture);
assert(productHTML.includes(sizeHTML), 'actual product route includes live size navigation');
assert(productHTML.indexOf('other-vial-sizes-heading') < productHTML.indexOf('class="detail-price"'), 'choose the vial size before reading the selected price');
assert(productHTML.includes('$123.45'), 'selected product price comes from live catalog');
const passport = productHTML.match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
assert(passport?.includes('Documentation pending') && !passport.includes('Matching-lot certificate') && !passport.includes('.pdf'), '40mg retains its own documentation; never borrows the10mg COA');
const tenPassport = renderPage(ten.slug, fixture).match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
assert(tenPassport?.includes('Matching-lot certificate') && tenPassport.includes('MOTS-C_10-mg.pdf'), '10mg keeps its original matching report');
const ssTen = products.find(product => product.slug === 'ss-31-10mg');
const ssFifty = products.find(product => product.slug === 'ss-31-50mg');
assert(ssTen && ssFifty);
assert.equal(batchStatus(batchFor(ssTen.id)), 'matched');
assert.equal(batchStatus(batchFor(ssFifty.id)), 'pending');
for (const current of [ssTen, ssFifty]) {
  const sizeNav = render(VialSizeLinks, { product: current, products });
  assert(sizeNav.includes('href="/product/ss-31-10mg"') && sizeNav.includes('href="/product/ss-31-50mg"'));
  assert(sizeNav.includes('href="/product/' + current.slug + '" aria-current="page"'));
  assert(!sizeNav.includes('$') && !sizeNav.includes('.pdf'), 'SS-31 size navigation keeps selected-price and batch details separate');
  const currentPage = renderPage(current.slug);
  assert(currentPage.includes(sizeNav), 'Actual SS-31 product page includes both confirmed sizes');
  assert(currentPage.indexOf('other-vial-sizes-heading') < currentPage.indexOf('class="detail-price"'));
  assert(currentPage.includes(money(current.price)), 'SS-31 page retains its own price');
}
const ssTenPassport = renderPage(ssTen.slug).match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
const ssFiftyPassport = renderPage(ssFifty.slug).match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
assert(ssTenPassport?.includes('Matching-lot certificate') && ssTenPassport.includes('SS-31_10-mg.pdf'), 'SS-31 10 mg retains its own matching COA');
assert(ssFiftyPassport?.includes('Documentation pending') && !ssFiftyPassport.includes('.pdf') && !ssFiftyPassport.includes('408-10-0001'), 'SS-31 50 mg cannot inherit the 10 mg certificate or lot');
for (const slugs of [['wolverine-10mg', 'wolverine-20mg'], ['heat-r-20mg', 'heat-r-30mg']]) {
  for (const slug of slugs) {
    const current = products.find(product => product.slug === slug);
    assert(current, slug + ': listing exists');
    const currentPage = renderPage(slug);
    const sizeNav = render(VialSizeLinks, { product: current, products });
    assert(currentPage.includes(sizeNav) && sizeNav.includes('other-vial-sizes-heading'), slug + ': actual product page includes explicit sibling browsing');
    for (const sibling of slugs) assert(sizeNav.includes('href="/product/' + sibling + '"'));
    assert(sizeNav.includes('href="/product/' + slug + '" aria-current="page"'));
    assert(!sizeNav.includes('.pdf') && !sizeNav.includes('$'), 'Size navigation does not reuse price or testing evidence');
    assert(!currentPage.includes('product-questions-heading'), slug + ': browsing does not enable organic FAQ promotion');
    assert(currentPage.includes(money(current.price)), slug + ': each selected listing keeps its own price');
  }
}
const wolverineTwenty = products.find(product => product.slug === 'wolverine-20mg');
assert.equal(wolverineTwenty.purchasable, false, 'Wolverine 20 mg cannot be purchased before the current batch is confirmed');
assert.equal(wolverineTwenty.inStock, false);
assert.equal(wolverineTwenty.stockQuantity, null, 'Unavailable listing invents no stock count');
const wolverineHTML = renderPage(wolverineTwenty.slug);
assert(wolverineHTML.includes('<h1>Wolverine 20 mg</h1>'));
assert(wolverineHTML.includes(wolverineTwenty.availabilityLabel));
const detailAddButton = wolverineHTML.match(/<button class="button button-gold"[^>]*>([\s\S]*?)<\/button>/)?.[0];
assert(detailAddButton?.includes('disabled=""') && detailAddButton.includes(wolverineTwenty.availabilityLabel), 'The unavailable size has an honest disabled purchase CTA');
const wolverinePassport = wolverineHTML.match(/<section class="batch-passport">([\s\S]*?)<\/section>/)?.[1];
assert(wolverinePassport && !wolverinePassport.includes('.pdf'), 'No sibling or historical certificate is assigned to the new unavailable size');
const shopHTML = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(Experience, { path: 'shop', query: {} })));
const shopCards = [...shopHTML.matchAll(/<article class="product-card">([\s\S]*?)<\/article>/g)].map(match => match[1]);
for (const slugs of [['ss-31-10mg', 'ss-31-50mg'], ['wolverine-10mg', 'wolverine-20mg'], ['heat-r-20mg', 'heat-r-30mg']]) {
  for (const slug of slugs) {
    const product = products.find(product => product.slug === slug);
    const sibling = slugs.find(candidate => candidate !== slug);
    const card = shopCards.find(html => html.includes('<h3><a href="/product/' + slug + '">'));
    assert(card, slug + ': shop shows a separate card');
    const title = product.name.replace(/\s+\d+(?:\.\d+)?\s*mg$/i, '') + ' ' + packContents(product).replace(/(\d)\s*mg\b/gi, '$1 mg');
    assert(card.includes('<h3><a href="/product/' + slug + '">' + escape(title) + '</a></h3>'), slug + ': card title states its actual strength');
    assert(card.includes('class="card-other-size" href="/product/' + sibling + '"'), slug + ': shop links directly to the other strength');
    assert(card.includes(money(product.price)), slug + ': shop preserves the independent price');
  }
}
for (const [query, expected] of [
  ['GSH1500mg', ['glutathione-reduced-l-glutathione']],
  ['GSH500mg', []], ['GSSG', []], ['oxidized glutathione', []],
  ['ss31', ['ss-31-10mg', 'ss-31-50mg']],
  ['wolverine', ['wolverine-10mg', 'wolverine-20mg']],
  ['heat-r', ['heat-r-20mg', 'heat-r-30mg']],
  ['ss31 50mg', ['ss-31-50mg']],
  ['wolverine 20mg', ['wolverine-20mg']],
  ['heat-r 30mg', ['heat-r-30mg']],
]) {
  const results = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(Experience, { path: 'shop', query: { q: query } })));
  const listedSlugs = [...results.matchAll(/<h3><a href="\/product\/([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(listedSlugs.sort(), expected.sort(), query + ': the actual shop search finds exact sizes without substituting a different strength');
}
const bundleCard = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(ProductCard, { product: ssTen, onAdd: () => {} })));
assert(!bundleCard.includes('card-other-size'), 'Bundle selection cards keep their existing interaction and do not gain size links');
assert(productHTML.indexOf('class="product-specifications"') < productHTML.indexOf('product-questions-heading'), 'questions follow specifications');
assert(productHTML.includes('Add to cart') && productHTML.includes('Pack size'), 'existing purchase controls remain');
const relatedHTML = productHTML.match(/<section class="related">([\s\S]*?)<\/section>/)?.[1];
assert(relatedHTML?.includes('/product/mots-c-10mg'), 'related products include the actual same-compound sibling');
for (const [, slug] of relatedHTML.matchAll(/href="\/product\/([^"]+)"/g)) assert(eligibleDiscovery(products.find(product => product.slug === slug)), 'research recommendations remain publication-eligible');
const softgel = products.find(product => product.categories[0]?.slug === 'softgels');
const softgelHTML = renderPage(softgel.slug);
assert(!softgelHTML.includes('product-questions-heading') && !softgelHTML.includes('other-vial-sizes-heading'));
const softgelRelated = softgelHTML.match(/<section class="related">([\s\S]*?)<\/section>/)?.[1];
const expectedSoftgelSlugs = products.filter(product => product.id !== softgel.id && product.categories[0]?.slug === 'softgels').slice(0, 3).map(product => product.slug);
assert.deepEqual([...new Set([...softgelRelated.matchAll(/href="\/product\/([^"]+)"/g)].map(match => match[1]))], expectedSoftgelSlugs, 'existing nonresearch recommendation order is preserved');
for (const [query, heading] of [[{}, 'Research peptides &amp; compounds'], [{ category: 'softgels' }, 'Softgels'], [{ category: 'spray-products' }, 'Nasal &amp; spray products'], [{ q: 'MOTS' }, 'The BIOMOD collection.']]) {
  const html = renderToStaticMarkup(React.createElement(StoreProvider, { initialCatalog: products }, React.createElement(Experience, { path: 'shop', query })));
  assert(html.includes('<h1>' + heading + '</h1>'), 'full shop route heading reflects current query/category');
}
assert.equal(JSON.stringify(products), before, 'rendering never mutates source product identity, price, inventory or contents');
assert.equal(JSON.stringify({ batchRecords, laboratoryDocuments }), documentsBefore, 'Literature context does not rewrite lot records or laboratory documents');
assert.deepEqual(batchRecords.map(record => [record.record_id, batchStatus(record)]), statusesBefore, 'All current matched, mismatched, pending and restricted documentation states are unchanged');
console.log('PASS: real ProductPage and Experience SSR preserve current purchase controls; compact size navigation, live selected price/stock and independent COA states;17 factual FAQs only; all 17 exact eligible pages have visible primary research context and study limits; six explicit shop variants with reciprocal size links and unavailable W20 purchase controls; eligible research links; unchanged nonresearch links and accurate shop headings');
