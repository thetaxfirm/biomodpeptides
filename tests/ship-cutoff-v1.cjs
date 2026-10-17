/* Same-day dispatch tracker (lib/ship-cutoff.ts), queue counts and the new-order email line.
 * Synthetic orders only; no network, database, provider or customer data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, f);
const { dueDay, isBusinessDay, federalHolidays, nextBusinessDay, shipDue, isOut, pacific } = require('../lib/ship-cutoff.ts');
const { queryOrders } = require('../lib/order-queue.ts');
const { shipByLine, orderEmailHtml } = require('../lib/order-summary.ts');

// Pacific wall-clock time to a moment (PDT before Nov 1 2026, PST after).
const pt = (iso, offset) => Date.parse(iso + offset);
const pdt = iso => pt(iso, '-07:00'), pst = iso => pt(iso, '-08:00');

// Federal holidays, observed dates.
const h26 = federalHolidays(2026);
for (const day of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25']) assert(h26.has(day), day);
assert(federalHolidays(2027).has('2027-07-05'), 'July 4 2027 is a Sunday, observed Monday');
assert(federalHolidays(2027).has('2027-12-24') && federalHolidays(2027).has('2027-12-31'), 'Christmas and New Year 2028 fall on Saturday, observed Friday');
assert(!isBusinessDay('2026-10-17') && !isBusinessDay('2026-10-18'), 'weekend');
assert(isBusinessDay('2026-10-19'));
assert.equal(nextBusinessDay('2026-11-25'), '2026-11-27', 'Thanksgiving skipped');

// The 2 p.m. Pacific boundary, in daylight and standard time.
assert.equal(dueDay(pdt('2026-10-19T13:59:00')), '2026-10-19', 'Monday 1:59 p.m. goes out Monday');
assert.equal(dueDay(pdt('2026-10-19T14:00:00')), '2026-10-20', 'Monday 2:00 p.m. goes out Tuesday');
assert.equal(dueDay(pst('2026-11-02T13:30:00')), '2026-11-02', 'standard time');
assert.equal(dueDay(pdt('2026-10-16T15:00:00')), '2026-10-19', 'Friday afternoon goes out Monday');
assert.equal(dueDay(pdt('2026-10-17T09:00:00')), '2026-10-19', 'Saturday goes out Monday');
assert.equal(dueDay(pst('2026-11-25T15:00:00')), '2026-11-27', 'after the cutoff the day before Thanksgiving goes out Friday');
assert.equal(dueDay(pst('2026-11-26T10:00:00')), '2026-11-27', 'Thanksgiving morning goes out Friday');
assert.equal(dueDay(Date.parse('2026-10-19T22:30:00Z')), '2026-10-20', 'UTC evening is 3:30 p.m. Pacific');
assert.equal(pacific(Date.parse('2026-10-20T06:30:00Z')).day, '2026-10-19', 'Pacific calendar day, not UTC');

// Which orders are tracked, and their state.
const monMorning = pdt('2026-10-19T09:00:00');
const order = (over = {}) => ({ id: 'o' + Math.random().toString(16).slice(2, 10).padEnd(8, '0'), status: 'paid', total: 5000, created: monMorning, data: { items: [{ quantity: 1, product: { name: 'Synthetic vial' } }] }, ...over });
assert.deepEqual(shipDue(order(), pdt('2026-10-19T10:00:00')), { state: 'today', due: '2026-10-19', label: 'Must go out today' });
assert.equal(shipDue(order(), pdt('2026-10-19T16:30:00')).state, 'today', 'still today after the cutoff passes');
assert.equal(shipDue(order(), pdt('2026-10-20T08:00:00')).label, 'Late: was due Mon, Oct 19');
assert.equal(shipDue(order({ created: pdt('2026-10-19T15:00:00') }), pdt('2026-10-19T15:05:00')).label, 'Goes out Tue, Oct 20');
const labelled = order({ data: { ...order().data, shipment: { status: 'pre_transit' }, labelCreatedAt: monMorning } });
assert.equal(shipDue(labelled, pdt('2026-10-19T12:00:00')).state, 'today', 'a bought label is not out');
for (const [why, o] of [
  ['dropped off', order({ data: { ...labelled.data, handoff: { at: monMorning + 3600000, by: 'staff' } } })],
  ['carrier scanned', order({ data: { ...labelled.data, shipment: { status: 'in_transit' } } })],
  ['marked shipped', order({ status: 'shipped' })],
  ['unpaid', order({ status: 'awaiting_payment' })],
  ['refunded', order({ status: 'refunded' })],
  ['held', order({ data: { ...order().data, hold: { reason: 'synthetic' } } })],
  ['internal test', order({ data: { ...order().data, internalTest: true } })],
  ['archived', order({ data: { ...order().data, archivedAt: monMorning } })],
  ['preorder', order({ data: { items: [{ quantity: 1, product: { name: 'Synthetic', activePreorder: { percentOff: 10, ships: 'early November 2026', basePrice: 5000 } } }] } })],
]) assert.equal(shipDue(o, pdt('2026-10-19T10:00:00')), null, why);
assert(isOut(order({ data: { handoff: { at: 1 } } })) && !isOut(labelled));

// Queue counts cover every tab, independent of the open one.
const rows = [order(), order(), order({ created: pdt('2026-10-16T10:00:00') }), order({ created: pdt('2026-10-19T15:00:00') }), order({ status: 'shipped' })];
for (const tab of ['to_ship', 'delivered', 'all']) assert.deepEqual(queryOrders(rows, { tab }, pdt('2026-10-19T10:00:00')).mustGoOut, { today: 2, late: 1 }, tab);

// The new-order email says when to ship; preorders keep their own notice.
const data = order().data;
assert.deepEqual(shipByLine(data, monMorning, pdt('2026-10-19T09:01:00')), { today: true, text: 'Ship today: placed before the 2 p.m. Pacific cutoff.' });
assert.match(shipByLine(data, pdt('2026-10-16T15:00:00'), pdt('2026-10-16T15:01:00')).text, /^Ship by Monday, October 19: placed after the 2 p\.m\. Pacific cutoff/);
assert.equal(shipByLine({ items: [{ quantity: 1, product: { activePreorder: { percentOff: 10, ships: 'soon', basePrice: 100 } } }] }, monMorning), null);
assert.match(orderEmailHtml('synthetic-order', { ...data, total: 5000 }, Date.now()), /Ship (today|by)/);
const source = fs.readFileSync(require.resolve('../lib/order-summary.ts'), 'utf8');
assert.match(source, /subject: \(shipByLine\(data, placedAt\)\?\.today \? 'SHIP TODAY · ' : ''\) \+ 'New order '/);
assert.match(fs.readFileSync(require.resolve('../lib/checkout.ts'), 'utf8'), /sendOrderNotification\(runtime\(\), id, saved, row\.created\)/);
console.log('PASS: 2 p.m. Pacific cutoff with weekends, federal holidays and DST; only paid, in-stock, unheld orders not yet with the carrier are tracked; queue counts and the new-order email agree');
