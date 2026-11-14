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
assert.match(admin, /onSubmit=\{e => submit\(e, 'config', d => \(\{ \.\.\.flags, packDiscounts/, 'the settings save is unchanged');
assert.doesNotMatch(admin, /'config'[^)]*night/, 'and never carries the preference');
// Read once on open, applied immediately, so the choice survives a reload.
assert.match(admin, /useEffect\(\(\) => \{ const saved = readTheme\(\); setNight\(saved\); applyTheme\(saved\); \}, \[\]\)/);

// --- The stylesheet answers the attribute, and outranks the light tokens ---
const css = fs.readFileSync(path.join(root, 'components/store/admin-theme.module.css'), 'utf8');
assert.match(css, /:global\(html\[data-theme='dark'\]\) \{[\s\S]*?--background: #10141b/, 'dark redefines the shared tokens');
assert.match(css, /color-scheme: dark/, 'so the browser darkens its own controls too');
assert(!/:global\(\[data-theme/.test(css), 'every dark rule is anchored to html, which outranks :root whatever the load order');
const nav = fs.readFileSync(path.join(root, 'components/store/admin-nav.module.css'), 'utf8');
assert.match(nav, /:global\(html\[data-theme='dark'\]\) \.tabs/, 'the side nav has a dark pair, since it paints its own colours');

console.log('PASS: night mode is a per-browser preference that defaults to light, survives a reload, clears itself outright when switched off, treats any other stored value as light, stays inert without a browser and when storage refuses, never reaches the store, and sits outside the settings form. No network.');
