const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
require.extensions['.ts'] = (m, file) => m._compile(transpile(file), file);
const { products } = require('../lib/catalog.ts');
const { supportsPacks } = require('../lib/packs.ts');

// Exercise the actual component render and input handlers. Only the context and
// unrelated presentation children are replaced; filtering uses the real catalog.
function mount(file, props = {}, catalog = products) {
  const state = []; let cursor = 0;
  const hooks = { ...React, useId: () => 'test', useEffect: () => {}, useMemo: fn => fn(), useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
  } };
  const store = { products: catalog, config: { packDiscounts: {} }, cart: [], wishlist: [], savedPacks: [], customer: null, campaigns: [] };
  const passthrough = new Proxy({}, { get: (_, name) => function PresentationChild() { return name; } });
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const filename = path.join(root, file), m = new Module(filename, module);
    modules.set(file, m); m.filename = filename; m.paths = Module._nodeModulePaths(root);
    const originalRequire = m.require.bind(m);
    m.require = id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? originalRequire(id) :
      id === './provider' ? { useStore: () => ({ store, ready: true, addMixedPack: async () => {}, wish: async () => {} }), report: () => {}, api: async () => ({}) } :
      id === './catalog' ? load('components/store/catalog.tsx') :
      id === './pack-builder' ? load('components/store/pack-builder.tsx') :
      id.startsWith('@/lib/') ? originalRequire(path.join(root, id.slice(2)) + '.ts') : passthrough;
    m._compile(transpile(filename), filename);
    return m.exports;
  }
  const exports = load(file);
  const Component = exports[file.endsWith('experience.tsx') ? 'Experience' : file.endsWith('catalog.tsx') ? 'Shop' : 'PackBuilder'];
  return () => {
    cursor = 0;
    let tree = Component(props);
    // Follow the real Experience -> catalog export -> Shop/PackBuilder route.
    // Leave presentation descendants unrendered so their props can be inspected.
    if (file.endsWith('experience.tsx')) {
      assert.equal(typeof tree.type, 'function', 'Experience must select a real component');
      tree = tree.type(tree.props);
    }
    return tree;
  };
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...elements(tree.props?.children)];
}
const productSlugs = tree => elements(tree).filter(n => n.props?.product).map(n => n.props.product.slug);
const packSlugs = tree => [...new Set(elements(tree).map(n => n.props?.href).filter(x => x?.startsWith('/product/')).map(x => x.slice(9)))];
const input = (tree, label) => elements(tree).find(n => n.type === 'input' && n.props['aria-label'] === label);

const expectedVials = products.filter(p => p.categories.some(c => c.slug === 'research-compounds')).map(p => p.slug).sort();
const route = (pathname, query = {}) => mount('components/store/experience.tsx', { path: pathname, query });
const shop = route('shop');
assert.deepEqual(productSlugs(shop()).sort(), expectedVials, 'Experience must pass research-compounds to canonical /shop');
assert(productSlugs(shop()).length > 0, 'the existing canonical shop route must remain populated');
const legacyCategory = route('shop', { category: 'research-peptides' });
assert.deepEqual(productSlugs(legacyCategory()).sort(), expectedVials, 'Experience must preserve its legacy-category translation');
const unknownCategory = route('shop', { category: 'unknown-collection' });
assert.deepEqual(productSlugs(unknownCategory()).sort(), expectedVials, 'unknown category must fall back to the current research collection');
const directShop = mount('components/store/catalog.tsx');
assert.deepEqual(productSlugs(directShop()).sort(), expectedVials, 'direct Shop use also defaults to the current category');
const softgels = route('shop', { category: 'softgels' });
assert.deepEqual(productSlugs(softgels()).sort(), products.filter(p => p.categories.some(c => c.slug === 'softgels')).map(p => p.slug).sort());
const queried = route('shop', { q: 'bpc157 10mg' });
assert.equal(productSlugs(queried())[0], 'bpc-157-10mg', 'Experience must pass the query without a default category blocking relevant matches');

const pack = route('multi-pack', { size: '5' });
assert(elements(pack()).some(n => n.type === 'h2' && Array.isArray(n.props.children) && n.props.children.includes('5-pack')), 'Experience must pass the selected pack size through the catalog re-export');
const eligible = products.filter(p => supportsPacks(p) && p.inStock && p.purchasable);
assert.deepEqual(packSlugs(pack()).sort(), eligible.map(p => p.slug).sort(), 'pack availability restrictions must remain intact');
for (const [query, expected] of [['bpc157 10mg', 'bpc-157-10mg'], ['TB-500', 'tb500-10mg'], ['ghk cu 50 mg', 'ghk-cu-50mg']]) {
  input(pack(), 'Search pack products').props.onChange({ target: { value: query } });
  assert(packSlugs(pack()).includes(expected), query + ' should find the same normalized identity in the pack builder');
}
input(pack(), 'Search pack products').props.onChange({ target: { value: 'bpc157 20mg' } });
assert(!packSlugs(pack()).includes('bpc-157-10mg'), 'pack search must not substitute a different numeric strength');
input(pack(), 'Search pack products').props.onChange({ target: { value: 'no-such-compound' } });
assert.equal(packSlugs(pack()).length, 0);
const clear = elements(pack()).find(n => n.type === 'button' && n.props.children === 'Clear search and filters');
assert(clear, 'empty pack search has a recovery control'); clear.props.onClick();
assert.deepEqual(packSlugs(pack()).sort(), eligible.map(p => p.slug).sort());
console.log('PASS: real Experience routes preserve canonical shop and legacy category, recover unknown category, pass product search and pack size, normalize pack queries, preserve availability and clear empty results');
