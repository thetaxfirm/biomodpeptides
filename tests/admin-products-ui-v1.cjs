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
 const host = { props: { products, edited: null, query: '', busy: false, formKey: 0, batchRecords: [], canRelease: false }, instances, tree: null, drafts: 0, saves: [],
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
 assert.deepEqual(nodes(h.tree).filter(n => n.type === 'h3').map(text), ['Lyophilized', 'Sprays', 'Softgels', 'Other products']);
 assert.equal(new Set(nodes(h.tree).filter(n => n.type === 'section' && n.props['aria-labelledby']?.startsWith('product-group-')).map(n => n.props.className)).size, 4, 'Formats have separate visual treatments');
 assert(text(h.tree).includes('$79.99 with offer')); assert(text(h.tree).includes('Sale · 20% off')); assert(text(h.tree).includes('Preorder · 15% off')); assert(text(h.tree).includes('Coming soon')); assert(text(h.tree).includes('Sold out'));
 find(h, n => n.type === 'button' && text(n).startsWith('Sprays')).props.onClick(); h.render();
 assert(text(h.tree).includes('Synthetic spray')); assert(!text(h.tree).includes('Synthetic vial')); assert(!text(h.tree).includes('Synthetic softgel'));
 find(h, n => n.type === 'input' && n.props.type === 'search').props.onChange({ target: { value: 'missing' } }); h.render();
 assert(text(h.tree).includes('No products match')); assert.equal(h.drafts, 0, 'Searching and format filters do not create product drafts');
 find(h, n => n.type === 'button' && text(n).startsWith('All products')).props.onClick(); h.props.onQuery('SKU-910003'); h.render();
 assert(text(h.tree).includes('Synthetic softgel')); assert(!text(h.tree).includes('Synthetic spray'));
 h.props.onQuery(''); h.render(); edit(h, 'Synthetic spray');
 assert(!nodes(h.tree).some(n => n.props.role === 'dialog'), 'Editing is an inline workspace, not a modal');
 assert.equal(input(h, 'packPricingMode').props.value, 'custom', 'Loaded manual totals stay custom until the base price changes');
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
 // Changing the single price recalculates fixed packs immediately; manual edits remain deliberate.
 const customPackProduct = product(910006, 'Custom pack fixture', 'research-compounds', {
  price: 6999, packPrices: { 3: 17000, 5: 28000, 10: 51000 }, preorder: { enabled: true, percentOff: 15, ships: 'early November 2026' },
 });
 h = mount([customPackProduct]); edit(h, customPackProduct.name);
 const packValues = () => [3, 5, 10].map(n => input(h, `fixed${n}`).props.value);
 assert.equal(input(h, 'packPricingMode').props.value, 'custom');
 assert.deepEqual(packValues(), ['170', '280', '510'], 'Existing manual totals are unchanged on opening the editor');
 assert(text(h.tree).includes('10%, 15% and 20% off')); assert(text(h.tree).includes('Mixed-pack settings stay unchanged'));
 type(h, 'stockQuantity', '42'); type(h, 'price', '80');
 assert.deepEqual(packValues(), ['216.00', '340.00', '640.00']);
 assert.equal(input(h, 'packPricingMode').props.value, 'automatic');
 assert.equal(input(h, 'stockQuantity').props.value, '42');
 assert.equal(input(h, 'preorderPercent').props.value, '15');
 assert.equal(input(h, 'preorderShips').props.value, 'early November 2026');
 assert.equal(h.props.edited.stockQuantity, 50, 'Recalculation preserves the inventory conflict snapshot');
 status(h, 'coming_soon'); status(h, 'available');
 checkbox(h, 'Offer as preorder').props.onChange({ target: { checked: false } }); h.render();
 assert.deepEqual(packValues(), ['216.00', '340.00', '640.00']);
 assert.equal(input(h, 'packPricingMode').props.value, 'automatic', 'Availability and offer toggles preserve the pricing mode');
 for (const incomplete of ['', '.', '1e', '80.', '0', '-1', 'Infinity', '100000', '80.001']) {
  type(h, 'price', incomplete);
  assert.deepEqual(packValues(), ['', '', ''], `Invalid or incomplete ${JSON.stringify(incomplete)} clears derived totals`);
  assert.equal(input(h, 'packPricingMode').props.value, 'automatic');
  assert.equal(input(h, 'stockQuantity').props.value, '42');
 }
 type(h, 'price', '69.99');
 assert.deepEqual(packValues(), ['188.97', '297.46', '559.92'], 'Pack totals use the shared cents rounding');
 type(h, 'price', '80'); type(h, 'fixed3', '210.50');
 assert.deepEqual(packValues(), ['210.50', '340.00', '640.00']);
 assert.equal(input(h, 'packPricingMode').props.value, 'custom', 'A direct pack edit requests custom pricing');
 type(h, 'fixed5', ''); assert.equal(input(h, 'packPricingMode').props.value, 'custom', 'Blank pack override retains the standard fallback');
 type(h, 'price', '80');
 assert.deepEqual(packValues(), ['216.00', '340.00', '640.00'], 'The next base edit replaces all custom totals with fresh standard packs');
 assert.equal(input(h, 'packPricingMode').props.value, 'automatic');
 h.props.busy = true; h.render(); const pricingDraftCount = h.drafts;
 type(h, 'price', '90'); type(h, 'fixed3', '200');
 assert.deepEqual(packValues(), ['216.00', '340.00', '640.00']); assert.equal(input(h, 'price').props.value, '80');
 assert.equal(input(h, 'packPricingMode').props.value, 'automatic'); assert.equal(h.drafts, pricingDraftCount);
 h.props.busy = false; h.render(); submit(h); assert.equal(h.saves.length, 1);
 click(h, 'Discard product draft'); edit(h, customPackProduct.name);
 assert.equal(input(h, 'price').props.value, '69.99'); assert.deepEqual(packValues(), ['170', '280', '510']);
 assert.equal(input(h, 'packPricingMode').props.value, 'custom', 'Discard restores the saved custom pack mode');
 h = mount([product(910005, 'Closed offer fixture', 'softgels', { availability: 'coming_soon', inStock: false, purchasable: false, preorder: { enabled: true, percentOff: 15, ships: 'early November 2026' } })]);
 assert(text(h.tree).includes('Preorder configured')); assert(text(h.tree).includes('Ordering closed')); assert(!text(h.tree).includes('with offer'));
 const heldSource = sourceProducts.find(hasPublicationHold); assert(heldSource, 'Source has publication-hold fixture');
 h = mount([heldSource]); edit(h, heldSource.name);
 const availableRadio = find(h, n => n.type === 'input' && n.props.type === 'radio' && n.props.value === 'available'); assert.equal(availableRadio.props.disabled, false); availableRadio.props.onChange(); h.render();
 assert(text(h.tree).includes('Publication hold')); assert(text(h.tree).includes('Only an owner can release')); submit(h); assert.equal(h.saves.length,0,'A nonowner cannot save a held Available product');
 h.props.canRelease=true;h.render();assert(input(h,'releaseReviewed').props.required);assert(input(h,'batchLot').props.required);
 submit(h);assert(text(h.tree).includes('Enter the current product lot'));
 type(h,'batchLot','702-20-0001');submit(h);assert(text(h.tree).includes('cannot be released'));assert.equal(h.saves.length,0);
 type(h,'batchLot','SYNTHETIC-REPLACEMENT-LOT');submit(h);assert(text(h.tree).includes('Confirm the owner review'));
 input(h,'releaseReviewed').props.onChange({target:{checked:true}});h.render();
 const reason=find(h,n=>n.type==='textarea'&&n.props.name==='releaseReason');reason.props.onChange({target:{value:'Synthetic fixture review, not a real release.'}});h.render();submit(h);assert.equal(h.saves.length,1);
 type(h,'batchLot','ANOTHER-SYNTHETIC-LOT');assert.equal(input(h,'releaseReviewed').props.checked,false,'Changing reviewed lot resets owner confirmation');submit(h);assert.equal(h.saves.length,1);
 status(h,'unavailable');submit(h);assert.equal(h.saves.length,2,'Owner review is not required to keep ordering closed');
 // A prior owner release belongs to one lot, not every replacement lot.
 const released={...heldSource,availability:'available',inStock:true,purchasable:true,batch:{lot:'APPROVED-SYNTHETIC',reportRef:null,coaAvailable:false},publicationRelease:{lot:'APPROVED-SYNTHETIC',reason:'Synthetic prior review'}};
 h=mount([released]);h.props.canRelease=true;h.props.batchRecords=[{productId:released.id,lot:'APPROVED-SYNTHETIC',reportRef:null,coaAvailable:false,attached:null,choices:[]}];h.render();edit(h,released.name);assert(!nodes(h.tree).some(n=>n.props.name==='releaseReviewed'));
 type(h,'batchLot','UNREVIEWED-REPLACEMENT');assert(input(h,'releaseReviewed').props.required);submit(h);assert.equal(h.saves.length,0,'A changed lot requires a new owner review');assert.equal(find(h,n=>n.props.name==='releaseReason').props.maxLength,500);
 // Registered original association controls: current lot, strength and eligibility.
 h=mount([fixtures[0]]);h.props.batchRecords=[{productId:fixtures[0].id,lot:'SYNTHETIC-A',reportRef:'public:one',coaAvailable:true,attached:null,choices:[
 {ref:'public:one',lot:'SYNTHETIC-A',reportId:'ORIGINAL-A',filename:'original-a.pdf',url:'/coas/original-a.pdf',strength:'10mg',productName:'Synthetic vial',eligible:true},
 {ref:'private:two',lot:'SYNTHETIC-B',reportId:'ORIGINAL-B',filename:'original-b.pdf',strength:'10mg',productName:'Synthetic vial',eligible:false,identityEligible:true},
 {ref:'public:wrong',lot:'SYNTHETIC-B',reportId:'WRONG-STRENGTH',filename:'wrong.pdf',strength:'50mg',productName:'Synthetic vial',eligible:false,reason:'Strength does not match'}
 ]}];h.render();edit(h,'Synthetic vial');
 const reportSelect=()=>find(h,n=>n.type==='select'&&n.props.name==='batchReportRef');
 assert.equal(input(h,'batchChanged').props.value,'false');assert.equal(input(h,'batchLot').props.value,'SYNTHETIC-A');assert.equal(reportSelect().props.value,'public:one');assert.equal(input(h,'batchCoaAvailable').props.checked,true);assert(text(h.tree).includes('Exact product and lot match'));
 assert.equal(find(h,n=>n.type==='a'&&text(n)==='Read original report').props.href,'/coas/original-a.pdf');
 assert.equal(find(h,n=>n.type==='option'&&n.props.value==='private:two').props.disabled,true,'Different lot cannot attach');
 type(h,'batchLot','SYNTHETIC-B');assert.equal(input(h,'batchChanged').props.value,'true');assert.equal(reportSelect().props.value,'');assert.equal(input(h,'batchCoaAvailable').props.checked,false);assert.equal(input(h,'batchCoaAvailable').props.disabled,true);
 assert.equal(find(h,n=>n.type==='option'&&n.props.value==='public:one').props.disabled,true);assert.equal(find(h,n=>n.type==='option'&&n.props.value==='private:two').props.disabled,false);assert.equal(find(h,n=>n.type==='option'&&n.props.value==='public:wrong').props.disabled,true,'Wrong strength cannot attach');
 reportSelect().props.onChange({target:{value:'private:two'}});h.render();assert.equal(input(h,'batchCoaAvailable').props.disabled,false);assert.equal(input(h,'batchCoaAvailable').props.checked,false,'Associating a report does not silently enable COA delivery');
 assert(text(h.tree).includes('original has no public download link'));assert(!nodes(h.tree).some(n=>n.type==='a'&&text(n)==='Read original report'));
 input(h,'batchCoaAvailable').props.onChange({target:{checked:true}});h.render();assert.equal(input(h,'batchCoaAvailable').props.checked,true);submit(h);assert.equal(h.saves.length,1);
 assert.equal(input(h,'maxQuantity').props.max,'100000');type(h,'maxQuantity','100000');assert.equal(input(h,'maxQuantity').props.value,'100000');
 h.props.busy=true;h.render();type(h,'batchLot','MUST-NOT-CHANGE');reportSelect().props.onChange({target:{value:'public:one'}});input(h,'batchCoaAvailable').props.onChange({target:{checked:false}});h.render();assert.equal(input(h,'batchLot').props.value,'SYNTHETIC-B');assert.equal(reportSelect().props.value,'private:two');assert.equal(input(h,'batchCoaAvailable').props.checked,true);
 h.props.busy=false;h.render();click(h,'Discard product draft');edit(h,'Synthetic vial');assert.equal(input(h,'batchLot').props.value,'SYNTHETIC-A');assert.equal(reportSelect().props.value,'public:one');
 console.log('PASS: grouped product formats, search/SKU filters, status controls, publication holds, automatic fixed-pack recalculation and custom overrides, draft-preserving availability, preorder separation, real price previews, schedule validation/durations, exact lot/COA choices, owner release review, held-lot guard, 100000 maximum, removal, busy guards and discard. Actual component/helpers, isolated fixtures, no network.');
} finally { Date.now = originalNow; }
