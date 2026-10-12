// Loads the real, dependency-free lib/staff.ts for tests whose module loaders forbid
// unknown imports. Role rules are the same code the routes and admin UI use.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function loadStaffModule() {
  const filename = path.resolve(__dirname, '../lib/staff.ts'), m = new Module(filename, module);
  m.filename = filename;
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
module.exports = { loadStaffModule };
