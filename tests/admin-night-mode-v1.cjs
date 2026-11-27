// Night mode is a device preference (owner, Nov 13 2026): kept in this browser, never sent to the
// store, and harmless when there is no browser or storage refuses. No network, no real records.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const name = path.join(root, file), m = new Module(name, module);
  m.filename = name;
  m.require = () => { throw Error('The theme preference must not depend on anything'); };
  m._compile(ts.transpileModule(fs.readFileSync(name, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, name);
  return m.exports;
}
const T = load('lib/admin-theme.ts');
global.fetch = () => { throw Error('A device preference never reaches the network'); };

// A fake browser, so nothing here touches a real document or real storage.
const store = new Map();
const makeStorage = (behaviour = {}) => ({
  getItem: k => behaviour.read ? behaviour.read() : (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (behaviour.write) behaviour.write(); store.set(k, String(v)); },
  removeItem: k => { if (behaviour.write) behaviour.write(); store.delete(k); },
});
const html = { attrs: new Map(), setAttribute(k, v) { this.attrs.set(k, v); }, removeAttribute(k) { this.attrs.delete(k); }, getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; } };
const withBrowser = (fn, storage = makeStorage()) => {
  global.localStorage = storage; global.document = { documentElement: html };
  try { return fn(); } finally { delete global.localStorage; delete global.document; }
};

// --- With no browser at all, every call is inert rather than fatal ---
assert.equal(T.readTheme(), 'light', 'server rendering has no preference to read');
assert.doesNotThrow(() => T.saveTheme('dark'));
assert.doesNotThrow(() => T.applyTheme('dark'));
assert.doesNotThrow(() => T.applyTheme('light'));

// --- The default is light, and nothing is marked until it is chosen ---
withBrowser(() => {
  assert.equal(T.readTheme(), 'light');
  T.applyTheme(T.readTheme());
  assert.equal(html.getAttribute('data-theme'), null, 'an unchosen preference leaves the page alone');
});

// --- Switching on is remembered in this browser and marks the document ---
withBrowser(() => {
  T.saveTheme('dark'); T.applyTheme('dark');
  assert.equal(store.get(T.THEME_KEY), 'dark');
  assert.equal(html.getAttribute('data-theme'), 'dark');
  assert.equal(T.readTheme(), 'dark', 'and it survives into the next page load');
});

// --- Switching off removes both, so no dark rule is left to win a later cascade ---
withBrowser(() => {
  T.saveTheme('light'); T.applyTheme('light');
  assert.equal(store.has(T.THEME_KEY), false, 'light is the absence of a preference, not a second value');
  assert.equal(html.getAttribute('data-theme'), null);
  assert.equal(T.readTheme(), 'light');
});

// --- Anything else in storage reads as light; a hand-edited value cannot mean something new ---
for (const junk of ['DARK', 'true', '1', '', 'night', '{"theme":"dark"}']) {
  withBrowser(() => { store.set(T.THEME_KEY, junk); assert.equal(T.readTheme(), 'light', junk); });
}
store.clear();

// --- Storage that refuses is a non-event: private browsing must not break administration ---
const refusing = makeStorage({ read: () => { throw Error('Blocked site data'); }, write: () => { throw Error('Blocked site data'); } });
withBrowser(() => {
  assert.equal(T.readTheme(), 'light', 'an unreadable preference is simply absent');
  assert.doesNotThrow(() => T.saveTheme('dark'), 'and an unwritable one is not an error worth showing');
  assert.doesNotThrow(() => T.applyTheme('dark'));
  assert.equal(html.getAttribute('data-theme'), 'dark', 'the page still changes for this visit');
}, refusing);
html.removeAttribute('data-theme');

