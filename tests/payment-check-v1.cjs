// Payment detail on the Orders screen (owner, Oct 23 2026): what Authorize.net said about each card
// attempt, in plain words, and the owner-only Approve/Decline for a held payment.
// Synthetic fixtures only; no database, provider, payment or customer data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative) {
  const filename = path.join(root, relative), m = new Module(filename, module);
  m.filename = filename;
  m.require = id => { throw Error('Unexpected dependency ' + id); };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
const p = load('lib/payment-check.ts');
const submitted = Date.parse('2026-10-22T23:26:11Z');
const held = {
  transId: '10000000001', transactionStatus: 'FDSAuthorizedPendingReview', transactionType: 'authCaptureTransaction', submitTimeUTC: '2026-10-22T23:26:11.000Z',
  authAmount: 16.68, responseReasonDescription: 'This transaction has been approved.', AVSResponse: 'Y', cardCodeResponse: 'M',
  payment: { creditCard: { cardNumber: 'XXXX1111', cardType: 'Visa' } },
  FDSFilters: [{ name: 'Amount Filter', action: 'authAndHold' }],
  customerIP: '203.0.113.9',
};
const declined = { transId: '10000000002', transactionStatus: 'declined', transactionType: 'authCaptureTransaction', submitTimeUTC: '2026-10-22T20:00:00Z', authAmount: 16.68, responseReasonDescription: 'This transaction has been declined.', AVSResponse: 'N', cardCodeResponse: 'N', payment: { creditCard: { cardNumber: 'XXXX2222', cardType: 'MasterCard' } } };

// Facts are kept, in plain words; no IP or full card number is stored.
const check = p.paymentCheck([declined, held, { junk: true }], submitted + 1000);
assert.equal(check.attempts.length, 2, 'malformed transactions are ignored');
const a = check.attempts[0];
assert.equal(a.transId, '10000000001', 'newest attempt first');
assert.equal(a.kind, 'held');
assert.equal(a.card, 'Visa ending 1111');
assert.equal(a.amountCents, 1668);
assert.deepEqual(a.filters, [{ name: 'Amount Filter', action: 'authAndHold' }]);
assert.equal(a.avs, 'Street and ZIP match');
assert.equal(a.cvv, 'Security code matches');
assert.ok(!JSON.stringify(check).includes('203.0.113.9'), 'customer IP is never saved');
assert.equal(check.attempts[1].kind, 'declined');
assert.equal(check.holdExpiresAt, submitted + 5 * 86400000, 'a hold lapses 5 days after the card attempt');

// The table line says what happened and by when to act.
const line = p.paymentLine(check, submitted + 1000);
assert.match(line, /^Card approved, held by fraud filter: Amount Filter · Approve in Authorize\.net by /);
assert.match(line, /2 card attempts$/);
assert.match(p.paymentLine(check, submitted + 6 * 86400000), /Hold has probably expired/);
assert.match(p.paymentAdvice(check, submitted), /transaction 10000000001/);
assert.equal(p.paymentLine(p.paymentCheck([declined])), 'Card declined: This transaction has been declined.');
assert.match(p.paymentLine(p.paymentCheck([])), /^No card payment at Authorize\.net yet/);
assert.equal(p.paymentLine(null), '');
assert.equal(p.savedPaymentCheck({ at: 'x' }), null, 'malformed saved data reads as no check');
assert.equal(p.paymentAttempt({ ...held, transactionStatus: 'settledSuccessfully' }).kind, 'paid');

// Wiring: reconcile saves the facts, the webhook saves declines, and Approve/Decline is owner-only.
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
assert.match(read('lib/checkout.ts'), /json_set\(data,'\$\.paymentCheck',json\(\?\)\)/);
assert.match(read('app/api/payments/authorizenet/route.ts'), /paymentCheck\(\[details\]\)/);
const route = read('app/api/store/[action]/route.ts');
assert.match(route, /action === 'admin-payment-hold'/);
assert.ok(!/'admin-payment-hold':/.test(route), 'not in adminActionPermission, so only an owner may approve or decline');
const anet = read('lib/authorizenet-payments.ts');
assert.match(anet, /updateHeldTransactionRequest/);
assert.match(anet, /if \(!PENDING\.has\(String\(current\.transactionStatus/, 'only a transaction still held can be approved');
assert.match(anet, /invoiceNumber !== anetOrderReference\(order\.id\)/, 'only a transaction on this order');
const ui = read('components/store/orders-admin.tsx');
assert.match(ui, /owner=\{allowed\('team:manage'\)\}/);
assert.match(ui, /change\('payment-hold'/);
console.log('payment check v1: ok');
