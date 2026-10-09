import { batchFor, batchStatus, certificateFor, reportedResult } from './testing';

// Published only for a certificate whose lot matches the listed product lot, mirroring the product page.
export function certificateProperties(productId: number) {
  const record = batchFor(productId), doc = certificateFor(record);
  if (!record || !doc || batchStatus(record) !== 'matched') return [];
  const value = (name: string, v: unknown, extra: Record<string, string> = {}) => v && v !== 'Not reported' ? [{ '@type': 'PropertyValue', name, value: String(v), ...extra }] : [];
  return [...value('Certificate lot', record.certificate_lot), ...value('Purity (reported)', reportedResult(doc, 'purity')),
    ...value('Measured content (reported)', reportedResult(doc, 'assay')), ...value('Certificate report date', doc.report_date || doc.release_date || doc.issue_date),
    ...value('Certificate of analysis', doc.report_id || 'Original PDF', doc.url ? { url: doc.url } : {})];
}
