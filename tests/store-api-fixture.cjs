// Execute the real dispatcher and extracted domain modules under each test's existing provider mocks.
// No production dependency is stubbed here and unknown dependencies still reach the caller's guard.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function link(parent){
  const original=parent.require.bind(parent),cache=new Map();
  function load(id){
    if(!id.startsWith('@/lib/store-api/'))return original(id);
    const filename=path.join(root,id.slice(2)+'.ts');
    if(cache.has(filename))return cache.get(filename).exports;
    const child=new Module(filename,parent);child.filename=filename;child.paths=Module._nodeModulePaths(root);child.require=load;cache.set(filename,child);
    child._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);
    return child.exports;
  }
  parent.require=load;
}
// Source-wiring assertions may span multiple domains; behavioral tests above execute their imports.
function source(){return [fs.readFileSync(path.join(root,'app/api/store/[action]/route.ts'),'utf8'),...fs.readdirSync(path.join(root,'lib/store-api')).filter(n=>n.endsWith('.ts')).sort().map(n=>fs.readFileSync(path.join(root,'lib/store-api',n),'utf8'))].join('\n');}
function branch(action,domain){
  const filename=path.join(root,'lib/store-api',domain+'.ts'),text=fs.readFileSync(filename,'utf8'),file=ts.createSourceFile(filename,text,99,true);let found;
  function walk(node){if(ts.isIfStatement(node)&&node.expression.getText(file)===`action === '${action}'`)found=node.getText(file);else ts.forEachChild(node,walk);}walk(file);
  if(!found)throw Error('Missing real route action '+action+' in '+domain);return found;
}
module.exports={link,source,branch};
