// Actual batch projection/COA eligibility with synthetic private originals and local SQLite only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
global.fetch=async()=>{throw Error('External network forbidden');};
const {products}=require('../lib/catalog.ts'),testing=require('../lib/testing.ts'),batch=require('../lib/product-batch.ts'),coa=require('../lib/coa-delivery.ts');
const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE product_overrides(id INTEGER PRIMARY KEY,data TEXT); CREATE TABLE coa_original_reports(sha256 TEXT PRIMARY KEY,data TEXT,enabled INTEGER);');
let fullReads=0;
const db={prepare(query){if(/SELECT data FROM coa_original_reports/.test(query))fullReads++;const statement=(values=[])=>({bind:(...v)=>statement(v),first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)}),run:async()=>({meta:sql.prepare(query).run(...values)})});return statement();}};
const p=products.find(p=>p.slug==='bpc-157-10mg'),heat=products.find(p=>p.id===745);assert(p&&heat);
const initial=testing.batchFor(p.id),sourceDocument=testing.certificateFor(initial);assert(initial&&sourceDocument);
const bytes=Buffer.from('%PDF-1.4\n% SYNTHETIC BATCH REGRESSION ONLY - NOT A LAB REPORT\n%%EOF');
const original={productId:p.id,productName:p.name,strength:p.sizes[0],form:'lyophilized powder',lot:'FIXTURE-NEXT-LOT',reportId:'SYNTHETIC-REPORT-2026',filename:'private-fixture-only.pdf',sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64'),chemicalIdentity:'SYNTHETIC TEST ONLY',sourceBasename:'PRIVATE_INTERNAL_SOURCE'};
const putOriginal=r=>sql.prepare('INSERT INTO coa_original_reports(sha256,data,enabled) VALUES(?,?,1)').run(r.sha256,JSON.stringify(r));
const save=(product,value)=>sql.prepare('INSERT INTO product_overrides(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(product.id,JSON.stringify({batch:value}));
const one=async product=>(await batch.resolveProductBatches(db,[product]))[0];
const row=async product=>(await batch.adminBatchRecords(db,[product]))[0];
(async()=>{try{
 let admin=await row(p),publicProduct=await one(p);assert.equal(admin.lot,initial.product_lot);assert.equal(publicProduct.resolvedBatch.product_lot,initial.product_lot);assert.equal(publicProduct.resolvedBatch.coa_available,initial.lot_match==='matches');assert.equal(testing.batchFor(p.id,publicProduct),publicProduct.resolvedBatch);assert(testing.batchRecordsFor([publicProduct]).includes(publicProduct.resolvedBatch));
 if(initial.lot_match==='matches'){assert.equal(testing.certificateFor(publicProduct.resolvedBatch).document_id,sourceDocument.document_id);assert.equal(admin.coaAvailable,true);}
 // Every public source association is exact; legacy report links remain staff-only.
 const initialProducts=await batch.resolveProductBatches(db,products), initialAdmin=await batch.adminBatchRecords(db,products);
 let withheld=0, available=0;
 for(const item of initialProducts){
  const r=item.resolvedBatch, source=testing.batchFor(item.id), sourceDoc=testing.certificateFor(source);
  if(r.certificate){available++;assert.equal(r.coa_available,true);assert.equal(r.lot_match,'matches');assert.equal(r.certificate.batch_number,r.product_lot);assert.equal(r.certificate_lot,r.product_lot);}
  if(sourceDoc && sourceDoc.batch_number!==source.product_lot){
   withheld++;assert.equal(r.certificate,undefined);assert.equal(r.document_id,null);assert.equal(r.certificate_lot,null);assert.equal(r.coa_pdf_url,undefined);assert.equal(r.hub_coa_link_url,undefined);assert.equal(r.has_certificate_pdf,false);assert.equal(r.coa_available,false);assert.equal(r.certificate_source_note,undefined);
   const a=initialAdmin.find(a=>a.productId===item.id);assert.equal(a.reportRef,null);assert.equal(a.attached,null);assert(a.choices.every(c=>!c.eligible));
  }
 }
 // KLOW, NAD+ and Run & Gun now carry label-lot reconciliations; Selank and Semax remain legacy mismatches.
 assert(withheld>=2&&available>0,'Both matched and legacy mismatched source records are exercised');
 const old=products.find(item=>item.slug==='selank'), oldRecord=testing.batchFor(old.id), oldDoc=testing.certificateFor(oldRecord);
 // Even a forged or stale persisted available flag cannot publish the wrong lot.
 save(old,{lot:oldRecord.product_lot,reportRef:'public:'+oldDoc.document_id,coaAvailable:true});
 const stale=(await one(old)).resolvedBatch;assert.equal(stale.document_id,null);assert.equal(stale.certificate,undefined);assert.equal(stale.coa_available,false);
 await assert.rejects(()=>batch.validateBatchEdit(db,old,{lot:oldRecord.product_lot,reportRef:'public:'+oldDoc.document_id,coaAvailable:true}),/exact product/);
 sql.prepare('DELETE FROM product_overrides WHERE id=?').run(old.id);
 for(const changedProduct of [{...p,sizes:['999mg']},{...p,identity:'Synthetic different identity'},{...p,name:'Synthetic different product'},{...p,categories:[{slug:'spray-products',name:'Spray products'}]}]){
  const r=(await one(changedProduct)).resolvedBatch;assert.equal(r.coa_available,false);assert.equal(r.document_id,null);assert.equal(r.certificate,undefined,'Identity, strength and format mismatches cannot inherit source certificates');
 }
 putOriginal(original);admin=await row(p);const candidate=admin.choices.find(c=>c.ref==='private:'+original.sha256);assert(candidate&&!candidate.eligible,'Different-lot report is visible to staff with a reason but cannot be marked available');assert.equal(candidate.url,'/api/store/admin-coa-original?ref='+encodeURIComponent(candidate.ref));
 const selected={lot:original.lot,reportRef:'private:'+original.sha256,coaAvailable:true};
 assert.deepEqual(await batch.validateBatchEdit(db,p,selected),selected);
 for(const invalid of [{...selected,lot:initial.product_lot},{...selected,lot:null},{...selected,reportRef:null},{...selected,reportRef:'https://unapproved.invalid/report.pdf'},{...selected,reportRef:'private:'+'f'.repeat(64)},{...selected,lot:'PRIVATE@BAD'},{...selected,coaAvailable:'yes'},{...selected,token:'PRIVATE_EXTRA_FIELD'}])await assert.rejects(()=>batch.validateBatchEdit(db,p,invalid));
 await assert.rejects(()=>batch.validateBatchEdit(db,heat,selected),/exact product|original report/,'A report for one product cannot be attached to another');
 save(p,selected);admin=await row(p);assert.equal(admin.attached.ref,selected.reportRef);assert.equal(admin.attached.eligible,true);assert.equal(admin.coaAvailable,true);
 publicProduct=await one({...p,batch:selected});assert.equal(publicProduct.batch,undefined);let resolved=publicProduct.resolvedBatch;assert.equal(resolved.product_lot,original.lot);assert.equal(resolved.coa_on_request,true);assert.equal(resolved.coa_available,true);assert.equal(resolved.has_certificate_pdf,false);assert.equal(resolved.document_id,null);assert.equal(testing.certificateFor(resolved),undefined);assert.equal(resolved.coa_pdf_url,undefined);
 const json=JSON.stringify(publicProduct);for(const forbidden of [original.sha256,original.base64,original.filename,original.sourceBasename,'private:'])assert(!json.includes(forbidden),'Public catalog excludes private original metadata: '+forbidden);
 let context=await batch.loadCoaBatchContext(db);assert.equal(coa.exactCoaReport(`COA request: ${p.name} / ${original.lot}`,context.originals,context.associations)?.sha256,original.sha256);assert.equal(coa.coaReportByHash(original.sha256,context.originals,context.associations)?.sha256,original.sha256);
 const second={...original,reportId:'SYNTHETIC-REPORT-OTHER',sha256:'b'.repeat(64),filename:'other-private-fixture.pdf'};putOriginal(second);context=await batch.loadCoaBatchContext(db);assert.equal(coa.exactCoaReport(`COA request: ${p.name} / ${original.lot}`,context.originals),null,'Unselected duplicate originals remain ambiguous');assert.equal(coa.exactCoaReport(`COA request: ${p.name} / ${original.lot}`,context.originals,context.associations)?.sha256,original.sha256,'An explicit association disambiguates duplicate subject originals');assert.equal(coa.coaReportByHash(second.sha256,context.originals,context.associations),null,'Queued unselected hash cannot substitute its report');sql.prepare('DELETE FROM coa_original_reports WHERE sha256=?').run(second.sha256);
 const disabled={...selected,coaAvailable:false};assert.deepEqual(await batch.validateBatchEdit(db,p,disabled),disabled);save(p,disabled);resolved=(await one(p)).resolvedBatch;assert.equal(resolved.coa_available,false);assert.equal(resolved.coa_on_request,false);assert.equal(testing.certificateFor(resolved),undefined);
 context=await batch.loadCoaBatchContext(db);assert.equal(coa.coaReportByHash(original.sha256,context.originals,context.associations),null,'Disabling current association blocks future private delivery');
 const changed={lot:'FIXTURE-NEWER-LOT',reportRef:null,coaAvailable:false};assert.deepEqual(await batch.validateBatchEdit(db,p,changed),changed);save(p,changed);resolved=(await one(p)).resolvedBatch;assert.equal(resolved.product_lot,changed.lot);assert.equal(resolved.coa_available,false);assert.equal(resolved.document_id,null);assert.equal(resolved.certificate_lot,null,'Lot edit never borrows old certificate');
 context=await batch.loadCoaBatchContext(db);assert.equal(coa.exactCoaReport(`COA request: ${p.name} / ${original.lot}`,context.originals,context.associations),null);
 for(const invalid of [null,{lot:original.lot,reportRef:selected.reportRef,coaAvailable:'true'},'PRIVATE_BATCH']){save(p,invalid);resolved=(await one(p)).resolvedBatch;assert.equal(resolved.coa_available,false);assert.equal(resolved.coa_on_request,false);assert.equal(resolved.document_id,null);}
 save(p,selected);sql.prepare('UPDATE coa_original_reports SET enabled=0 WHERE sha256=?').run(original.sha256);resolved=(await one(p)).resolvedBatch;assert.equal(resolved.coa_available,false);await assert.rejects(()=>batch.validateBatchEdit(db,p,selected),/original report/);
 assert.equal(fullReads,0,'Catalog/admin/eligibility read registry metadata only, never private PDF bytes');
 console.log('PASS: current-batch source fallback, exact product/strength/lot report eligibility, selected private-original metadata-only projection, no public private-ref/PDF leakage, disabled/changed-lot delivery rejection and malformed fail-closed behavior. Isolated synthetic originals only.');
}finally{sql.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
