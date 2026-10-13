// Label-lot original reports: exact lot, hosted bytes and server projection. Local SQLite only, no network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('External network forbidden');};
const {products}=require('../lib/catalog.ts'),testing=require('../lib/testing.ts'),batch=require('../lib/product-batch.ts');
const reconciliations=require('../lib/coas-reconciliations-v1.json');
const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE product_overrides(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE coa_original_reports(sha256 TEXT PRIMARY KEY,data TEXT,enabled INTEGER);');
const db={prepare(query){const statement=(values=[])=>({bind:(...v)=>statement(v),first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)}),run:async()=>({meta:sql.prepare(query).run(...values)})});return statement();}};
// The lot printed on each vial label, the Vanguard report for that lot, and its reported values.
const expected={
 763:['501-10-0001','V260304-6 020','>99.80% + 0.18%','4.94 mg; 5.08 mg'],
 765:['503-80-0001','V260304-6 022','>99.50% + 0.18%','47.55 mg; 11.48 mg; 10.45 mg; 10.99 mg'],
 752:['405-500-0001','V260304-6 009','>99.80%; 98.02%','643 mg'],
 759:['407-50-0001','BIOM2604200371','99.49%','51.78 mg'],
 755:['301-10-0001','BIOM2604200372','99.92%','11.52 mg'],
};
(async()=>{try{
 assert.equal(testing.normalizedStrength('5 mg/5 mg'),'10mg');assert.equal(testing.normalizedStrength('50mg / vial'),'50mg');assert.equal(testing.normalizedStrength('80 mg'),'80mg');assert.equal(testing.normalizedStrength('5 mg/5 mL'),'5mg/5ml','Only same-unit blends are totalled');
 const resolved=await batch.resolveProductBatches(db,products);
 for(const [id,[lot,reportId,purity,assay]] of Object.entries(expected)){
  const product=products.find(p=>p.id===Number(id)),source=testing.batchFor(product.id),doc=testing.matchingCertificateFor(source);
  assert(doc,product.name+': source record has its label-lot report');
  assert.equal(source.product_lot,lot);assert.equal(doc.batch_number,lot);assert.equal(doc.report_id,reportId);
  assert.equal(testing.reportedResult(doc,'purity'),purity);assert.equal(testing.reportedResult(doc,'assay'),assay);
  const sterility=doc.results.filter(r=>r.kind==='sterility');assert(sterility.every(r=>r.result==='Pass - No Growth Detected'),product.name+': any sterility result shown is the passing retest version');
  // Owner rule: the label claims 98% or better, so every published purity meets it.
  for(const r of doc.results.filter(r=>r.kind==='purity'))assert(Number(r.result.match(/[\d.]+/)[0])>=98,product.name+': purity '+r.result+' meets the label');
  assert(!doc.results.some(r=>/fail/i.test(r.result)),product.name+': no failing result is published');
  const file=path.join(root,'public/certificates',doc.filename);
  assert.equal(doc.url,'https://trybiomod.com/certificates/'+doc.filename);
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),doc.sha256,product.name+': hosted PDF is the unchanged original');
  const live=resolved.find(p=>p.id===product.id).resolvedBatch;
  assert.equal(live.coa_available,true);assert.equal(live.lot_match,'matches');assert.equal(live.product_lot,lot);assert.equal(live.certificate_lot,lot);
  assert.equal(live.coa_pdf_url,doc.url);assert.equal(live.certificate.report_id,reportId);assert.equal(testing.batchStatus(live),'matched');
 }
 // A lot whose only Vanguard report failed stays pending; nothing is borrowed from another lot.
 for(const slug of ['kpv-10mg','slu-pp-332','5-amino-1mq','mots-c-40mg']){
  const product=products.find(p=>p.slug===slug);if(!product)continue;
  const live=resolved.find(p=>p.id===product.id).resolvedBatch;assert.equal(live.coa_available,false,slug);assert.equal(live.document_id,null,slug);
 }
 // A changed lot, identity or strength fails closed for every new association.
 for(const id of Object.keys(expected)){
  const product=products.find(p=>p.id===Number(id));
  for(const changed of [{...product,sizes:['999mg']},{...product,identity:'Synthetic different identity'}]){const r=(await batch.resolveProductBatches(db,[changed]))[0].resolvedBatch;assert.equal(r.coa_available,false);assert.equal(r.certificate,undefined);}
  sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?)').run(product.id,JSON.stringify({batch:{lot:'FIXTURE-OTHER-LOT',reportRef:null,coaAvailable:false}}));
  const r=(await batch.resolveProductBatches(db,[product]))[0].resolvedBatch;assert.equal(r.product_lot,'FIXTURE-OTHER-LOT');assert.equal(r.coa_available,false);assert.equal(r.document_id,null);
  sql.prepare('DELETE FROM product_overrides WHERE id=?').run(product.id);
 }
 assert.equal(reconciliations.reconciliations.length,5);
 const counts={};for(const p of resolved){const s=testing.batchStatus(p.resolvedBatch);counts[s]=(counts[s]||0)+1;}
 assert.equal(counts.matched,19,'16 previous matching reports plus Run & Gun, KLOW and NAD+');
 console.log('PASS: Run & Gun, KLOW, NAD+, Epitalon and Tesamorelin publish the unchanged original report for the exact label lot through the server resolver; failed or missing lots stay pending; lot, identity and strength changes fail closed. Isolated SQLite, no network.');
}finally{sql.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
