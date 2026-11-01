/* Footer column titles are h2, so pages whose content has only an h1 (testing, policies) do not jump from h1 to h3; their styling follows the tag. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolveFilename.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
require.extensions['.css'] = module => { module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }); };
const { Footer } = require('../components/store/content.tsx');

const html = renderToStaticMarkup(React.createElement(Footer));
const headings = [...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)].map(match => [Number(match[1]), match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')]);
assert.deepEqual(headings, [[2, 'Shop & Account'], [2, 'Research & Support'], [2, 'Policies']], 'Footer column titles render as h2');
// A content page with only an h1 followed by the footer must not skip a level.
const levels = [1, ...headings.map(([level]) => level)];
for (let i = 1; i < levels.length; i++) assert(levels[i] <= levels[i - 1] + 1, 'No heading level is skipped after an h1-only page');

for (const file of ['app/globals.css', 'app/storefront-v6.css']) {
  const css = fs.readFileSync(path.join(root, file), 'utf8');
  assert(!/\.footer-grid h3\b/.test(css), file + ': no stale .footer-grid h3 selector');
}
assert(/\.footer-grid h2\{font-size:16px;line-height:inherit;margin-bottom:8px\}/.test(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8')), 'Footer titles keep their 16px size and inherited line height (generic h2 sets 1.3)');
console.log('footer-heading-order-v1 passed');
