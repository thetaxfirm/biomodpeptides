/* Every CAS number shown for a product or its batch record is a well-formed registry
 * number (check digit), the corrected identifiers stay corrected, and customer-facing
 * Oxy alias retains the scientific ingredient identity. Source data only. */
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = require(path.join(root, 'lib/catalog-facts-v2.json'));
const editorial = require(path.join(root, 'lib/product-editorial-v1.json')).products;
const coas = require(path.join(root, 'lib/coas-source-v1.json'));

const valid = cas => { const m = /^(\d{2,7})-(\d\d)-(\d)$/.exec(cas); if (!m) return false;
  const digits = (m[1] + m[2]).split('').reverse(); return digits.reduce((sum, d, i) => sum + (i + 1) * Number(d), 0) % 10 === Number(m[3]); };
const split = value => String(value || "").split("/").map(s => s.trim()).filter(s => s && !/pending/i.test(s));

// Lipo-C's listed methionine/choline numbers are invalid. Its CAS is hidden behind the
// specification hold until the supplier's formula sheet arrives; nothing is guessed.
const pendingFormula = new Set(['lipo-c-w-b12']);
const holds = require(path.join(root, 'lib/product-specification-review-v1.json'));
for (const slug of pendingFormula) assert(holds[slug], slug + ' stays on specification hold');
for (const p of catalog) if (!pendingFormula.has(p.slug)) for (const cas of split(p.casNumber)) assert(valid(cas), `${p.slug} CAS ${cas}`);
const records = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.product_slug) records.push(o); Object.values(o).forEach(walk); } })(coas);
assert(records.length > 40, 'batch records found');
for (const r of records) if (!pendingFormula.has(r.product_slug)) for (const cas of split(r.cas)) assert(valid(cas), `${r.product_slug} batch CAS ${cas}`);

// GHK-Cu is the copper complex (89030-95-5), never copper-free GHK (49557-75-7).
const bySlug = Object.fromEntries(catalog.map(p => [p.slug, p]));
for (const p of catalog) if (/GHK-Cu/.test(p.identity)) assert(!split(p.casNumber).includes('49557-75-7'), p.slug);
for (const [slug, cas] of Object.entries({
  'glow-spray': '89030-95-5', 'ghk-cu-50mg': '89030-95-5', 'softgel-eraser-tesofensine': '195875-84-4', 'slu-pp-332': '303760-60-3',
  'softgel-delta-pinealon-epithalon': '175175-23-2 / 307297-39-8', 'softgel-lumen-ghk-cu-ahk-cu-astaxanthin-vitamin-e': '89030-95-5 / 682809-81-0 / 472-61-7',
  'noctis-blend-spray': '175175-23-2 / 129954-34-3 / 62568-57-4 / 50-56-6 / 73-31-4',
})) assert.equal(bySlug[slug].casNumber, cas, slug);

// Preserve the owner-selected Oxy alias without obscuring the scientific ingredient.
// CAS 50-56-6 is oxytocin: https://www.ncbi.nlm.nih.gov/mesh/68010121
// URLs, image filenames and original laboratory PDFs remain untouched.
for (const slug of ['ignite-pt-141-oxy-spray', 'noctis-blend-spray']) {
  const p = bySlug[slug], r = records.find(record => record.product_slug === slug);
  assert(r, slug + ' batch metadata');
  for (const text of [p.identity, p.description, p.shortDescription, editorial[slug].identity,
    editorial[slug].description, r.public_identity, r.product_facts['Active Compound']]) {
    assert.match(text, /Oxy \(oxytocin\)/, slug + ' identifies the alias');
  }
  assert(split(p.casNumber).includes('50-56-6'));
  assert(split(r.cas).includes('50-56-6'));
}
console.log('PASS: CAS check digits and corrected identifiers; Oxy alias and scientific identity agree across catalog, editorial and batch metadata.');
