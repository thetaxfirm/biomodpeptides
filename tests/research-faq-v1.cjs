/* SSR content and navigation regression. No browser, API, credentials or live data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
require.extensions['.ts'] = (m, file) => m._compile(transpile(file), file);
const file = path.join(root, 'components/store/research-faq.tsx');
const component = new Module(file, module);
component.filename = file;
component.paths = Module._nodeModulePaths(root);
const originalRequire = component.require.bind(component);
component.require = id => id.endsWith('.module.css') ? { faq: 'faq', group: 'group', answers: 'answers', answer: 'answer' } :
  id.startsWith('@/lib/') ? originalRequire(path.join(root, id.slice(2)) + '.ts') : originalRequire(id);
component._compile(transpile(file), file);
const html = renderToStaticMarkup(React.createElement(component.exports.ResearchFAQ));
const decode = text => text.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// Compare to the six existing FAQ answers, without importing its interactive
// dependencies or relying on a second hand-maintained list of policy wording.
const contentFile = path.join(root, 'components/store/content.tsx');
const source = ts.createSourceFile(contentFile, fs.readFileSync(contentFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let existing;
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  const declaration = statement.declarationList.declarations.find(item => item.name.getText(source) === 'faqs');
  if (declaration) existing = declaration.initializer.elements.map(row => row.elements.map(value => value.text));
}
assert.equal(existing?.length, 6, 'compare against the existing homepage FAQ');
for (const [question, answer] of existing) {
  assert(text.includes(question), question + ' must be server-rendered');
  assert(text.includes(answer), question + ' must preserve its existing answer verbatim');
}
for (const answer of [
  'A report for another lot does not establish results for yours.',
  'A purity percentage alone does not tell you the milligrams in a vial.',
  'No original certificate is available in the published record. This is not a completed test result.',
  'the listed contents apply to each vial or bottle.',
  'Availability and quantity limits apply.',
]) assert(text.includes(answer), 'documentation and pack explanations must exist without interaction');
const { packSizes } = require('../lib/packs.ts');
assert(text.includes('Pack sizes count containers: ' + packSizes.slice(0, -1).join(', ') + ' or ' + packSizes.at(-1) + ' complete vials or bottles.'));
assert.equal((html.match(/<h1\b/g) || []).length, 1);
assert.equal((html.match(/<h2\b/g) || []).length, 4);
assert.equal((html.match(/<h3\b/g) || []).length, 10);
assert(!/<(?:button|details|script)\b|\bhidden=|aria-hidden=|display:\s*none|opacity:\s*0/.test(html), 'answers must not depend on expansion, scripts or hidden markup');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'heading IDs must be unique');
for (const [, target] of html.matchAll(/aria-labelledby="([^"]+)"/g)) assert(ids.includes(target), 'each section must have an existing heading');
const { pageRecords } = require('../lib/seo-policy.ts');
const guide = fs.readFileSync(path.join(root, 'components/store/quality-guide.tsx'), 'utf8');
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => decode(match[1]));
assert.equal(hrefs.length, 10, 'each answer should provide an ordinary contextual link');
for (const href of hrefs) {
  const url = new URL(href, 'https://trybiomod.com');
  assert.equal(url.origin, 'https://trybiomod.com', 'context links stay on the storefront');
  assert(pageRecords[url.pathname], href + ' must name an existing public route');
  if (url.hash) assert(guide.includes(`id="${url.hash.slice(1)}"`), href + ' must reach an existing guide section');
}
console.log('PASS: actual SSR exposes all10 FAQ answers, preserves existing6 answers, reflects pack sizes, uses valid ordinary links and accessible headings without expansion');
