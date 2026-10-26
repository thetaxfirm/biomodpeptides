/* Every CAS number shown for a product or its batch record is a well-formed registry
 * number (check digit), the corrected identifiers stay corrected, and customer-facing
 * product text says Oxy, not oxytocin (owner, October 26, 2026). Source data only. */
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

// URLs and image filenames keep their existing slug so links and lot records still resolve.
const shown = [...catalog.flatMap(p => [p.name, p.identity, p.description, p.shortDescription, p.image?.alt]),
  ...Object.values(editorial).flatMap(p => [p.identity, p.description]),
  ...records.flatMap(r => [r.public_identity, JSON.stringify(r.product_facts || {})])];
for (const text of shown) assert(!/oxytocin/i.test(String(text || '')), String(text));
assert.equal(bySlug['ignite-pt-141-oxytocin-spray'].identity, 'PT-141 + Oxy');
console.log('PASS: every product and batch CAS has a valid check digit, GHK-Cu uses the copper-complex number, corrected identifiers hold, and product text says Oxy.');
