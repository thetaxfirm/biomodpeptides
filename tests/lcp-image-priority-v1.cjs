/* The above-the-fold product image is preloaded at high priority; list and cart thumbnails are not. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToString } = require('react-dom/server');
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
const { listingImage } = require('../lib/product-imagery.ts');
const { ProductGallery } = require('../components/store/product-gallery.tsx');
const { ProductImage } = require('../components/store/product-image.tsx');

const page = body => renderToString(React.createElement('html', null, React.createElement('head'), React.createElement('body', null, body)));
const preloads = html => [...html.matchAll(/<link[^>]*rel="preload"[^>]*>/g)].map(match => match[0]);
const bpc = products.find(product => product.slug === 'bpc-157-10mg');
assert(bpc, 'BPC-157 10mg exists in the real catalog');

const gallery = page(React.createElement(ProductGallery, { product: bpc }));
const hero = preloads(gallery);
assert.equal(hero.length, 1, 'Product page gallery emits one image preload: ' + hero.join(' '));
assert(hero[0].includes('href="' + listingImage(bpc) + '"'), 'Preload targets the same file the gallery SVG draws');
assert(/as="image"/.test(hero[0]) && /fetchPriority="high"|fetchpriority="high"/i.test(hero[0]), 'Preload is an image at high priority');
assert(gallery.includes('<image href="' + listingImage(bpc) + '"'), 'Gallery still draws the vial artwork in its measured frame');

const others = products.filter(product => product.id !== bpc.id).slice(0, 3);
const grid = page(React.createElement(React.Fragment, null, others.map(product => React.createElement(ProductImage, { key: product.id, product }))));
assert.equal(preloads(grid).length, 0, 'Lazy list and related-product images are not preloaded');
console.log('lcp-image-priority-v1 passed');
