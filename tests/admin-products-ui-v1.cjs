/* Actual product-editor components and pricing/availability helpers, with local
 * React hooks and synthetic product fixtures. No API, order or provider writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = process.env.BIOMOD_ADMIN_TEST_ROOT || path.resolve(__dirname, '..');
const projectRequire = Module.createRequire(path.join(root, 'package.json'));
const ts = projectRequire('typescript');
const React = projectRequire('react');
let active;
const hooks = { ...React, useState(initial) {
 const host = active, index = host.cursor++;
 if (!(index in host.slots)) host.slots[index] = typeof initial === 'function' ? initial() : initial;
 return [host.slots[index], value => { host.slots[index] = typeof value === 'function' ? value(host.slots[index]) : value; }];
}};
const cache = new Map();
function load(file) {
 file = path.resolve(file);
 if (cache.has(file)) return cache.get(file);
 if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
 const mod = new Module(file, module); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
 cache.set(file, mod.exports);
 mod.require = id => {
  if (id === 'react') return hooks;
  if (id === 'react/jsx-runtime') return projectRequire(id);
  if (id.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
  if (id.startsWith('@/lib/') || id.startsWith('./')) {
   let target = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
   if (!path.extname(target)) target += '.ts';
   return load(target);
  }
  throw Error('Unexpected component dependency: ' + id);
 };
 mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
 cache.set(file, mod.exports); return mod.exports;
}
const { AdminProducts } = load(path.join(root, 'components/store/admin-products.tsx'));
const { products: sourceProducts } = load(path.join(root, 'lib/catalog.ts'));
const { hasPublicationHold } = load(path.join(root, 'lib/availability.ts'));
global.fetch = () => { throw Error('Network forbidden in product UI tests'); };
const fixedNow = Date.parse('2026-10-13T12:00:00Z');
const originalNow = Date.now; Date.now = () => fixedNow;
function product(id, name, category, extra = {}) {
 return { id, name, identity: name, slug: `fixture-${id}`, categories: [{ slug: category, name: category }], sku: `SKU-${id}`, sizes: ['10mg'], price: 9999, regularPrice: 9999, inStock: true, purchasable: true, stockQuantity: 50, maxQuantity: 10, ...extra };
}
const fixtures = [
 product(910001, 'Synthetic vial', 'research-compounds', { sale: { enabled: true, percentOff: 20, starts: '2026-10-12T12:00:00Z', ends: '2026-10-14T12:00:00Z' } }),
 product(910002, 'Synthetic spray', 'spray-products', { sizes: ['60mL'], preorder: { enabled: true, percentOff: 15, ships: 'early November 2026' }, packPrices: { 3: 24000, 5: null, 10: 70000 } }),
 product(910003, 'Synthetic softgel', 'softgels', { availability: 'coming_soon', inStock: false, purchasable: false, sizes: ['60 softgels'] }),
 product(910004, 'Synthetic supply', 'aminos-liquids', { stockQuantity: 0 }),
];
function mount(products = fixtures) {
 const instances = new Map();
 const host = { props: { products, edited: null, query: '', busy: false, formKey: 0 }, instances, tree: null, drafts: 0, saves: [],
  render() {
   const seen = new Set();
   const expand = (node, at = 'root') => {
    if (Array.isArray(node)) return node.map((item, i) => expand(item, `${at}:${i}`));
    if (!node || typeof node !== 'object' || !node.props) return node;
    if (typeof node.type === 'function') {
     const key = `${at}:${node.type.name}:${node.key || ''}`; seen.add(key);
     let instance = instances.get(key); if (!instance) { instance = { slots: [], cursor: 0 }; instances.set(key, instance); }
     instance.cursor = 0; active = instance;
     return expand(node.type(node.props), key);
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, at + ':children') } };
   };
   this.tree = expand(React.createElement(AdminProducts, this.props));
   for (const key of instances.keys()) if (!seen.has(key)) instances.delete(key);
   return this.tree;
  }
 };
 Object.assign(host.props, {
  onQuery: value => { host.props.query = value; },
  onEdit: value => { host.props.edited = value; host.drafts++; },
  onDraft: () => { host.drafts++; },
  onCancel: () => { host.props.edited = null; },
  onSave: event => { host.saves.push(event); },
 });
 host.render(); return host;
}
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(x => nodes(x, result)); else if (node?.props) { result.push(node); nodes(node.props.children, result); } return result; }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (Array.isArray(node)) return node.map(text).join(' ').replace(/\s+/g, ' ').trim(); if (typeof node !== 'object') return String(node); return text(node.props?.children); }
function find(h, predicate) { const value = nodes(h.tree).find(predicate); assert(value, 'Expected UI element'); return value; }
const button = (h, label) => find(h, n => n.type === 'button' && text(n) === label);
const input = (h, name) => find(h, n => n.type === 'input' && n.props.name === name);
const checkbox = (h, label) => { const parent = find(h, n => n.type === 'label' && text(n) === label); return nodes(parent).find(n => n.type === 'input'); };
const type = (h, name, value) => { input(h, name).props.onChange({ target: { value } }); h.render(); };
const click = (h, label) => { button(h, label).props.onClick(); h.render(); };
const edit = (h, name) => { find(h, n => n.type === 'button' && n.props['aria-label'] === 'Edit ' + name).props.onClick(); h.render(); };
const status = (h, value) => { find(h, n => n.type === 'input' && n.props.type === 'radio' && n.props.value === value).props.onChange(); h.render(); };
const submit = h => { find(h, n => n.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: { fixture: true } }); h.render(); };
try {
 let h = mount();
 assert.deepEqual(nodes(h.tree).filter(n => n.type === 'h3').map(text), ['Lyophilized', 'Nasal & spray', 'Softgels', 'Other products']);
 assert.equal(new Set(nodes(h.tree).filter(n => n.type === 'section' && n.props['aria-labelledby']?.startsWith('product-group-')).map(n => n.props.className)).size, 4, 'Formats have separate visual treatments');
 assert(text(h.tree).includes('$79.99 with offer')); assert(text(h.tree).includes('Sale · 20% off')); assert(text(h.tree).includes('Preorder · 15% off')); assert(text(h.tree).includes('Coming soon')); assert(text(h.tree).includes('Sold out'));
 find(h, n => n.type === 'button' && text(n).startsWith('Nasal & spray')).props.onClick(); h.render();
 assert(text(h.tree).includes('Synthetic spray')); assert(!text(h.tree).includes('Synthetic vial')); assert(!text(h.tree).includes('Synthetic softgel'));
 find(h, n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value: 'missing' } }); h.render();
 assert(text(h.tree).includes('No products match')); assert.equal(h.drafts, 0, 'Searching and format filters do not create product drafts');
 find(h, n => n.type === 'button' && text(n).startsWith('All products')).props.onClick(); h.props.onQuery('SKU-910003'); h.render();
 assert(text(h.tree).includes('Synthetic softgel')); assert(!text(h.tree).includes('Synthetic spray'));
 h.props.onQuery(''); h.render(); edit(h, 'Synthetic spray');
 assert(!nodes(h.tree).some(n => n.props.role === 'dialog'), 'Editing is an inline workspace, not a modal');
 assert.equal(input(h, 'fixed3').props.value, '240'); assert.equal(input(h, 'fixed5').props.value, ''); assert.equal(input(h, 'fixed10').props.value, '700');
 assert(text(h.tree).includes('Preorder pricing takes priority')); assert.equal(input(h, 'stockQuantity').props.value, '50');
 status(h, 'coming_soon'); assert.equal(h.props.edited.availability, 'coming_soon'); assert.equal(h.props.edited.inStock, false); assert.equal(h.props.edited.purchasable, false); assert.equal(h.props.edited.stockQuantity, 50); assert.deepEqual(h.props.edited.preorder, fixtures[1].preorder);
 status(h, 'sold_out'); assert.equal(h.props.edited.availability, 'sold_out');
 status(h, 'available'); assert.equal(h.props.edited.inStock, true); assert.equal(h.props.edited.purchasable, true);
 type(h, 'stockQuantity', '0'); assert(text(h.tree).includes('Customers will see Sold out')); assert.equal(h.props.edited.stockQuantity, 50, 'Typing quantity preserves original expected-stock snapshot');
 type(h, 'stockQuantity', '40'); type(h, 'price', '100'); type(h, 'salePercent', '15');
 assert(text(h.tree).includes('$85.00')); assert.match(text(h.tree), /Save\s+\$15\.00\s+\(\s*15\s*%\)/);
 checkbox(h, 'Enable scheduled sale').props.onChange({ target: { checked: true } }); h.render();
 assert.equal(h.props.edited.sale.enabled, true); assert.equal(input(h, 'saleStarts').props.required, true); assert.equal(input(h, 'price').props.value, '100', 'Toggling status and sale preserves typed fields');
 type(h, 'saleStarts', '2099-01-01T08:00'); type(h, 'saleEnds', '2099-01-01T07:00'); submit(h);
 assert.equal(h.saves.length, 0); assert(text(h.tree).includes('end date and time after its start'));
 click(h, '24 hours'); assert(text(h.tree).includes('Duration: 1 day (24 hours)'));
 type(h, 'saleEnds', '2099-01-01T09:00'); assert(text(h.tree).includes('1 hour)')); assert(!text(h.tree).includes('1 hours)'));
 click(h, '3 days'); assert.equal(input(h, 'saleStarts').props.value, '2099-01-01T08:00'); assert.equal(input(h, 'saleEnds').props.value, '2099-01-04T08:00'); assert(text(h.tree).includes('Duration: 3 days (72 hours)'));
 submit(h); assert.equal(h.saves.length, 1); assert.equal(h.saves[0].currentTarget.fixture, true);
 type(h, 'salePercent', '100'); submit(h); assert.equal(h.saves.length, 1); assert(text(h.tree).includes('greater than 0 and less than 100'));
 click(h, 'Remove sale from this draft'); assert.equal(h.props.edited.sale, null); assert.equal(input(h, 'salePercent').props.value, ''); assert.equal(input(h, 'saleStarts').props.value, ''); assert.equal(input(h, 'saleEnds').props.value, ''); assert.equal(input(h, 'saleStarts').props.required, false);
 submit(h); assert.equal(h.saves.length, 2, 'Removing a sale saves cleanly without invalid date conversions');
 checkbox(h, 'Offer as preorder').props.onChange({ target: { checked: false } }); h.render(); assert.equal(h.props.edited.preorder.enabled, false); assert.equal(h.props.edited.preorder.ships, fixtures[1].preorder.ships); assert(!text(h.tree).includes('Preorder pricing takes priority'));
 h.props.busy = true; h.render(); assert.equal(find(h, n => n.type === 'fieldset').props.disabled, true); assert.equal(button(h, 'Saving product…').props.disabled, true); assert.equal(button(h, 'Discard product draft').props.disabled, true);
 const draftCount = h.drafts; type(h, 'price', '500'); status(h, 'unavailable'); click(h, '7 days'); submit(h); assert.equal(h.drafts, draftCount); assert.equal(input(h, 'price').props.value, '100'); assert.equal(h.saves.length, 2, 'Busy controls cannot send a duplicate save');
 h.props.busy = false; h.render(); click(h, 'Discard product draft'); assert(!h.props.edited); edit(h, 'Synthetic spray'); assert.equal(input(h, 'price').props.value, '99.99', 'Discard and reopen restores loaded values');
 assert.equal(input(h, 'stockQuantity').props.value, '50'); assert.equal(checkbox(h, 'Offer as preorder').props.checked, true);
 click(h, 'Discard product draft'); edit(h, 'Synthetic supply'); assert(!nodes(h.tree).some(n => n.type === 'input' && n.props.name === 'fixed3')); assert.equal(input(h, 'stockQuantity').props.value, '0', 'Zero stock never displays as missing');
 h = mount([product(910005, 'Closed offer fixture', 'softgels', { availability: 'coming_soon', inStock: false, purchasable: false, preorder: { enabled: true, percentOff: 15, ships: 'early November 2026' } })]);
 assert(text(h.tree).includes('Preorder configured')); assert(text(h.tree).includes('Ordering closed')); assert(!text(h.tree).includes('with offer'));
 const heldSource = sourceProducts.find(hasPublicationHold); assert(heldSource, 'Source has publication-hold fixture');
 h = mount([heldSource]); edit(h, heldSource.name);
 const availableRadio = find(h, n => n.type === 'input' && n.props.type === 'radio' && n.props.value === 'available'); assert.equal(availableRadio.props.disabled, true); availableRadio.props.onChange(); h.render();
 assert(text(h.tree).includes('Publication hold')); assert(!h.props.edited.purchasable, 'UI cannot republish a source-held product');
 console.log('PASS: grouped product formats, search/SKU filters, status controls, publication holds, base/fixed-pack fields, draft-preserving availability, preorder separation, real price previews, schedule validation/durations, removal, busy guards and discard. Actual component/helpers, isolated fixtures, no network.');
} finally { Date.now = originalNow; }
