/* Product meta descriptions never repeat the product name as its own alias and never nest
 * parentheses ("SEMAX 10mg (Semax (ACTH 4–10 analog))"). No network, credentials or data writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { products } = require('../lib/catalog.ts');
const { pageInfo, descriptionAliases } = require('../lib/seo-policy.ts');
const describe = slug => pageInfo('/product/' + slug).description;

assert.match(describe('semax'), /^Buy SEMAX 10mg \(ACTH 4–10 analog\): single vials/);
assert.match(describe('selank'), /^Buy SELANK 10mg: single vials/);
assert.match(describe('tesamorelin-10mg'), /^Buy Tesamorelin 10mg: single vials/);
// Real aliases and search spellings are kept, in their existing order.
assert.match(describe('mots-c-10mg'), /^Buy MOTS-c 10mg \(MOTSc, MOTS c\): /);
assert.match(describe('mots-c-40mg'), /^Buy MOTS-C 40mg \(MOTSc, MOTS c\): /);
assert.match(describe('pt-141-10mg'), /^Buy PT-141 10mg \(Bremelanotide, PT141, PT 141\): /);
assert.match(describe('aod-9604-10mg'), /^Buy AOD 9604 10mg \(Fragment 176-191, AOD-9604, AOD9604\): /);
assert.match(describe('nad-500mg'), /^Buy NAD\+ 500mg \(Nicotinamide Adenine Dinucleotide\): /);
assert.match(describe('run-gun-10mg'), /^Buy Run & Gun 10mg \(Ipamorelin \+ CJC-1295 No DAC\): /);
// A compound qualifier that is not the product name stays whole (e.g. "Oxy (oxytocin)").
assert(descriptionAliases(products.find(p => p.slug === 'ignite-pt-141-oxy-spray')).includes('PT-141 + Oxy (oxytocin)'));

for (const p of products) {
  const description = describe(p.slug);
  if (!description.startsWith('Buy ')) continue;
  const aliases = descriptionAliases(p);
  const own = [p.name, p.name.replace(/\s+\d+(?:\.\d+)?\s*mg$/i, '')].map(n => n.toLowerCase());
  for (const alias of aliases) assert(!own.includes(alias.toLowerCase()), p.slug + ' repeats its own name: ' + alias);
  assert.equal(new Set(aliases.map(a => a.toLowerCase())).size, aliases.length, p.slug + ' repeats an alias');
  const head = description.slice(0, description.indexOf(': single vials'));
  if (!aliases.some(a => a.includes('('))) assert(!/\([^()]*\(/.test(head), p.slug + ' nests parentheses: ' + head);
  if (!aliases.length) assert(!head.includes('('), p.slug + ' shows empty parentheses');
}
console.log('description aliases v1: ok');
