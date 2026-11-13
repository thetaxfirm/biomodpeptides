// Restaurant partner slots (owner, Nov 13 2026): twenty fixed slots, a name becomes a link and a
// code, and nothing prices an order until the owner switches it on. Pure functions; no I/O.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name;
  m.require = id => id.startsWith('./') ? load('lib/' + id.slice(2) + '.ts') : (() => { throw Error('Unexpected dependency ' + id); })();
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, name);
  return m.exports;
}
const P = load('lib/restaurant-partners.ts');
const built = load('lib/promo-codes.ts').builtInCodes();

// --- A name and its discount become one code, and the link is that code ---
assert.equal(P.codeFromName("Mario's Pizza", 1, 15), 'MARIOSPIZZA15');
assert.equal(P.codeFromName('The Keg & Grill', 2, 10), 'THEKEGGRILL10');
assert.equal(P.codeFromName('Café Rio', 3, 20), 'CAFRIO20', 'an accent is not a code character');
assert.equal(P.codeFromName('', 3, 15), '', 'no name, no code');
assert.equal(P.codeFromName('Mario', 1, 0), 'MARIO', 'before a discount is set the code is the name alone');
assert.equal(P.codeFromName('Jo', 4, 15), 'JO15', 'a short name plus its discount already clears the floor');
assert.equal(P.codeFromName('Jo', 4, 0), 'JOEAT4', 'a short name with no discount still gets a usable code');
assert.equal(P.codeFromName('x'.repeat(80), 5, 15).length, 40, 'codes are capped at the store limit');
assert(P.codeFromName('x'.repeat(80), 5, 15).endsWith('15'), 'and the discount survives the cut');
assert(/^[A-Z0-9]{3,40}$/.test(P.codeFromName("Mario's Pizza", 1, 15)), 'and always satisfy the store code rule');
assert.equal(P.slugFromCode('MARIOSPIZZA15'), 'mariospizza15', 'the link is the code in lower case');

// --- Always exactly twenty slots, in order ---
const empty = P.normalizePartners(null);
assert.equal(empty.length, 20); assert.equal(P.PARTNER_SLOTS, 20);
assert.deepEqual(empty.map(r => r.slot), Array.from({ length: 20 }, (_, i) => i + 1));
assert(empty.every(r => !r.name && !r.code && !r.active && r.percentOff === 0));
assert.equal(P.normalizePartners('nonsense').length, 20, 'a corrupt row is twenty empty slots, not a crash');
assert.equal(P.normalizePartners([{ slot: 99, name: 'Out of range' }]).length, 20);
assert(P.normalizePartners([{ slot: 99, name: 'Out of range' }]).every(r => !r.name), 'a slot number outside the range is ignored');

// --- Filling a slot derives both, and leaves the others alone ---
const one = P.normalizePartners([{ slot: 3, name: "Mario's Pizza", percentOff: 12, active: true, updated: 5, by: 'logan@x' }]);
assert.equal(one[2].name, "Mario's Pizza");
assert.equal(one[2].code, 'MARIOSPIZZA12'); assert.equal(one[2].slug, 'mariospizza12', 'the link is the code');
assert.equal(one[2].percentOff, 12); assert.equal(one[2].active, true);
assert.equal(one[2].by, 'logan@x'); assert.equal(one[2].updated, 5);
assert(one.filter(r => r.name).length === 1, 'the other nineteen stay empty');

// --- Nothing prices an order until the slot is complete AND switched on ---
const partial = P.normalizePartners([
  { slot: 1, name: 'No Discount Yet', active: true },
  { slot: 2, name: 'Ready', percentOff: 10, active: true },
  { slot: 3, name: 'Complete But Off', percentOff: 10, active: false },
]);
assert.equal(partial[0].active, false, 'switched on without a discount is not switched on');
assert.equal(P.slotReady(partial[0]), false);
assert.equal(partial[1].active, true); assert.equal(partial[2].active, false);
assert.deepEqual(P.livePartnerCodes(partial), [{ code: 'READY10', percentOff: 10 }], 'only a complete, switched-on slot offers a code');
assert.deepEqual(P.livePartnerCodes(P.normalizePartners([])), []);

