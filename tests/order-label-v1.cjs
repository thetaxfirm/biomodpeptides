// Label and delivery on every order and every customer view (owner, Nov 8 2026).
// Synthetic fixtures only; no database, carrier, payment or customer data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
let apiCalls = [];
function load(file) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name; m.paths = Module._nodeModulePaths(root);
  m.require = id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (id === './provider') return { api: (...args) => { apiCalls.push(args); return new Promise(() => {}); } };
    if (id === '@/lib/catalog') return { money: n => '$' + (n / 100).toFixed(2) };
    if (id.startsWith('@/lib/')) return load('lib/' + id.slice(6) + '.ts');
    if (file.startsWith('lib/') && id.startsWith('./')) return load('lib/' + id.slice(2) + '.ts');
    throw Error('Unexpected dependency ' + id + ' in ' + file);
  };
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { module: 1, target: 9, jsx: 4, esModuleInterop: true } }).outputText, name);
  return m.exports;
}
const { labelSummary, nextStepWords } = load('lib/order-label.ts');
const order = (status, data = {}) => ({ id: 'fixture-' + status, status, total: 1000, created: 1, data: { email: 'fixture@example.invalid', items: [{ quantity: 2, product: { name: 'Fixture vial' } }], ...data } });
const shipment = (extra = {}) => ({ service: 'USPS Priority', tracking: '9400FIXTURE', labelUrl: 'https://example.invalid/label.png', trackingUrl: 'https://example.invalid/track', signature: 'SIGNATURE', insuredCents: 5000, ...extra });

// A bought label: where to open it, what it carries, and what the carrier last said.
const failed = labelSummary(order('shipped', { labelCreatedAt: 1000, shipment: shipment({ status: 'failure', checkedAt: 2000 }) }));
assert.equal(failed.state, 'bought');
assert.equal(failed.labelUrl, 'https://example.invalid/label.png');
assert.equal(failed.trackingUrl, 'https://example.invalid/track');
assert.equal(failed.protection, 'Insured $50.00 · Signature required');
assert.equal(failed.carrier, 'Delivery failed'); assert.equal(failed.problem, true); assert.equal(failed.delivered, false);
assert.equal(failed.boughtAt, 1000); assert.equal(failed.carrierAt, 2000);
assert.equal(nextStepWords(order('shipped', { shipment: shipment({ status: 'failure' }) })), 'Carrier could not deliver. Call the carrier and contact the customer');
const done = labelSummary(order('delivered', { shipment: shipment({ status: 'delivered', checkedAt: 3000 }) }));
assert.equal(done.delivered, true); assert.equal(done.problem, false);
assert.equal(nextStepWords(order('delivered', { shipment: shipment({ status: 'delivered' }) })), 'Delivered. Nothing to do');
assert.equal(labelSummary(order('paid', { shipment: shipment({ labelUrl: 'javascript:alert(1)' }) })).labelUrl, null, 'Only https label links are offered');
assert.equal(nextStepWords(order('paid', { shipment: shipment() })), 'Pack, drop off, then mark Dropped off');

// No label: said plainly, and "Missing" only where a paid order should have one.
assert.deepEqual(labelSummary(order('paid')), { state: 'missing', words: 'No label bought yet' });
assert.equal(labelSummary(order('shipped')).state, 'missing', 'Shipped with neither a label nor tracking on file');
assert.deepEqual(labelSummary(order('shipped', { tracking: ' 1Z-FIXTURE ' })), { state: 'manual', words: 'No store label. Shipped by hand', tracking: '1Z-FIXTURE' });
assert.equal(labelSummary(order('labeling')).state, 'buying');
assert.equal(labelSummary(order('awaiting_payment')).state, 'none');
assert.equal(nextStepWords(order('paid')), 'Buy the label and ship');
assert.equal(nextStepWords(order('awaiting_payment')), 'Payment not confirmed. Check payment');
assert.equal(nextStepWords(order('refunded', { shipment: shipment({ status: 'failure' }) })), 'Closed. Nothing to do');
assert.equal(nextStepWords(order('paid', { hold: { issue: 'out_of_stock' } })), 'On hold. Solve the problem, then clear the hold');

// The Label cell as staff see it.
const { LabelCell, CustomerOrders } = load('components/store/customer-orders.tsx');
const html = o => renderToStaticMarkup(React.createElement(LabelCell, { order: { ...o, bucket: 'shipped' } }));
const bought = html(order('shipped', { labelCreatedAt: Date.UTC(2026, 9, 28, 20), shipment: shipment({ status: 'failure', checkedAt: Date.UTC(2026, 10, 2, 15) }) }));
assert.match(bought, /href="https:\/\/example.invalid\/label.png"[^>]*>View label</);
assert.match(bought, />Track</); assert.match(bought, /USPS Priority · 9400FIXTURE/); assert.match(bought, /Signature required/); assert.match(bought, /Delivery failed/);
assert.match(bought, /rel="noopener noreferrer"/);
assert.match(html(order('paid')), /<strong>Missing<\/strong>.*No label bought yet/);
assert.doesNotMatch(html(order('awaiting_payment')), /Missing/);

// Customer orders: looked up by the email in a POST body, never in the URL.
apiCalls = [];
const loading = renderToStaticMarkup(React.createElement(CustomerOrders, { email: ' Fixture@Example.invalid ', currentId: 'fixture-paid' }));
assert.match(loading, /Orders from this customer/); assert.match(loading, /Loading orders/);
const source = fs.readFileSync(path.join(root, 'components/store/customer-orders.tsx'), 'utf8');
assert.match(source, /\['all', 'archived', 'test'\]\.map\(tab => api\('admin-orders', \{ tab, q: address \}\)/);
assert.match(source, /String\(o\.data\?\.email \|\| ''\)\.trim\(\)\.toLowerCase\(\) === address/, 'Only exact email matches are listed');
for (const term of ['Customer', 'Items', 'Payment', 'Shipment', 'Label', 'Last contact recorded', 'Next step']) assert(source.includes('<dt>' + term + '</dt>'), term);
assert.match(source, /className=\{styles\.total\}>\{money\(/, 'Order total on every block');

// Wiring: the Orders table has a Label column, the order panel and the reply desk show the customer's orders.
const ui = fs.readFileSync(path.join(root, 'components/store/orders-admin.tsx'), 'utf8');
assert.match(ui, /<th>Shipment<\/th><th>Label<\/th><th>Last contact recorded<\/th>/);
assert.match(ui, /<td data-label="Label"><LabelCell order=\{o\}\/><\/td>/);
assert.match(ui, /<CustomerOrders email=\{String\(selected\.data\?\.email \|\| ''\)\} currentId=\{selected\.id\} onOpen=\{setSelected\}\/>/);
const desk = fs.readFileSync(path.join(root, 'components/store/request-inbox.tsx'), 'utf8');
assert.match(desk, /\{canReply && <CustomerOrders email=\{email\}\/>\}/);
console.log('PASS: label and delivery summary, Missing only for paid orders, https-only label links, Label column, customer orders in the order panel and reply desk');
