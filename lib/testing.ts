import source from './coas-source-v1.json';
import additions from './coas-additions-v1.json';
import reconciliations from './coas-reconciliations-v1.json';
import { products } from './catalog';
export const laboratoryDocuments = [...source.documents, ...reconciliations.documents] as any[];
export const batchRecords = [...source.records, ...additions].filter(record => products.some(product => product.id === record.product_id)).map(record => {
  // A reviewed certificate association is specific to the source record, product
  // identity, size and listed lot. Future catalog or source changes fail closed.
  const review = reconciliations.reconciliations.find(item => item.product_id === record.product_id && item.product_slug === record.product_slug && item.product_lot === record.product_lot && item.previous_document_id === record.document_id);
  if (!review) return record;
  const product = products.find(item => item.id === review.product_id);
  const document = reconciliations.documents.find(item => item.document_id === review.document_id);
  if (!product || record.public_identity !== review.expected_identity || product.slug !== review.product_slug || product.identity !== review.expected_identity || product.sizes.length !== 1 || product.sizes[0] !== review.expected_size ||
      !document?.is_certificate || document.report_to !== 'BIOMOD PEPTIDES' || document.compound !== review.expected_identity || document.nominal_amount.replace(/\s/g, '') !== review.expected_size || document.batch_number !== review.product_lot) return record;
  return { ...record, document_id: document.document_id, coa_pdf_url: document.url, hub_coa_link_url: document.url,
    has_certificate_pdf: true, certificate_lot: document.batch_number, lot_match: 'matches', coa_status: 'Matching-lot certificate',
    source_url: review.source_url, verification_urls: document.verification_urls, review_issues: document.report_scope_notes,
    certificate_dates: { test_date: document.test_date, issue_date: document.issue_date, report_date: document.report_date, release_date: document.release_date, sample_received_date: document.sample_received_date },
    recorded_on: review.recorded_on, certificate_source_note: review.source_note, previous_document_id: review.previous_document_id };
}) as any[];
export const batchFor = (id:number) => batchRecords.find(r=>r.product_id===id);
export const certificateFor = (r:any) => r && laboratoryDocuments.find(d=>d.document_id===r.document_id&&d.is_certificate);
export const coaOnRequest = (r:any) => [744, 745, 746, 747, 1389].includes(Number(r?.product_id));
export const coaRequestNotice = 'A printed Certificate of Analysis (COA) is included in the box with your order.';
export const batchStatus = (r:any) => coaOnRequest(r)?'on-request':!certificateFor(r)?'pending':r.lot_match==='matches'?'matched':'mismatch';
export const batchStatusLabel = (r:any) => coaOnRequest(r)?'Printed COA included with order':batchStatus(r)==='matched'?'Matching-lot certificate':batchStatus(r)==='mismatch'?'Lot needs confirmation':'Documentation pending';
export const reportedResult = (d:any,kind:string) => d?.results?.filter((r:any)=>r.kind===kind).map((r:any)=>r.result+(r.unit&&!r.result.includes(r.unit)?' '+r.unit:'')).join('; ') || 'Not reported';
export const batchPath = (r:any) => '/testing/'+encodeURIComponent(r.product_lot && !/^pending|not listed$/i.test(r.product_lot)?r.product_lot:r.record_id)+'?product='+r.product_id;
