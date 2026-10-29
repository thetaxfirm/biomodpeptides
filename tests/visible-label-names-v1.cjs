/* Controls with visible text expose it in their accessible name; shop headings stay sequential; the batch lot note keeps readable contrast. */
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
const { products } = require('../lib/catalog.ts');
const { ProductGallery } = require('../components/store/product-gallery.tsx');

const text = html => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const vial = products.find(product => product.slug === 'bpc-157-10mg');
const softgel = products.find(product => product.categories.some(category => category.slug === 'softgels'));
assert(vial && softgel, 'Fixture products exist in the real catalog');
for (const product of [vial, softgel]) {
  const html = renderToStaticMarkup(React.createElement(ProductGallery, { product }));
  const button = html.match(/<button[^>]*(?:gallery-enlarge|softgel-view-enlarge)[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/button>/);
  assert(button, product.slug + ': enlarge control renders');
  const visible = text(button[2].replace(/<img[^>]*>/g, ''));
  assert.equal(visible, 'View larger', product.slug + ': visible label is unchanged');
  assert(button[1].startsWith(visible), product.slug + ': accessible name begins with the visible label (' + button[1] + ')');
  assert(button[1].includes(product.name), product.slug + ': accessible name still names the product');
}

const catalog = fs.readFileSync(path.join(root, 'components/store/catalog.tsx'), 'utf8');
const sizeLink = catalog.match(/className="card-other-size"[^>]*aria-label=\{([^}]+)\}>View \{sizeLabel\(size\)\}/);
assert(sizeLink, 'Other-size card link keeps its visible "View <size>" text');
assert(/^'View ' \+ sizeLabel\(size\)/.test(sizeLink[1]), 'Other-size link name begins with its visible "View <size>" text');
const layout = catalog.slice(catalog.indexOf('</aside></Collapsible>'));
assert(/^<\/aside><\/Collapsible><div><h2 className="sr-only">Products<\/h2>/.test(layout), 'Product grid has its own h2 so card h3s follow an h2 even when mobile filters are collapsed');

const css = fs.readFileSync(path.join(root, 'app/storefront-v6.css'), 'utf8');
const note = css.match(/\.batch-source-note\{[^}]*color:(#[0-9a-f]{6})/i)[1];
const passport = css.match(/\.batch-passport\{[^}]*background:(#[0-9a-f]{6})/i)[1];
const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
assert(ratio(note, passport) >= 4.5, 'Batch lot note contrast ' + ratio(note, passport).toFixed(2) + ' meets 4.5:1 on the passport surface');
assert(ratio(note, '#f7f7f7') >= 4.5, 'Batch lot note contrast meets 4.5:1 on the lighter surface Lighthouse measured');
console.log('visible-label-names-v1 passed');
