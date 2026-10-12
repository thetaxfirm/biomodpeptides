/* Actual shipping settings component and payload parser. Isolated form events,
 * no configuration writes, network, carrier accounts, customers or orders. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = process.env.BIOMOD_ADMIN_TEST_ROOT || path.resolve(__dirname, '..');
const projectRequire = Module.createRequire(path.join(root, 'package.json'));
const ts = projectRequire('typescript'), React = projectRequire('react');
let active;
const hooks = { ...React, useState(initial) { const host = active, index = host.cursor++; if (!(index in host.slots)) host.slots[index] = typeof initial === 'function' ? initial() : initial; return [host.slots[index], value => { host.slots[index] = typeof value === 'function' ? value(host.slots[index]) : value; }]; } };
function load(file) {
 const mod = new Module(file, module); mod.filename = file; mod.paths = Module._nodeModulePaths(root);
 mod.require = id => {
  if (id === 'react') return hooks;
  if (id === 'react/jsx-runtime') return projectRequire(id);
  if (id === '@/lib/catalog') return { money: cents => '$' + (cents / 100).toFixed(2) };
  if (id === '@/lib/shipping-options') return load(path.join(root, 'lib/shipping-options.ts'));
  if (id.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
  throw Error('Unexpected dependency: ' + id);
 };
 mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
 return mod.exports;
}
const { AdminShippingSettings, shippingSettingsFromForm } = load(path.join(root, 'components/store/admin-shipping-settings.tsx'));
global.fetch = () => { throw Error('Network forbidden'); };
function mount(config = { shippingCents: null, freeShippingAt: 20000 }) {
 const h = { props: { config, busy: false }, slots: [], cursor: 0, tree: null, render() { this.cursor = 0; active = this; this.tree = AdminShippingSettings(this.props); } }; h.render(); return h;
}
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(x => nodes(x, result)); else if (node?.props) { result.push(node); nodes(node.props.children, result); } return result; }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (Array.isArray(node)) return node.map(text).join(' ').replace(/\s+/g, ' ').trim(); if (typeof node !== 'object') return String(node); return text(node.props?.children); }
const field = (h, name) => { const n = nodes(h.tree).find(n => n.type === 'input' && n.props.name === name); assert(n, 'Expected field ' + name); return n; };
const change = (h, name, value) => { const n = field(h, name); n.props.onChange({ target: n.props.type === 'checkbox' ? { checked: value } : { value } }); h.render(); };
function formData(h, overrides = {}) {
 const values = {};
 for (const n of nodes(h.tree).filter(n => n.type === 'input' && n.props.name)) {
  if (n.props.type === 'checkbox') { if (n.props.checked) values[n.props.name] = 'on'; }
  else values[n.props.name] = String(n.props.value ?? n.props.defaultValue ?? '');
 }
 return { ...values, ...overrides };
}
let h = mount();
assert.deepEqual(nodes(h.tree).filter(n => n.type === 'h3').slice(0, 3).map(text), ['Standard', 'Expedited', 'Overnight']);
assert.equal(field(h, 'overnightHandling').props.value, '10'); assert.equal(field(h, 'standardHandling').props.value, '0');
assert(text(h.tree).includes('Live carrier quote + $10.00 handling')); assert(text(h.tree).includes('after dispatch')); assert(text(h.tree).includes('does not change preorder dispatch dates'));
assert(text(h.tree).includes('does not connect or activate')); assert(text(h.tree).includes('Existing orders keep their saved shipping charges'));
assert.equal(field(h, 'shipping').props.defaultValue, ''); assert.equal(field(h, 'threshold').props.defaultValue, '200');
let body = shippingSettingsFromForm(formData(h));
assert.deepEqual(body, { shippingCents: null, freeShippingAt: 20000, shippingOptions: { standardEnabled: true, expeditedEnabled: true, overnightEnabled: true, freeStandardEnabled: true, standardHandlingCents: 0, expeditedHandlingCents: 0, overnightHandlingCents: 1000, carriers: ['USPS', 'UPS'] } });
change(h, 'overnightHandling', '12.55'); change(h, 'expeditedHandling', '3.50'); change(h, 'standardHandling', '1');
assert(text(h.tree).includes('Live carrier quote + $12.55 handling'));
change(h, 'standardEnabled', false); change(h, 'freeStandardEnabled', false); change(h, 'shippingCarrierUSPS', false); change(h, 'shippingCarrierFedEx', true);
body = shippingSettingsFromForm(formData(h, { shipping: '5.99', threshold: '175.50' }));
assert.deepEqual(body, { shippingCents: 599, freeShippingAt: 17550, shippingOptions: { standardEnabled: false, expeditedEnabled: true, overnightEnabled: true, freeStandardEnabled: false, standardHandlingCents: 100, expeditedHandlingCents: 350, overnightHandlingCents: 1255, carriers: ['UPS', 'FedEx'] } });
assert(text(h.tree).includes('Disabled at checkout. The fee stays saved.'));
change(h, 'freeStandardEnabled', true); assert(text(h.tree).includes('Standard must also be enabled'));
change(h, 'expeditedEnabled', false); change(h, 'overnightEnabled', false); assert(text(h.tree).includes('All delivery tiers are disabled'));
change(h, 'shippingCarrierUPS', false); change(h, 'shippingCarrierFedEx', false);
assert(text(h.tree).includes('Choose at least one carrier before saving')); assert.equal(field(h, 'shippingCarrierUSPS').props.required, true);
assert.throws(() => shippingSettingsFromForm(formData(h)), /at least one shipping carrier/);
change(h, 'shippingCarrierFedEx', true); assert.equal(field(h, 'shippingCarrierUSPS').props.required, false);
for (const value of ['', '-1', 'oops', '1000.01']) assert.throws(() => shippingSettingsFromForm(formData(h, { overnightHandling: value })), /Overnight handling fee/);
assert.throws(() => shippingSettingsFromForm(formData(h, { threshold: '10000.01' })), /Free standard threshold/);
assert.throws(() => shippingSettingsFromForm(formData(h, { shipping: '-1' })), /Standard fallback/);
assert.equal(shippingSettingsFromForm(formData(h, { overnightHandling: '0' })).shippingOptions.overnightHandlingCents, 0, 'Owner may remove the handling fee');
assert.deepEqual(shippingSettingsFromForm({ shipping: '', threshold: '200' }), { shippingCents: null, freeShippingAt: 20000 }, 'Old form versions do not disable saved shipping options');
h.props.busy = true; h.render(); assert.equal(h.tree.props.disabled, true);
const before = formData(h); change(h, 'overnightHandling', '40'); change(h, 'overnightEnabled', true); change(h, 'shippingCarrierUSPS', true); assert.deepEqual(formData(h), before, 'Busy fields do not alter a pending save');
// Loaded runtime values, including intentional zero/false and chosen carriers,
// win over defaults. Editing a different field cannot reset the configured ones.
h = mount({ shippingCents: 0, freeShippingAt: 0, shippingOptions: { standardEnabled: false, expeditedEnabled: true, overnightEnabled: false, freeStandardEnabled: false, standardHandlingCents: 250, expeditedHandlingCents: 0, overnightHandlingCents: 1999, carriers: ['FedEx'] } });
assert.equal(field(h, 'shipping').props.defaultValue, '0'); assert.equal(field(h, 'threshold').props.defaultValue, '0'); assert.equal(field(h, 'overnightHandling').props.value, '19.99'); assert.equal(field(h, 'shippingCarrierFedEx').props.checked, true); assert.equal(field(h, 'shippingCarrierUSPS').props.checked, false);
change(h, 'expeditedHandling', '2.25'); body = shippingSettingsFromForm(formData(h)); assert.equal(body.shippingOptions.overnightHandlingCents, 1999); assert.equal(body.shippingOptions.overnightEnabled, false); assert.equal(body.shippingOptions.expeditedHandlingCents, 225); assert.deepEqual(body.shippingOptions.carriers, ['FedEx']);
console.log('PASS: actual shipping settings and form payload, default overnight rate plus $10, per-tier controls/fees, eligible carriers, threshold/fallback cents, runtime overrides, zero/false preservation, validation, timing disclosure and busy guards. No network or runtime writes.');