// --- Two restaurants cannot collide, and neither can shadow a store code ---
const clash = P.normalizePartners([
  { slot: 1, name: 'Rio', percentOff: 5, active: true },
  { slot: 2, name: 'Rio', percentOff: 5, active: true },
  { slot: 3, name: 'Rio', percentOff: 5, active: true },
]);
// A letter, not a number: RIO5 followed by RIO52 would read as fifty-two per cent.
assert.deepEqual(clash.slice(0, 3).map(r => r.code), ['RIO5', 'RIO5B', 'RIO5C']);
assert.deepEqual(clash.slice(0, 3).map(r => r.slug), ['rio5', 'rio5b', 'rio5c']);
assert.equal(new Set(clash.slice(0, 3).map(r => r.code)).size, 3, 'three distinct codes');
// Built from the real built-in list, so it stays a genuine collision as that list changes: a
// built-in like BIOMOD15 is exactly what a restaurant called Biomod at 15% would produce.
const collidable = built.map(c => /^([A-Z]+)(\d{1,2})$/.exec(c)).find(Boolean);
assert(collidable, 'at least one built-in code is a word followed by its discount');
const reserved = P.normalizePartners([{ slot: 1, name: collidable[1], percentOff: Number(collidable[2]), active: true }]);
assert.equal(P.codeFromName(collidable[1], 1, Number(collidable[2])), collidable[0], 'the name and discount really do produce that code');
assert.equal(reserved[0].code, '', 'a code matching a built-in store code is dropped, never renamed');
assert.equal(reserved[0].slug, '', 'and with no code there is no link');
assert.equal(reserved[0].active, false, 'so that slot cannot go live');
assert.deepEqual(P.livePartnerCodes(reserved), []);

// --- The vanity link resolves only for a live slot ---
const live = P.normalizePartners([
  { slot: 1, name: "Mario's Pizza", percentOff: 12, active: true },
  { slot: 2, name: 'Sleeping Dog Diner', percentOff: 12, active: false },
]);
assert.equal(P.partnerCodeForSlug(live, 'mariospizza12'), 'MARIOSPIZZA12');
assert.equal(P.partnerCodeForSlug(live, 'MARIOSPIZZA12'), 'MARIOSPIZZA12', 'links are not case sensitive');
assert.equal(P.partnerCodeForSlug(live, 'sleepingdogdiner12'), '', 'a switched-off slot does not resolve');
assert.equal(P.partnerCodeForSlug(live, 'nobody'), '');
assert.equal(P.partnerCodeForSlug(live, ''), '');
assert.equal(P.partnerCodeForSlug(live, null), '');

// --- Stored text is untrusted ---
assert.equal(P.parsePartners('{broken').filter(r => r.name).length, 0, 'unparseable text is empty slots');
assert.equal(P.parsePartners(null).length, 20);
assert.equal(P.parsePartners(JSON.stringify([{ slot: 1, name: 'Olive', percentOff: 10, active: true }]))[0].code, 'OLIVE10');
assert.equal(P.parsePartners(JSON.stringify([{ slot: 1, name: 'Ok', percentOff: 10, active: true }]))[0].code, 'OK10', 'a two-letter name plus its discount clears the code floor');
const nasty = P.normalizePartners([{ slot: 1, name: 'Bad\u0000Name\r\nHere', percentOff: 10, active: true }]);
assert.equal(nasty[0].name, 'Bad Name Here', 'control characters never survive into a name');
assert(!/[\u0000-\u001f]/.test(nasty[0].name));
assert.equal(P.normalizePartners([{ slot: 1, name: 'Over', percentOff: 999, active: true }])[0].percentOff, 0, 'a discount outside the store limit is refused');
assert.equal(P.normalizePartners([{ slot: 1, name: 'Over', percentOff: 999, active: true }])[0].active, false);
assert.equal(P.normalizePartners([{ slot: 1, name: 'Frac', percentOff: 10.5, active: true }])[0].percentOff, 0, 'and so is a fractional one');

console.log('PASS: twenty fixed restaurant slots; a name and its discount become one code that is also the link; collisions separate; a built-in store code is never shadowed; a slot prices nothing until it is complete and switched on; stored text is untrusted throughout.');