// --- It is a preference, not a store setting ---
const lib = fs.readFileSync(path.join(root, 'lib/admin-theme.ts'), 'utf8');
assert.doesNotMatch(lib, /fetch|api\(|settings|database|D1/i, 'nothing here talks to the store');
const admin = fs.readFileSync(path.join(root, 'components/store/admin.tsx'), 'utf8');
// The switch sits ABOVE the settings form and outside it, so saving store settings can never
// carry a personal display choice to the server for everyone else.
const settings = admin.slice(admin.indexOf('<TabsContent value="settings">'));
const control = settings.indexOf('role="switch"'), form = settings.indexOf('<form');
assert(control >= 0 && form >= 0 && control < form, 'the switch is outside the settings form');
assert.match(admin, /aria-checked=\{night === 'dark'\}/, 'and reports its state to assistive technology');
assert.match(admin, /onSubmit=\{e => submit\(e, 'config', d => \(\{ \.\.\.flags, expectedVersion: data\.settingsVersion, packDiscounts/, 'the settings save keeps its draft payload and version guard');
assert.doesNotMatch(admin, /'config'[^)]*night/, 'and never carries the preference');
// Read once on open, applied immediately, so the choice survives a reload.
assert.match(admin, /useEffect\(\(\) => \{ const saved = readTheme\(\); setNight\(saved\); applyTheme\(saved\); \}, \[\]\)/);

// --- The stylesheet answers the attribute, and outranks the light tokens ---
const css = fs.readFileSync(path.join(root, 'components/store/admin-theme.module.css'), 'utf8');
assert.match(css, /:global\(html\[data-theme='dark'\]\) \{[\s\S]*?--background: #0c0c0e/, 'the background is blacked out');
assert.match(css, /--foreground: #ffffff/, 'and the text is white');
assert.match(css, /color-scheme: dark/, 'so the browser darkens its own controls too');
// The owner's rule (Nov 16 2026): black background, white text, every other colour untouched.
// These are the colours an earlier cut wrongly recoloured.
const tokens = /:global\(html\[data-theme='dark'\]\) \{[\s\S]*?\n\}/.exec(css)[0];
for (const kept of ['--primary:', '--destructive:', '--ring:', '--gold:', '--copper:',
                    '--bm-action:', '--bm-navy:', '--bm-cyan:', '--bm-hover:', '--bm-on-dark:'])
  assert(!tokens.includes(kept), kept + ' is a kept colour and must not be redefined in night mode');
// The admin screens read the storefront's own brand tokens, so the text one has to move with the
// rest of the text. It holds the same plum as the button colour beside it, which does not.
assert.match(tokens, /--bm-ink: #ffffff/, 'the brand text token turns white');
assert.match(tokens, /--bm-surface: #141417/, 'and its light panel surface goes dark');
assert(!/\.button-dark[^}]*background:/.test(css), 'the navy save button keeps its colour');
assert(!/\.notice[^}]*background:/.test(css), 'and the amber notice keeps its background');
assert.match(css, /\.notice\) \{ color: #12243a; \}/, 'but a light panel keeps dark text, since the page text is now white');
assert.match(css, /\.data-warning\) \{ color: #8b362c; \}/, 'including the error red, the exact one daylight uses');
assert(!/:global\(\[data-theme/.test(css), 'every dark rule is anchored to html, which outranks :root whatever the load order');
// The brand plum is a button fill AND a link text colour. Kept as a fill; as text it has to lift,
// or every Print label / Dropped off link is plum on black (owner's screenshot, Nov 16 2026).
assert.match(css, /\.text-button\)[\s\S]{0,120}color: #dcc4e8/, 'brand-plum link text lifts to a readable tint of itself');
// Orders declares its own palette, so it needs its own night pair rather than inheriting plum.
const orders = fs.readFileSync(path.join(root, 'components/store/orders-admin.module.css'), 'utf8');
assert.match(orders, /:global\(html\[data-theme='dark'\]\) \.orders \{[\s\S]*?--ord-ink: #ffffff/, 'the orders table has a night palette');
const dayPalette = /\.orders \{([\s\S]*?)\n\}/.exec(orders)[1];
// Daylight keeps its exact colours, declared literally. A find-and-replace once turned these into
// --ord-ink: var(--ord-ink), which is circular, resolves to nothing and silently falls back to the
// inherited colour -- every rule in the table went plum without a single rule looking wrong.
for (const [name, value] of [['--ord-ink', '#2c1534'], ['--ord-quiet', '#655a68'], ['--ord-link', '#43284f'],
                             ['--ord-line', '#d8cedd'], ['--ord-rule', '#ece6ef']])
  assert(dayPalette.includes(name + ': ' + value), name + ' keeps its daylight value literally');
assert(!/--ord-[a-z]+:\s*var\(--ord-/.test(orders), 'no token may be defined as itself');
assert(!/(^|[^-])#(2c1534|655a68|43284f|d8cedd|ece6ef)/.test(orders.replace(dayPalette, '')),
  'and outside that one block nothing hardcodes a colour that night mode has to override');
// Every admin screen, not just the ones that were looked at first (owner, Nov 16 2026: "go
// through each page and correct colors ... stop doing it half ass"). A module that paints its own
// colours needs its own night block, or that screen is plum-on-black while the rest is correct.
const moduleDir = path.join(root, 'components/store');
// A rule that sets a background AND a colour together is self-contained: it carries its own
// contrast and reads the same on any page, so a status pill or a notice panel needs no night
// value. What needs one is an UNPAIRED literal -- text with no background of its own (it lands on
// whatever the page is) or a surface with no text colour (it takes the page's, which is white).
const paintsOwnColours = (css) => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
                  .replace(/:global\(html\[data-theme='dark'\]\)[^{]*\{[^}]*\}/g, '');
  const literal = /(?:#[0-9a-fA-F]{3,6}|\bwhite\b)/;
  for (const [, block] of body.matchAll(/\{([^{}]*)\}/g)) {
    const decls = block.split(';').map(d => d.trim()).filter(Boolean);
    const colour = decls.find(d => /^color\s*:/.test(d) && literal.test(d));
    const surface = decls.find(d => /^background(-color)?\s*:/.test(d) && literal.test(d));
    if (colour && surface) continue;
    if (colour || surface) return true;
  }
  return false;
};
const unlit = [];
for (const file of fs.readdirSync(moduleDir).filter(f => f.endsWith('.module.css'))) {
  const css = fs.readFileSync(path.join(moduleDir, file), 'utf8');
  if (paintsOwnColours(css) && !css.includes("data-theme='dark'")) unlit.push(file);
}
assert.deepEqual(unlit, [], 'these stylesheets paint their own colours but have no night block: ' + unlit.join(', '));

// The failure that is invisible in review: a token defined as itself resolves to nothing and
// silently inherits, so every rule reading it goes wrong while no rule looks wrong.
for (const file of fs.readdirSync(moduleDir).filter(f => f.endsWith('.module.css'))) {
  const css = fs.readFileSync(path.join(moduleDir, file), 'utf8');
  const circular = [...css.matchAll(/(--[a-z-]+)\s*:\s*var\(\s*(--[a-z-]+)\s*\)/g)].filter(m => m[1] === m[2]);
  assert.deepEqual(circular.map(m => m[1]), [], file + ' defines a token as itself');
}

// Half a pair is worse than none. When a daylight rule sets a background AND a colour together,
// darkening only the background leaves that rule's own dark text on a dark surface -- which is
// exactly what happened to the admin header bar, the first thing on every page. Changing only the
// COLOUR is allowed and deliberate: that is how a kept amber or red notice panel stays light while
// no longer inheriting the page's white text.
const literal = /(?:#[0-9a-fA-F]{3,6}|\bwhite\b)/;
for (const file of fs.readdirSync(moduleDir).filter(f => f.endsWith('.module.css'))) {
  const css = fs.readFileSync(path.join(moduleDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const day = [], night = {};
  for (const [, sel, block] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = block.split(';').map(d => d.trim()).filter(Boolean);
    const colour = decls.some(d => /^color\s*:/.test(d) && literal.test(d));
    const surface = decls.some(d => /^background(-color)?\s*:/.test(d) && literal.test(d));
    if (sel.includes("data-theme='dark'"))
      night[sel.replace(":global(html[data-theme='dark'])", '').trim()] = { colour, surface };
    else if (colour && surface) day.push(sel);
  }
  for (const sel of day) for (const part of sel.split(',').map(p => p.trim())) {
    const over = night[part];
    if (over && over.surface && !over.colour)
      assert.fail(file + ': "' + part + '" sets a background and a colour together, but night mode moves only the background, leaving its own dark text on a dark surface');
  }
}

// Requests was the screen the owner screenshotted: a white desk with white text on it, because
// --ink flips to white while --soft and the panels stayed light.
const inbox = fs.readFileSync(path.join(moduleDir, 'request-inbox.module.css'), 'utf8');
const inboxDay = /\.inbox \{([\s\S]*?)\n\}/.exec(inbox)[1];
for (const [name, value] of [['--soft', '#f7f3f8'], ['--muted', '#5f5664'], ['--panel', '#fff'],
                             ['--on-ink', '#fff'], ['--sent', '#eef3ee'], ['--sent-ink', '#2f6b45']])
  assert(inboxDay.includes(name + ': ' + value), 'requests keeps ' + name + ' at its daylight value');
assert(!/background:\s*white\b/.test(inbox), 'and no surface is left hardcoded white');
const inboxNight = /:global\(html\[data-theme='dark'\]\) \.inbox \{([\s\S]*?)\n\}/.exec(inbox)[1];
for (const token of ['--soft', '--muted', '--panel', '--on-ink', '--sent', '--sent-ink', '--rowline'])
  assert(inboxNight.includes(token + ':'), 'night mode moves ' + token);
// --ink becomes white, so anything filled with --ink must not also be white text.
assert(/--on-ink:\s*#0c0c0e/.test(inboxNight), 'text on an --ink fill goes dark when --ink goes white');

// The status pills are ink+fill pairs; moving only one half leaves dark-on-dark or light-on-light.
const products = fs.readFileSync(path.join(moduleDir, 'admin-products.module.css'), 'utf8');
for (const pill of ['available', 'coming_soon', 'sold_out', 'unavailable']) {
  const rule = new RegExp(":global\\(html\\[data-theme='dark'\\]\\) \\." + pill + "\\s*\\{([^}]*)\\}").exec(products);
  assert(rule, pill + ' has a night pair');
  assert(/--status-ink:/.test(rule[1]) && /--status-fill:/.test(rule[1]), pill + ' moves both halves of the pair');
}

const nav = fs.readFileSync(path.join(root, 'components/store/admin-nav.module.css'), 'utf8');
assert.match(nav, /:global\(html\[data-theme='dark'\]\) \.tabs/, 'the side nav has a dark pair, since it paints its own colours');

console.log('PASS: every admin stylesheet that paints its own colours has a night block, no token is defined as itself, no colour pair is only half moved, Requests keeps its daylight palette and moves every surface token, the status pills move as pairs; night mode blacks out the background and whites the text while leaving the kept colours alone, and is a per-browser preference that defaults to light, survives a reload, clears itself outright when switched off, treats any other stored value as light, stays inert without a browser and when storage refuses, never reaches the store, and sits outside the settings form. No network.');
