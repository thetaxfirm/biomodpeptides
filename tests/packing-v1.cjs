// Shipping boxes and what fits in them. Synthetic items only; no network, no order records.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, deps = {}) {
  const filename = path.join(root, relative), m = new Module(filename, module);
  m.filename = filename;
  m.require = id => { if (deps[id]) return deps[id]; throw Error('Unexpected dependency ' + id); };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
const p = load('lib/packing.ts');

const caps = n => ({ quantity: n, product: { categories: [{ slug: 'softgels' }] } });
const vial = n => ({ quantity: n, product: { categories: [{ slug: 'research-compounds' }] } });
const spray = n => ({ quantity: n, product: { categories: [{ slug: 'spray-products' }] } });

// The capacities the owner counted (Nov 25 2026). These are the measurement, so they are asserted
// as literals: if one of them changes, it changes because somebody counted again.
assert.deepEqual(p.shipBoxes.map(b => [b.id, b.softgels]), [['cube7', 9], ['flat-rate-medium', 15], ['flat-rate-large', 25]]);
assert.deepEqual(p.shipBoxes.map(b => [b.length, b.width, b.height]), [[7, 7, 6], [11, 8.5, 5.5], [12, 12, 5.5]]);
assert.equal(p.largestBox.id, 'flat-rate-large');
// Smallest first, because every choice below walks the list until a box is big enough.
assert.deepEqual([...p.shipBoxes].sort((a, b) => a.softgels - b.softgels).map(b => b.id), p.shipBoxes.map(b => b.id));
// The flat rate names are recorded but unused: quoting a box at its flat rate costs every UPS
// service on the order, and that trade has not been made yet.
assert.equal(p.boxById('flat-rate-medium').usps, 'MediumFlatRateBox');
assert.equal(p.boxById('flat-rate-large').usps, 'LargeFlatRateBox');
assert.equal(p.boxById('cube7').usps, undefined, 'the box we buy ourselves has no USPS name');
assert.equal(p.boxById('nope'), null);
assert.throws(() => { p.shipBoxes.push({}); }, 'the catalog cannot be edited at runtime');

// The smallest box that holds the order, at every boundary.
const chosen = n => p.packSoftgels(n).map(b => b.id);
assert.deepEqual(chosen(1), ['cube7']);
assert.deepEqual(chosen(9), ['cube7'], 'nine fit the 7x7x6 perfectly');
assert.deepEqual(chosen(10), ['flat-rate-medium'], 'one past the cube is a medium, not a second cube');
assert.deepEqual(chosen(15), ['flat-rate-medium']);
assert.deepEqual(chosen(16), ['flat-rate-large']);
assert.deepEqual(chosen(25), ['flat-rate-large']);
assert.deepEqual(chosen(0), [], 'no gel caps, no box');
assert.deepEqual(chosen(-4), []);
assert.deepEqual(chosen(2.7), ['cube7'], 'a fractional count never buys a bigger box');

// Over a large box it splits, filling the large one first and finishing in the smallest box that
// holds the rest -- so the second box is not a half-empty large.
assert.deepEqual(chosen(26), ['flat-rate-large', 'cube7']);
assert.deepEqual(chosen(34), ['flat-rate-large', 'cube7'], 'nine left over still fits the cube');
assert.deepEqual(chosen(35), ['flat-rate-large', 'flat-rate-medium']);
assert.deepEqual(chosen(40), ['flat-rate-large', 'flat-rate-medium'], '25 + 15, not two larges');
assert.deepEqual(chosen(41), ['flat-rate-large', 'flat-rate-large']);
assert.deepEqual(chosen(50), ['flat-rate-large', 'flat-rate-large']);
assert.deepEqual(chosen(51), ['flat-rate-large', 'flat-rate-large', 'cube7']);
// Whatever the count: the boxes hold it, there are as few of them as the largest box allows, and
// the last one is the smallest box the remainder fits in.
for (let n = 1; n <= 200; n += 1) {
  const boxes = p.packSoftgels(n), words = ' (' + n + ' in ' + p.boxesInWords(boxes) + ')';
  assert(boxes.reduce((s, b) => s + b.softgels, 0) >= n, 'does not fit' + words);
  assert.equal(boxes.length, Math.ceil(n / p.largestBox.softgels), 'more boxes than needed' + words);
  const last = boxes[boxes.length - 1], left = n - (boxes.length - 1) * p.largestBox.softgels;
  assert(last.softgels >= left, 'the last box is too small' + words);
  const smaller = p.shipBoxes.filter(b => b.softgels < last.softgels).pop();
  assert(!smaller || smaller.softgels < left, 'a smaller box would have done' + words);
}

