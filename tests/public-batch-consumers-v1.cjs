/* Render real public batch consumers against changed runtime records. All records
 * below are synthetic; no network, database, customer, or report file access. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
let currentProducts = [], ready = true, loadError = '';
const provider = { useStore: () => ({ store: { products: currentProducts }, ready, loadError, refresh: async () => {}, add: async () => {}, addFixedPack: async () => {} }), report: () => {} };
const resolve = Module._resolveFilename, originalLoad = Module._load;
Module._resolveFilename = function(name,parent,...rest) { return resolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,parent,...rest); };
Module._load = function(name,parent,isMain) {
 if ((name === './provider' && parent?.filename.includes('/components/store/')) || name === '@/components/store/provider') return provider;
 if (name === '@/components/ui/dialog') {
  const box=({children})=>React.createElement('div',null,children);
  return { Dialog:box, DialogContent:box, DialogTitle:box, DialogDescription:box };
 }
 return originalLoad.call(this,name,parent,isMain);
};
for(const extension of ['.ts','.tsx'])require.extensions[extension]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
require.extensions['.css']=module=>{module.exports=new Proxy({__esModule:true},{get:(target,key)=>key==='__esModule'?true:key==='default'?new Proxy({},{get:(_,name)=>String(name)}):String(key)});};
global.fetch=()=>{throw Error('Network forbidden in public batch tests');};
const { products }=require('../lib/catalog.ts');
const { batchFor, matchingCertificateFor, batchStatus }=require('../lib/testing.ts');
const { batchMatchesSearch }=require('../lib/batch-search.ts');
const { BatchPassport, CertificateButton }=require('../components/store/batch-record.tsx');
const { Testing }=require('../components/store/testing.tsx');
const { QualityGuide }=require('../components/store/quality-guide.tsx');
const { ProductComparison }=require('../components/store/comparison.tsx');
const { ProductResearchDetails }=require('../components/store/product-research-details.tsx');
const { certificateProperties }=require('../lib/certificate-schema.ts');
const { llmsText }=require('../lib/llms-text.ts');
const render=(Component,props={})=>renderToStaticMarkup(React.createElement(Component,props));
const product=products.find(p=>p.id===753), original=batchFor(753);
assert(product&&original&&original.product_lot);
const pending={record_id:'synthetic-batch-record',product_id:product.id,product_name:product.name,product_slug:product.slug,product_lot:'SYNTHETIC-NEW-LOT',public_identity:product.identity,document_id:null,certificate_lot:null,has_certificate_pdf:false,lot_match:'not_verifiable',coa_available:false,coa_on_request:false};
let changed={...product,resolvedBatch:pending};currentProducts=[changed];
for(const [Component,props] of [[BatchPassport,{product:changed}],[Testing,{}],[QualityGuide,{}],[ProductResearchDetails,{product:changed}],[ProductComparison,{products:[changed],open:true,onOpenChange(){},onRemove(){}}]]) {
 const html=render(Component,props);
 assert(!html.includes(original.product_lot),'Old lot never leaks into '+Component.name);
 assert(!html.includes('Read original certificate'),'Detached original is absent from '+Component.name);
 if(Component!==QualityGuide)assert(html.includes('Update in progress')||html.includes('The lab report for this lot is being updated.'),'Current unmatched state is visible in '+Component.name);
}
assert(render(Testing).includes('SYNTHETIC-NEW-LOT'));
assert.equal(certificateProperties(product.id,changed).length,0);
const paths=['/product/'+product.slug];assert(!llmsText('https://trybiomod.com',paths,[changed]).includes('Matching-lot COA'));assert(!llmsText('https://trybiomod.com',paths,[]).includes('Matching-lot COA'));
// A newly associated original appears consistently only when it matches.
const doc={document_id:'synthetic-original',is_certificate:true,url:'https://example.invalid/original.pdf',batch_number:'SYNTHETIC-NEW-LOT',report_id:'SYNTHETIC-REPORT',report_date:'2026-10-14',laboratory_name:'Synthetic fixture laboratory',results:[{kind:'purity',analyte:'Purity',result:'99.1%',method:'Synthetic fixture method'},{kind:'assay',analyte:'Content',result:'10.2',unit:'mg'}]};
const matched={...pending,certificate_lot:pending.product_lot,document_id:doc.document_id,certificate:doc,has_certificate_pdf:true,lot_match:'matches',coa_available:true};
changed={...product,resolvedBatch:matched};currentProducts=[changed];
for(const [Component,props] of [[BatchPassport,{product:changed}],[Testing,{}],[QualityGuide,{}],[ProductResearchDetails,{product:changed}],[ProductComparison,{products:[changed],open:true,onOpenChange(){},onRemove(){}}]]) {
 const html=render(Component,props);assert(!html.includes(original.product_lot));
 assert(html.includes('Lab report available')||html.includes('published with this product')||html.includes('SYNTHETIC-REPORT'),'New report used by '+Component.name);
}
const props=certificateProperties(product.id,changed);assert(props.some(p=>p.name==='Certificate lot'&&p.value==='SYNTHETIC-NEW-LOT'));assert(props.some(p=>p.name==='Certificate of analysis'&&p.url===doc.url));
assert(llmsText('https://trybiomod.com',paths,[changed]).includes('Matching-lot COA: lot SYNTHETIC-NEW-LOT'));
// Public consumers distrust stale/forged matched flags and disabled associations.
const hiddenDoc={...doc,report_id:'HIDDEN-REPORT-52779',url:'https://example.invalid/hidden-report-52779.pdf',report_date:'HIDDEN-DATE-52779',results:[{kind:'purity',analyte:'Purity',result:'98.7654%',method:'Hidden fixture method'}]};
const stale={...matched,certificate:hiddenDoc,certificate_source_note:'HIDDEN-SOURCE-NOTE-52779',recorded_on:'HIDDEN-UPDATE-52779'};
for(const invalid of [
 {...stale,certificate:{...hiddenDoc,batch_number:'HIDDEN-OTHER-LOT-52779'}},
 {...stale,certificate_lot:'HIDDEN-OTHER-LOT-52779'},
 {...stale,coa_available:false},
 {...stale,lot_match:'mismatch'},
 {...stale,certificate_lot:null},
 {...stale,product_lot:'',certificate_lot:'',certificate:{...hiddenDoc,batch_number:''}},
 {...stale,product_lot:'pending',certificate_lot:'pending',certificate:{...hiddenDoc,batch_number:'pending'}},
]) {
 changed={...product,resolvedBatch:invalid};currentProducts=[changed];
 assert.equal(matchingCertificateFor(invalid),undefined);
 assert.equal(batchStatus(invalid),'pending');
 for(const [Component,props] of [[BatchPassport,{product:changed}],[CertificateButton,{record:invalid}],[Testing,{}],[QualityGuide,{}],[ProductResearchDetails,{product:changed}]]){
  const html=render(Component,props);
  for(const hidden of [hiddenDoc.report_id,hiddenDoc.url,hiddenDoc.report_date,'98.7654%','HIDDEN-OTHER-LOT-52779',stale.certificate_source_note,stale.recorded_on])assert(!html.includes(hidden),Component.name+': ineligible report data stays hidden');
  assert(!html.includes('Read original certificate')&&!html.includes('Open original PDF'),Component.name+': ineligible report cannot be opened');
 }
 assert.equal(certificateProperties(product.id,changed).length,0);
 assert(!llmsText('https://trybiomod.com',paths,[changed]).includes('Matching-lot COA'));
 assert.equal(batchMatchesSearch(invalid,product,hiddenDoc.report_id),false);
 assert.equal(batchMatchesSearch(invalid,product,'HIDDEN-OTHER-LOT-52779'),false);
}
// Private originals retain availability without inventing a printed-copy policy.
changed={...product,resolvedBatch:{...pending,coa_available:true,coa_on_request:true}};currentProducts=[changed];
const privateHtml=render(BatchPassport,{product:changed})+render(ProductResearchDetails,{product:changed});assert(privateHtml.includes('available on request'));assert(!privateHtml.includes('included in the box'));assert(!privateHtml.includes('.pdf'));assert.equal(certificateProperties(product.id,changed).length,0);
assert.equal(certificateProperties(product.id,{...product,resolvedBatch:null}).length,0,'Explicit unavailable snapshot never revives a source certificate');
// A failed runtime read must not fall back to original source documents.
ready=false;currentProducts=[{...product,resolvedBatch:null}];assert(render(Testing).includes('Loading current product lots'));assert(!render(Testing).includes(original.product_lot));assert(!render(QualityGuide).includes(original.product_lot));
ready=true;loadError='Current records could not be loaded';assert(render(Testing).includes(loadError));assert(render(Testing).includes('Retry batch documents'));assert(!render(Testing).includes('SYNTHETIC-NEW-LOT'));
// The catch-all page and metadata accept a new current lot without source edits.
(async()=>{
 currentProducts=[{...product,resolvedBatch:matched}];
 const file=path.join(root,'app/[...path]/page.tsx'),m=new Module(file,module);m.filename=file;m.paths=module.paths;
 const deps={
  '@/lib/legacy-routes':{legacyRoutes:{}},'next/headers':{cookies:async()=>{throw Error('Public lot routes must not read cookies');}},
  '@/lib/auth':{customer:async()=>{throw Error('Public lot routes must not read identity');}},
  '@/lib/auth-return':{authRoutes:[],safeAuthReturn:v=>v},'@/components/store/experience':{Experience:()=>null},
  'next/navigation':{notFound:()=>{throw Error('not-found')},permanentRedirect:()=>{throw Error('unexpected redirect')},redirect:()=>{throw Error('unexpected redirect')}},
  '@/lib/seo-policy':{pageRecords:{},productAt:()=>null,mayIndex:()=>false},
  '@/lib/seo':{requestSEO:async()=>({}),routeMetadata:path=>({path}),routeStructuredData:async()=>null,jsonLd:JSON.stringify},
  '@/lib/testing':require('../lib/testing.ts'),
  '@/lib/public-catalog':{publicCatalog:async()=>({products:currentProducts,verified:true})},
  'react/jsx-runtime':require('react/jsx-runtime')
 };
 m.require=id=>{if(id in deps)return deps[id];throw Error('Unexpected public route dependency '+id)};
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);
 const args=lot=>({params:Promise.resolve({path:['testing',lot]}),searchParams:Promise.resolve({product:String(product.id)})});
 assert(await m.exports.default(args('SYNTHETIC-NEW-LOT')));assert.equal((await m.exports.generateMetadata(args('SYNTHETIC-NEW-LOT'))).path,'/testing/SYNTHETIC-NEW-LOT');
 await assert.rejects(m.exports.default(args('UNKNOWN-SYNTHETIC-LOT')),/not-found/);
 console.log('PASS: real public batch, testing, quality, comparison, research FAQ, certificate/llms and current-lot route consumers follow runtime lot changes, detached/pending originals, exact associations and loading/failure suppression. Synthetic records only.');
})().catch(error=>{console.error(error);process.exitCode=1});
