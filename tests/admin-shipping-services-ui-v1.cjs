/* Actual per-service shipping admin component and its save payload. Isolated hooks,
 * a synthetic fetch double and synthetic rates. No network, carrier accounts or settings writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const projectRequire = Module.createRequire(path.join(root, 'package.json'));
const ts = projectRequire('typescript'), React = projectRequire('react');
let active;
const hooks = { ...React,
 useState(initial) { const host = active, index = host.cursor++; if (!(index in host.slots)) host.slots[index] = typeof initial === 'function' ? initial() : initial; return [host.slots[index], value => { host.slots[index] = typeof value === 'function' ? value(host.slots[index]) : value; }]; },
 useRef(initial) { const host = active, index = host.cursor++; if (!(index in host.slots)) host.slots[index] = { current: initial }; return host.slots[index]; },
 useEffect(fn) { active.effects.push(fn); },
};
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
const { AdminShippingSettings, shippingServicesPayload, autoLabelReport } = load(path.join(root, 'components/store/admin-shipping-settings.tsx'));
const { shippingServiceCatalog } = load(path.join(root, 'lib/shipping-options.ts'));
const requests = [];
let reply;
global.fetch = async (url, init) => { requests.push({ url, init, body: init?.body ? JSON.parse(init.body) : null }); return { ok: true, json: async () => reply() }; };
function mount(config) { const h = { props: { config, busy: false }, slots: [], cursor: 0, effects: [], tree: null, render() { this.cursor = 0; this.effects = []; active = this; this.tree = AdminShippingSettings(this.props); } }; h.render(); return h; }
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(x => nodes(x, result)); else if (node?.props) { result.push(node); if (typeof node.type === 'function') nodes(node.type(node.props), result); else nodes(node.props.children, result); } return result; }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (Array.isArray(node)) return node.map(text).join(' ').replace(/\s+/g, ' ').trim(); if (typeof node !== 'object') return String(node); if (typeof node.type === 'function') return text(node.type(node.props)); return text(node.props?.children); }
const input = (h, label) => { const n = nodes(h.tree).find(n => n.type === 'input' && n.props['aria-label'] === label); assert(n, 'Expected input ' + label); return n; };
const box = (h, key) => { const n = nodes(h.tree).find(n => n.type === 'input' && n.props.id === 'ship-' + key.replace(':', '-')); assert(n, 'Expected checkbox ' + key); return n; };
const button = (h, label) => { const n = nodes(h.tree).find(n => n.type === 'button' && text(n).includes(label)); assert(n, 'Expected button ' + label); return n; };
const settle = () => new Promise(r => setTimeout(r, 0));

(async () => {
 // Before the first save: mirrors today's checkout (USPS + UPS, all speeds, $10 overnight fee) and says so.
 let h = mount({ shippingCents: 1500, freeShippingAt: 20000 });
 assert(text(h.tree).includes('Not set up yet'));
 assert.equal(nodes(h.tree).filter(n => n.type === 'tr' && n.props['data-enabled'] !== undefined).length, shippingServiceCatalog.length, 'Every catalog service has a row');
 assert.equal(box(h, 'USPS:GROUNDADVANTAGE').props.checked, true); assert.equal(box(h, 'FedEx:FEDEXGROUND').props.checked, false);
 assert.equal(input(h, 'Extra charge for UPS Next Day Air').props.value, '10'); assert.equal(input(h, 'Extra charge for USPS Priority Mail').props.value, '0');

 // Load live prices on open: customer pays = carrier price + extra, shown per row.
 reply = () => ({ check: { ok: true, checkedAt: 'x', destination: 'New York, NY 10118', package: '3 vials', rates: [{ key: 'USPS:GROUNDADVANTAGE', name: 'USPS Ground Advantage', cents: 627, days: 3, tier: 'standard' }, { key: 'UPS:NEXTDAYAIR', name: 'UPS Next Day Air', cents: 4210, days: 1, tier: 'overnight' }], options: [], services: [], freeStandardLabel: null } });
 h.effects.forEach(fn => fn()); await settle(); h.render();
 assert.deepEqual(requests.at(-1).body, { action: 'check', destination: 'ny', sample: 'v3' });
 input(h, 'Extra charge for USPS Ground Advantage').props.onChange({ target: { value: '4.73' } }); h.render();
 assert(text(h.tree).includes('$11.00'), 'Ground Advantage $6.27 + $4.73 = $11.00 shown before saving');
 assert(text(h.tree).includes('$52.10'), 'Next Day Air $42.10 + $10 shown');
 assert(text(h.tree).includes('Not offered'), 'Services the carrier did not quote are labeled');

 // Owner edits: turn on FedEx Priority Overnight with custom wording, turn off USPS Priority.
 box(h, 'FedEx:PRIORITYOVERNIGHT').props.onChange({ target: { checked: true } }); h.render();
 input(h, 'Extra charge for FedEx Priority Overnight').props.onChange({ target: { value: '15' } }); h.render();
 input(h, 'Name customers see for FedEx Priority Overnight').props.onChange({ target: { value: 'Overnight (FedEx)' } }); h.render();
 input(h, 'Note customers see for FedEx Priority Overnight').props.onChange({ target: { value: 'Next business morning' } }); h.render();
 box(h, 'USPS:PRIORITY').props.onChange({ target: { checked: false } }); h.render();
 assert(text(h.tree).includes('Unsaved changes'));

 // Save posts the exact settings and shows the live double check as a green light.
 reply = () => ({ message: 'Shipping saved.', savedMatches: true, settings: requests.at(-1).body.settings, freeShippingAt: 20000, shippingCents: 1500,
  check: { ok: true, checkedAt: 'x', destination: 'New York, NY 10118', package: '3 vials', rates: [], options: [{ label: 'USPS Ground Advantage', note: '', cents: 1100, days: 3 }, { label: 'Overnight (FedEx)', note: 'Next business morning', cents: 6000, days: 1 }], services: [{ key: 'USPS:GROUNDADVANTAGE', label: 'USPS Ground Advantage', status: 'ok' }, { key: 'FedEx:PRIORITYOVERNIGHT', label: 'Overnight (FedEx)', status: 'ok' }], freeStandardLabel: 'Free · USPS Ground Advantage' } });
 button(h, 'Save shipping and check it').props.onClick(); await settle(); h.render();
 const saved = requests.at(-1).body;
 assert.equal(saved.action, 'save');
 const fedex = saved.settings.services.find(s => s.key === 'FedEx:PRIORITYOVERNIGHT');
 assert.deepEqual(fedex, { key: 'FedEx:PRIORITYOVERNIGHT', enabled: true, markupCents: 1500, label: 'Overnight (FedEx)', note: 'Next business morning' });
 assert.equal(saved.settings.services.find(s => s.key === 'USPS:PRIORITY').enabled, false);
 assert.equal(saved.settings.services.find(s => s.key === 'USPS:GROUNDADVANTAGE').markupCents, 473);
 assert.equal(saved.settings.shippingCents, 1500); assert.equal(saved.settings.freeShippingAt, 20000);
 assert(text(h.tree).includes('All 2 shipping options are working'), text(h.tree));
 assert(text(h.tree).includes('saved settings read back and matched'));
 assert(text(h.tree).includes('Overnight (FedEx)') && text(h.tree).includes('$60.00'));
 assert(!text(h.tree).includes('Not set up yet'));

 // A missing or mismatched result is never shown as green.
 reply = () => ({ check: { ok: true, checkedAt: 'x', destination: 'Miami, FL 33133', package: '3 vials', rates: [], options: [{ label: 'USPS Ground Advantage', note: '', cents: 1100, days: 3 }], services: [{ key: 'USPS:GROUNDADVANTAGE', label: 'USPS Ground Advantage', status: 'ok' }, { key: 'FedEx:PRIORITYOVERNIGHT', label: 'Overnight (FedEx)', status: 'missing', message: 'The carrier did not offer this service for the sample address and package.' }], freeStandardLabel: null } });
 button(h, 'Check live prices').props.onClick(); await settle(); h.render();
 const verdict = nodes(h.tree).find(n => n.props?.['data-state']);
 assert.equal(verdict.props['data-state'], 'warn'); assert(text(h.tree).includes('1 working, 1 not offered'));
 reply = () => ({ check: { ok: false, error: 'EasyPost is not connected, so live carrier prices cannot be checked.' } });
 button(h, 'Check live prices').props.onClick(); await settle(); h.render();
 assert.equal(nodes(h.tree).find(n => n.props?.['data-state']).props['data-state'], 'fail');

 // Validation: negative or blank extra, blank name for an offered service.
 const draft = { rows: [{ key: 'USPS:GROUNDADVANTAGE', enabled: true, markupCents: 0, markup: '-1', label: 'X', note: '' }], freeStandardEnabled: true, threshold: '200', fallback: '' };
 assert.throws(() => shippingServicesPayload(draft), /extra charge for USPS Ground Advantage/);
 assert.throws(() => shippingServicesPayload({ ...draft, rows: [{ ...draft.rows[0], markup: '' }] }), /extra charge/);
 assert.throws(() => shippingServicesPayload({ ...draft, rows: [{ ...draft.rows[0], markup: '2', label: ' ' }] }), /name customers will see/);
 assert.throws(() => shippingServicesPayload({ ...draft, rows: [{ ...draft.rows[0], markup: '2' }], threshold: '10000.01' }), /Free shipping minimum/);
 assert.equal(shippingServicesPayload({ ...draft, rows: [{ ...draft.rows[0], markup: '2', enabled: false, label: ' ' }] }).services[0].label, 'USPS Ground Advantage', 'An off service keeps its default name');

 // Delivery confirmation travels with the save, and defaults to a required signature.
 assert.equal(shippingServicesPayload({ ...draft, rows: [{ ...draft.rows[0], markup: '2' }] }).signatureConfirmation, 'SIGNATURE', 'a signature is asked for unless the owner says otherwise');
 assert.equal(shippingServicesPayload({ ...draft, rows: [{ ...draft.rows[0], markup: '2' }], signatureConfirmation: 'ADULT_SIGNATURE' }).signatureConfirmation, 'ADULT_SIGNATURE');
 assert.equal(shippingServicesPayload({ ...draft, rows: [{ ...draft.rows[0], markup: '2' }], signatureConfirmation: 'none' }).signatureConfirmation, 'none', 'turning it off is saved verbatim');

 // Automatic label purchase: the switch, the grace period and the daily limit travel with the save.
 const autoDraft = { ...draft, rows: [{ ...draft.rows[0], markup: '2' }], autoEnabled: true, autoDelay: '20', autoCap: '500' };
 const autoPayload = shippingServicesPayload(autoDraft);
 assert.deepEqual(autoPayload.autoLabel, { enabled: true, delayMinutes: 20, dailyCapCents: 50000 });
 assert.equal(shippingServicesPayload({ ...autoDraft, autoEnabled: false }).autoLabel.enabled, false, 'the kill switch is saved');
 assert.equal(shippingServicesPayload({ ...autoDraft, autoDelay: '0' }).autoLabel.delayMinutes, 0, 'no grace period is a real choice');
 assert.throws(() => shippingServicesPayload({ ...autoDraft, autoDelay: '-5' }), /between 0 and 1440 minutes/);
 assert.throws(() => shippingServicesPayload({ ...autoDraft, autoDelay: 'soon' }), /between 0 and 1440 minutes/);
 assert.throws(() => shippingServicesPayload({ ...autoDraft, autoCap: '-1' }), /daily automatic postage limit/);
 assert.equal(shippingServicesPayload({ ...draft, rows: [{ ...draft.rows[0], markup: '2' }] }).autoLabel, undefined, 'a save that never collected them leaves the stored settings alone');

 // The per-label ceiling: the limit that catches one wrong address quoting a freight rate.
 assert.equal(shippingServicesPayload({ ...autoDraft, autoMax: '50' }).autoLabel.maxLabelCents, 5000);
 assert.equal(shippingServicesPayload({ ...autoDraft, autoMax: '12.50' }).autoLabel.maxLabelCents, 1250, 'cents are kept exactly');
 assert.equal(shippingServicesPayload(autoDraft).autoLabel.maxLabelCents, undefined, 'a page that never collected it leaves the saved ceiling alone');
 assert.throws(() => shippingServicesPayload({ ...autoDraft, autoMax: '0' }), /at least \$1\.00/, 'a ceiling of zero would buy nothing');
 assert.throws(() => shippingServicesPayload({ ...autoDraft, autoMax: '-5' }), /most to spend on one label/);
 assert.throws(() => shippingServicesPayload({ ...autoDraft, autoMax: '5000' }), /most to spend on one label/);
 assert.throws(() => shippingServicesPayload({ ...autoDraft, autoMax: 'lots' }), /most to spend on one label/);

 // The health line: an owner must be able to tell "working", "switched off" and "stopped running" apart.
 const RUN = Date.parse('2026-10-15T12:00:00Z');
 assert.match(autoLabelReport(null, RUN), /No automatic run has reported yet/);
 assert.match(autoLabelReport({ checkedAt: RUN - 60000, status: 'completed', enabled: true, bought: 2, failed: 0, blocked: 0, due: 2, recovered: 0, released: 0, capReached: false }, RUN), /2 labels bought/);
 assert.match(autoLabelReport({ checkedAt: RUN - 60000, status: 'completed', enabled: true, bought: 1, failed: 1, blocked: 1, due: 2, recovered: 0, released: 0, capReached: false }, RUN), /1 label bought, 1 attempt failed, 1 order handed to you/);
 assert.match(autoLabelReport({ checkedAt: RUN - 60000, status: 'disabled', enabled: false, bought: 0, failed: 0, blocked: 0, due: 0, recovered: 0, released: 0, capReached: false }, RUN), /Automatic buying is off/);
 assert.match(autoLabelReport({ checkedAt: RUN - 60000, status: 'cap_reached', enabled: true, bought: 0, failed: 0, blocked: 0, due: 0, recovered: 0, released: 0, capReached: true }, RUN), /daily limit is reached/);
 assert.match(autoLabelReport({ checkedAt: RUN - 60000, status: 'settings_unreadable', enabled: false, bought: 0, failed: 0, blocked: 0, due: 0, recovered: 0, released: 0, capReached: false }, RUN), /Nothing was charged/);
 // A report much older than the five-minute cron means the job itself stopped, which is the silent failure.
 const stale = autoLabelReport({ checkedAt: RUN - 7200000, status: 'completed', enabled: true, bought: 9, failed: 0, blocked: 0, due: 9, recovered: 0, released: 0, capReached: false }, RUN);
 assert.match(stale, /may have stopped/);
 assert(!stale.includes('9 labels bought'), 'a stale report never reads as a healthy run');

 // Saved per-service settings load as saved, including zero extras and custom wording.
 h = mount({ shippingCents: null, freeShippingAt: 0, shippingOptions: { freeStandardEnabled: false, services: [{ key: 'UPS:GROUND', enabled: true, markupCents: 0, label: 'Ground', note: 'Tracked' }] } });
 assert(!text(h.tree).includes('Not set up yet'));
 assert.equal(box(h, 'UPS:GROUND').props.checked, true); assert.equal(box(h, 'USPS:GROUNDADVANTAGE').props.checked, false);
 assert.equal(input(h, 'Name customers see for UPS Ground').props.value, 'Ground'); assert.equal(input(h, 'Extra charge for UPS Ground').props.value, '0');
 assert.equal(button(h, 'Save shipping and check it').props.disabled, true, 'Nothing to save until something changes');
 assert(requests.every(r => r.url === '/api/admin/shipping-services'));
 console.log('PASS: per-service shipping admin: every carrier service listed, legacy starting point, live carrier price + extra = customer price, custom names/notes, exact save payload, per-label ceiling, automatic-run health line, read-back green light, warn/fail never green, validation. Synthetic fetch only.');
})().catch(e => { console.error(e); process.exit(1); });
