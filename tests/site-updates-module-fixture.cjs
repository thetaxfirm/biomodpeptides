// Loads the real, dependency-free lib/site-updates.ts for tests whose module loaders forbid
// unknown imports. Access rules are the same code the routes use.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function loadSiteUpdatesModule() {
  const filename = path.resolve(__dirname, '../lib/site-updates.ts'), m = new Module(filename, module);
  m.filename = filename;
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
module.exports = { loadSiteUpdatesModule };