// Counting bottles. A pack of three is three bottles: the cart stores the bottle count, not the pack.
assert.equal(p.softgelUnits([caps(3), caps(5)]), 8);
assert.equal(p.softgelUnits([caps(2), vial(10), spray(4)]), 2, 'only gel caps are counted');
assert.equal(p.softgelUnits([]), 0);
assert.equal(p.softgelUnits([{ quantity: 2, product: {} }]), 0, 'a line with no category is not a gel cap');

// A plan is only made for an order that is nothing but gel caps. Everything else keeps the general
// estimate, because nobody has counted how a vial or a spray bottle fills these boxes.
assert.equal(p.packingPlan([caps(1), vial(1)], 5), null, 'mixed with vials: no plan');
assert.equal(p.packingPlan([caps(1), spray(1)], 5), null, 'mixed with sprays: no plan');
assert.equal(p.packingPlan([vial(4)], 5), null);
assert.equal(p.packingPlan([], 5), null);
assert.equal(p.packingPlan([caps(0)], 5), null, 'an empty gel cap line is not an order');

// Weight is every box plus every bottle, and the bottle weight is the store's own setting.
const nine = p.packingPlan([caps(9)], 5);
assert.deepEqual(nine.boxes.map(b => b.id), ['cube7']);
assert.equal(nine.units, 9);
assert.equal(nine.ounces, 50, '5oz box + 9 bottles at 5oz');
assert.equal(nine.split, false);
assert.equal(p.packingPlan([caps(9)], 6).ounces, 59, 'a heavier bottle setting is used');
assert.equal(p.packingPlan([caps(9)], 0).ounces, 50, 'a nonsense bottle weight falls back to 5oz');
assert.equal(p.packingPlan([caps(9)], NaN).ounces, 50);
const forty = p.packingPlan([caps(40)], 5);
assert.equal(forty.split, true, '40 needs two boxes and one label cannot cover it');
assert.equal(forty.ounces, 210, 'large 6oz + medium 4oz + 40 bottles at 5oz');

// One parcel standing for the plan. A single box is itself.
assert.deepEqual(p.planParcel(nine), { length: 7, width: 7, height: 6, weight: 50 });
assert.deepEqual(p.planParcel(p.packingPlan([caps(15)], 5)), { length: 11, width: 8.5, height: 5.5, weight: 79 });
assert.deepEqual(p.planParcel(p.packingPlan([caps(25)], 5)), { length: 12, width: 12, height: 5.5, weight: 131 });
// Several boxes are quoted as the stack they make: same footprint, heights added. The price then
// climbs with the second box instead of pretending one box took the lot.
assert.deepEqual(p.planParcel(forty), { length: 12, width: 12, height: 11, weight: 210 });
assert.deepEqual(p.planParcel(p.packingPlan([caps(26)], 5)), { length: 12, width: 12, height: 11.5, weight: 141 });

// The words a packer reads. Repeats are counted, not listed twice.
assert.equal(p.boxesInWords(p.packSoftgels(9)), '1 x 7x7x6 box');
assert.equal(p.boxesInWords(p.packSoftgels(40)), '1 x USPS Large Flat Rate + 1 x USPS Medium Flat Rate');
assert.equal(p.boxesInWords(p.packSoftgels(50)), '2 x USPS Large Flat Rate');
assert.equal(p.boxesInWords(p.packSoftgels(51)), '2 x USPS Large Flat Rate + 1 x 7x7x6 box');
assert.equal(p.boxesInWords([]), '');

console.log('PASS: box capacities, smallest box that fits, splitting over a large box, gel-cap-only plans, weights and the packing words');
