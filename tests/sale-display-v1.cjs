/* Actual sale model, React component functions, provider effects and Offer schema.
 * Deterministic hook/timer fixtures; no network, database, customer or provider calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
let active, now = Date.parse('2026-11-10T00:00:00Z'), nextTimer = 0;
const timers = new Map(), listeners = new Map(), hosts = [];
const realNow = Date.now, realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout;
const realSetInterval = global.setInterval, realClearInterval = global.clearInterval;
Date.now = () => now;
const schedule = (fn, delay, repeat) => { const id = ++nextTimer; timers.set(id, {fn, at: now + delay, delay, repeat}); return id; };
global.setTimeout = (fn, delay) => schedule(fn, delay, false);
global.setInterval = (fn, delay) => schedule(fn, delay, true);
global.clearTimeout = global.clearInterval = id => timers.delete(id);
global.document = { visibilityState: 'visible', addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); } };
const hooks = { ...React,
 useState(initial) { const h = active, i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], value => { const next = typeof value === 'function' ? value(h.slots[i]) : value; if (!Object.is(next, h.slots[i])) { h.slots[i] = next; h.dirty = true; } }]; },
 useRef(initial) { const h = active, i = h.cursor++; if (!(i in h.slots)) h.slots[i] = {current: initial}; return h.slots[i]; },
 useEffect(fn, deps) { const h = active, i = h.cursor++, old = h.slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old[n]))) { h.slots[i] = deps; h.effects.push(() => { h.cleanups[i]?.(); h.cleanups[i] = fn(); }); } },
};
function harness(component, effects = true) {
 const h = {slots: [], cleanups: [], cursor: 0, effects: [], dirty: false, tree: null,
  render() { for (let attempt = 0; attempt < 25; attempt++) { this.cursor = 0; this.effects = []; this.dirty = false; active = this; this.tree = component(); if (effects) for (const effect of this.effects) effect(); if (!this.dirty) return this.tree; } throw Error('Fixture render loop'); },
  unmount() { this.cleanups.forEach(cleanup => cleanup?.()); this.cleanups = []; },
 }; hosts.push(h); h.render(); return h;
}
function text(tree) { if (tree == null || typeof tree === 'boolean') return ''; if (Array.isArray(tree)) return tree.map(text).join(' ').replace(/\s+/g, ' ').trim(); return typeof tree === 'object' ? text(tree.props?.children) : String(tree); }
function nodes(tree, out = []) { if (Array.isArray(tree)) tree.forEach(child => nodes(child, out)); else if (tree && typeof tree === 'object' && tree.props) { out.push(tree); nodes(tree.props.children, out); } return out; }
function advance(to, host) { now = to; for (const [id, timer] of [...timers]) if (timer.at <= now && timers.has(id)) { if (timer.repeat) timers.set(id, {...timer, at: now + timer.delay}); else timers.delete(id); timer.fn(); } host?.render(); }
function reset() { for (const h of hosts.splice(0)) h.unmount(); assert.equal(timers.size, 0, 'Every timer is cleaned up'); assert([...listeners.values()].every(set => set.size === 0), 'Every visibility listener is cleaned up'); }
const noop = () => null, reports = [], cache = new Map();
let schemaSnapshot;
const schemaEnv = {SEO_PUBLIC_ORIGIN: 'https://trybiomod.com', SEO_PUBLIC_LAUNCH_APPROVED: 'true', SEO_INDEXING_ENABLED: 'true'};
function load(relative) {
 if (cache.has(relative)) return cache.get(relative).exports;
 const filename = path.join(root, relative), mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(root); cache.set(relative, mod);
 mod.require = id => {
  if (id === 'react') return hooks;
  if (id === 'react/jsx-runtime') return require(id);
  if (id === 'sonner') return {toast: {success: noop, error: value => reports.push(value), info: noop}, Toaster: noop};
  if (id.endsWith('.module.css')) return {__esModule: true, default: new Proxy({}, {get: (_, key) => key})};
  if (id === '@/lib/shopping-measurement') return {measureShoppingStage: noop, watchShoppingView: () => noop, validShoppingQuote: noop, validShoppingHandoff: noop};
  if (relative === 'lib/seo.ts') {
   if (id === './runtime') return {runtime: () => schemaEnv};
   if (id === './public-catalog') return {publicCatalog: async () => schemaSnapshot};
   if (id === './merchant-policies') return {merchantPolicies: async () => ({hasMerchantReturnPolicy: {'@id': 'https://trybiomod.com/returns-refunds#policy'}})};
   if (id === 'next/headers') return {headers: async () => new Map([['host', 'trybiomod.com']])};
  }
  if (id.startsWith('@/lib/') || id.startsWith('.')) {
   const target = id.startsWith('@/') ? id.slice(2) : path.relative(root, path.resolve(path.dirname(filename), id));
   if (target.endsWith('.json')) return JSON.parse(fs.readFileSync(path.join(root, target), 'utf8'));
   assert(target.startsWith('lib/'), 'Unexpected dependency: ' + target); return load(target + '.ts');
  }
  throw Error('Unexpected dependency: ' + id);
 };
 mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText, filename); return mod.exports;
}
const {products} = load('lib/catalog.ts');
const {applySale} = load('lib/sales.ts');
const {saleRemaining, nextSaleBoundary} = load('lib/sale-display.ts');
const {SaleNotice} = load('components/store/sale-notice.tsx');
const {StoreProvider} = load('components/store/provider.tsx');
const start = Date.parse('2026-11-10T01:00:00Z'), end = start + 86400000 + 3661000;
const product = {...products.find(p => p.slug === 'bpc-157-10mg'), price: 5000, packPrices: {3: 13500}, preorder: null, inStock: true, purchasable: true, stockQuantity: 100, sale: {enabled: true, percentOff: 20, starts: new Date(start).toISOString(), ends: new Date(end).toISOString()}};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const snapshot = current => ({products: current, config: {packDiscounts: {3: 10}}, cart: [], cartConflict: null, wishlist: [], savedPacks: [], customer: null, authReady: false, googleReady: false, admin: false, payment: {enabled: false, state: 'test'}, totals: null, cartError: '', campaigns: []});
let failedRead = false, calls = [], stateFixture = () => snapshot([applySale(product, now)]), cartFixture = null;
global.fetch = async (url, options) => {
 assert(['/api/store/state', '/api/store/auth-refresh'].includes(url) || (url === '/api/store/cart' && cartFixture), 'No network or purchase call permitted: ' + url); calls.push(url);
 if (url === '/api/store/state' && failedRead) throw Error('Isolated connection failure');
 return {ok: true, json: async () => url.endsWith('/state') ? stateFixture() : url.endsWith('/cart') ? cartFixture(JSON.parse(options.body)) : {}};
};
(async () => {
 try {
  assert.deepEqual(saleRemaining(new Date(end).toISOString(), start), {expired: false, days: 1, hours: 1, minutes: 1, seconds: 1});
  assert.equal(saleRemaining(new Date(end).toISOString(), end - 1).seconds, 1, 'A fractional final second cannot prematurely expire an offer');
  assert.equal(saleRemaining(new Date(end).toISOString(), end).expired, true);
  assert.equal(saleRemaining('invalid', now), null); assert.equal(saleRemaining(product.sale.ends, NaN), null);
  assert.equal(nextSaleBoundary([product], start - 1), start);
  assert.equal(nextSaleBoundary([product], start), end);
  assert.equal(nextSaleBoundary([product], end), null);
  assert.equal(nextSaleBoundary([{...product, sale: {...product.sale, enabled: false}}], start - 1), null);
  assert.equal(nextSaleBoundary([{...product, preorder: {enabled: true, percentOff: 15, ships: 'early November 2026'}}], start - 1), null, 'Preorder takes priority; its paused sale gets no start/end timer');
  assert.equal(nextSaleBoundary([{...product, sale: {...product.sale, starts: 'invalid', ends: 'invalid'}}], now), null);

  now = start;
  let shown = applySale(product, now);
  const server = harness(() => SaleNotice({product: shown}), false);
  assert(text(server.tree).includes('Ends 2026-11-11 02:01 UTC'));
  assert(nodes(server.tree).some(n => n.type === 'time' && n.props.dateTime === product.sale.ends), 'SSR exposes the real deadline before effects');
  assert.equal(timers.size, 0);
  const notice = harness(() => SaleNotice({product: shown, compact: true}));
  assert.match(text(notice.tree), /20\s*% off/);
  const timerNode = nodes(notice.tree).find(n => n.props.role === 'timer'); assert(timerNode); assert.equal(timerNode.props['aria-live'], 'off', 'Seconds do not repeatedly interrupt screen readers');
  assert(text(notice.tree).includes('1 d 01 h 01 m 01 s'));
  assert.equal(notice.tree.props['data-compact'], true);
  advance(end - 1000, notice); assert(text(notice.tree).includes('00 h 00 m 01 s'));
  advance(end, notice); assert.equal(notice.tree, null, 'Expired offer disappears exactly at its end');
  reset();
  now = end;
  const remounted = harness(() => SaleNotice({product: shown})); assert.equal(remounted.tree, null, 'Reload cannot restart an expired countdown'); reset();

  now = start; shown = applySale(product, now);
  for (const patch of [{inStock: false}, {purchasable: false}, {activePreorder: {percentOff: 15, ships: 'later', basePrice: 5000}}, {activeSale: undefined}, {activeSale: {...shown.activeSale, ends: 'invalid'}}]) {
   const hidden = harness(() => SaleNotice({product: {...shown, ...patch}})); assert.equal(hidden.tree, null); reset();
  }
  const before = harness(() => SaleNotice({product: applySale(product, start - 1)})); assert.equal(before.tree, null); reset();
  const visible = harness(() => SaleNotice({product: shown})); now = end + 1000; for (const fn of listeners.get('visibilitychange') || []) fn(); visible.render(); assert.equal(visible.tree, null, 'Resuming a throttled tab recalculates the absolute deadline'); reset();

  // Execute the actual provider's scheduled callback. Both start and end must
  // reprice locally even when every ensuing authoritative state read fails.
  now = start - 5000; failedRead = false; calls = [];
  const provider = harness(() => StoreProvider({children: null, initialCatalog: [applySale(product, now)], shoppingMeasurementEnabled: false}));
  await flush(); provider.render(); assert.equal(provider.tree.props.value.ready, true);
  failedRead = true;
  advance(start + 100, provider); await flush(); provider.render();
  assert.equal(provider.tree.props.value.store.products[0].price, 4000, 'Sale starts locally when the network is unavailable');
  assert.equal(provider.tree.props.value.store.products[0].packPrices[3], 10800);
  assert(provider.tree.props.value.store.products[0].activeSale);
  assert(provider.tree.props.value.loadError, 'Failed authoritative read stays visible as a gap');
  advance(end + 100, provider); await flush(); provider.render();
  assert.equal(provider.tree.props.value.store.products[0].price, 5000, 'Expired sale cannot retain a discounted card price after a failed refresh');
  assert.equal(provider.tree.props.value.store.products[0].packPrices[3], 13500);
  assert.equal(provider.tree.props.value.store.products[0].activeSale, undefined);
  assert.equal(timers.size, 0, 'Final boundary releases its scheduled callback');
  assert(calls.every(url => ['/api/store/state', '/api/store/auth-refresh'].includes(url))); reset();

  // A cached/server snapshot can be stale before hydration. No future boundary
  // exists for an already-expired sale, so mount must also restore its base.
  now = end + 5000; failedRead = true;
  const stale = applySale(product, start);
  const expiredMount = harness(() => StoreProvider({children: null, initialCatalog: [stale], shoppingMeasurementEnabled: false}));
  assert.equal(expiredMount.tree.props.value.store.products[0].price, 5000);
  assert.equal(expiredMount.tree.props.value.store.products[0].activeSale, undefined);
  await flush(); expiredMount.render(); assert.equal(expiredMount.tree.props.value.store.products[0].price, 5000);
  assert(expiredMount.tree.props.value.loadError); reset();
  now = start + 1000; failedRead = false;
  const resumed = harness(() => StoreProvider({children: null, initialCatalog: [applySale(product, now)], shoppingMeasurementEnabled: false}));
  await flush(); resumed.render(); assert.equal(resumed.tree.props.value.store.products[0].price, 4000);
  // Simulate a throttled background tab: wall clock advances without any timer callback.
  now = end + 5000; failedRead = true;
  for (const fn of [...(listeners.get('visibilitychange') || [])]) fn();
  resumed.render(); assert.equal(resumed.tree.props.value.store.products[0].price, 5000);
  await flush(); resumed.render(); assert(resumed.tree.props.value.loadError);
  assert.equal(resumed.tree.props.value.store.products[0].activeSale, undefined); reset();

  // Only a cart containing the changed offer loses its old authoritative quote.
  // Other cart errors and saved quantities must survive local repricing intact.
  const cart = [{id: product.id, quantity: 1}], priorTotals = {subtotal: 5000, total: 5000};
  stateFixture = () => ({...snapshot([applySale(product, now)]), cart, totals: {...priorTotals, subtotal: now >= start && now < end ? 4000 : 5000, total: now >= start && now < end ? 4000 : 5000}, cartError: 'Independent stock check needs review.'});
  now = start - 5000; failedRead = false;
  const cartStart = harness(() => StoreProvider({children: null, initialCatalog: [applySale(product, now)], shoppingMeasurementEnabled: false}));
  await flush(); cartStart.render(); assert.deepEqual(cartStart.tree.props.value.store.totals, priorTotals);
  failedRead = true; advance(start + 100, cartStart); await flush(); cartStart.render();
  assert.equal(cartStart.tree.props.value.store.pricingStale, true);
  assert.equal(cartStart.tree.props.value.store.totals, null, 'A timed offer change invalidates old cart totals');
  assert.deepEqual(cartStart.tree.props.value.store.cart, cart, 'Repricing never removes the saved cart');
  assert.equal(cartStart.tree.props.value.store.cartError, 'Independent stock check needs review.', 'Local price invalidation cannot replace a real cart error');
  // Repeated local updates cannot accidentally acknowledge the stale quote.
  for (const fn of [...(listeners.get('visibilitychange') || [])]) fn();
  await flush(); cartStart.render(); assert.equal(cartStart.tree.props.value.store.pricingStale, true);
  failedRead = false; await cartStart.tree.props.value.refresh(); cartStart.render();
  assert.equal(cartStart.tree.props.value.store.pricingStale, false, 'Authoritative refresh clears price uncertainty');
  assert.equal(cartStart.tree.props.value.store.totals.total, 4000);
  failedRead = true; advance(end + 100, cartStart); await flush(); cartStart.render();
  assert.equal(cartStart.tree.props.value.store.pricingStale, true); assert.equal(cartStart.tree.props.value.store.totals, null);
  // A persisted cart response contains an authoritative recalculation even if
  // the subsequent broader account refresh fails. Do not discard that result.
  cartFixture = body => ({cart: body.cart, totals: {subtotal: 5000, total: 5000}});
  await cartStart.tree.props.value.saveCart(cart); cartStart.render();
  assert.equal(cartStart.tree.props.value.store.pricingStale, false, 'A confirmed cart write clears stale pricing');
  assert.equal(cartStart.tree.props.value.store.totals.total, 5000);
  assert.equal(cartStart.tree.props.value.cartSync, 'saved'); assert(cartStart.tree.props.value.loadError);
  reset(); cartFixture = null;

  const other = {...product, id: product.id + 10000, sale: null};
  stateFixture = () => ({...snapshot([applySale(product, now), other]), cart: [{id: other.id, quantity: 1}], totals: priorTotals});
  now = start - 5000; failedRead = false;
  const unrelated = harness(() => StoreProvider({children: null, initialCatalog: stateFixture().products, shoppingMeasurementEnabled: false}));
  await flush(); unrelated.render(); failedRead = true;
  advance(start + 100, unrelated); await flush(); unrelated.render();
  assert.equal(unrelated.tree.props.value.store.products[0].price, 4000);
  assert.equal(unrelated.tree.props.value.store.pricingStale, false, 'An unrelated catalog offer cannot invalidate the cart');
  assert.deepEqual(unrelated.tree.props.value.store.totals, priorTotals);
  advance(end + 100, unrelated); await flush(); unrelated.render();
  assert.equal(unrelated.tree.props.value.store.pricingStale, false); assert.deepEqual(unrelated.tree.props.value.store.totals, priorTotals); reset();

  // Cent rounding can leave the amount equal while the offer itself changes.
  // Quote metadata must still be renewed so the expired offer is not retained.
  const rounding = {...product, price: 1, packPrices: undefined};
  stateFixture = () => ({...snapshot([applySale(rounding, now)]), cart, totals: {subtotal: 1, total: 1}});
  now = start + 1000; failedRead = false;
  const samePrice = harness(() => StoreProvider({children: null, initialCatalog: stateFixture().products, shoppingMeasurementEnabled: false}));
  await flush(); samePrice.render(); assert.equal(samePrice.tree.props.value.store.products[0].price, 1);
  failedRead = true; advance(end + 100, samePrice); await flush(); samePrice.render();
  assert.equal(samePrice.tree.props.value.store.products[0].price, 1);
  assert.equal(samePrice.tree.props.value.store.products[0].activeSale, undefined);
  assert.equal(samePrice.tree.props.value.store.pricingStale, true, 'An expired offer with equal rounded price still invalidates quote metadata');
  assert.equal(samePrice.tree.props.value.store.totals, null); reset();
  stateFixture = () => snapshot([applySale(product, now)]);

  // SEO dates reflect a real active sale only. Offers use a Date (YYYY-MM-DD),
  // while the shopper countdown retains the exact ISO timestamp.
  const publication = require('../lib/seo-publication-v1.json'); schemaEnv.SEO_REVIEWED_PRODUCT_SLUGS = publication.productSlugs.join(',');
  const {seoConfig} = load('lib/seo-policy.ts'), {routeStructuredData} = load('lib/seo.ts');
  const config = seoConfig(schemaEnv), route = '/product/' + product.slug;
  const offer = async p => { schemaSnapshot = {verified: true, products: [p]}; const graph = await routeStructuredData(route, config); assert(graph); return graph['@graph'].find(n => n['@type'] === 'Product').offers; };
  const activeOffer = await offer(applySale(product, start)); assert.equal(activeOffer.priceValidUntil, '2026-11-11'); assert.equal(activeOffer.price, '40.00');
  for (const p of [applySale(product, start - 1), applySale(product, end), applySale({...product, preorder: {enabled: true, percentOff: 15, ships: 'later'}}, start), {...applySale(product, start), activeSale: {...applySale(product, start).activeSale, ends: 'invalid'}}]) assert.equal(Object.hasOwn(await offer(p), 'priceValidUntil'), false);
  console.log('PASS: absolute sale countdown, SSR deadline, exact expiry/reload, paused preorder/held states, accessibility, visibility catch-up, timer cleanup, provider mount/start/end/visibility repricing despite failed reads, cart-scoped stale quote invalidation/recovery, and timed Offer dates. Isolated fixtures only.');
 } finally {
  reset(); Date.now = realNow; global.setTimeout = realSetTimeout; global.clearTimeout = realClearTimeout; global.setInterval = realSetInterval; global.clearInterval = realClearInterval;
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
