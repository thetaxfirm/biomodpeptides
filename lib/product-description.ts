import { type Product, compound, cas, productFormat } from './catalog';
import { packContents, packSizes, supportsPacks, packUnit } from './packs';
import { batchFor, batchStatus, matchingCertificateFor, reportedResult, coaRequestNoticeFor } from './testing';
import { productLabel } from './product-questions';

// Product description paragraphs, assembled only from the records this site already
// publishes for the product: catalog identity, listed contents, SKU, CAS, the batch record
// that matches the vial label, and the pack options. The visible Description tab and the
// Product structured data both read this list, so neither can drift from the records.
// Nothing here describes effects, dosing or use; the facts are the listing itself.
export function productDescription(product: Product): string[] {
  const label = productLabel(product);
  const identity = compound(product);
  const contents = packContents(product);
  const format = productFormat(product);
  const container = format === 'Vial' ? 'research vial' : format === 'Softgels' ? 'softgel bottle' : format === 'Spray' ? 'spray bottle' : 'research supply';
  const identifiers = [product.sku?.trim() ? 'SKU ' + product.sku.trim() : '', cas(product) ? 'CAS ' + cas(product) : ''].filter(Boolean).join(', ');
  const listing = `${label} from Biomod Research Supply Company is supplied as a single ${container}`
    + (contents ? ` with listed contents of ${contents.replace(/\s*\/\s*(vial|bottle)$/i, '')} per ${packUnit(product)}` : '')
    + (identifiers ? ` (${identifiers})` : '') + '.'
    + (identity && identity !== product.name ? ` The listed identity is ${identity}.` : '');

  const record = batchFor(product.id, product);
  const status = batchStatus(record);
  const doc = status === 'matched' ? matchingCertificateFor(record) : undefined;
  const lot = typeof record?.product_lot === 'string' && record.product_lot.trim() && !/^(?:pending|not listed)$/i.test(record.product_lot.trim()) ? record.product_lot.trim() : '';
  const reported = (kind: string) => { const value = doc ? reportedResult(doc, kind) : 'Not reported'; return value === 'Not reported' ? '' : value; };
  const reportDate = doc ? doc.report_date || doc.release_date || doc.issue_date || '' : '';
  const batch = status === 'on-request' ? coaRequestNoticeFor(record)
    : doc && lot ? `The batch record published with this product covers lot ${lot}.`
      + (reportDate ? ` The laboratory report dated ${reportDate}` : ' The laboratory report')
      + ([reported('purity') ? ` lists purity of ${reported('purity')}` : '', reported('assay') ? ` measured content of ${reported('assay')}` : ''].filter(Boolean).join(' and') || ' is published with this product')
      + '. Match the lot on your vial label to the record before relying on it.'
    : lot ? `The lab report for lot ${lot} is being updated. Contact BIOMOD anytime for the latest documentation.`
    : 'The lab report for this lot is being updated. Contact BIOMOD anytime for the latest documentation.';

  const packs = supportsPacks(product)
    ? `Order a single ${packUnit(product)} or a ${packSizes.slice(1, -1).join(', ')} or ${packSizes.at(-1)}-pack; each pack price on this page is shown per ${packUnit(product)}.`
    : '';
  const blendNote = product.slug === 'wolverine-10mg' ? 'Wolverine lists BPC-157 + TB-500 with 10 mg total blend content per vial, not 10 mg of each ingredient. It differs from the BPC-157 10 mg single-compound vial. The full-length versus fragment specification of the TB-500 component remains under review; contact BIOMOD for the current specification.' : '';
  return [listing + (blendNote ? ' ' + blendNote : ''), batch, packs].filter(Boolean);
}
