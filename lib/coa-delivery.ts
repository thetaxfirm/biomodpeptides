// Backend only. Original reports live in private D1, never in source or public assets.
import { products, productFormat } from './catalog';
import { batchFor } from './testing';

export type OriginalCoa = {
  productId: number; productName: string; strength: string; form: string; lot: string;
  reportId: string; filename: string; sha256: string; base64: string; chemicalIdentity: string; sourceBasename: string;
};
export const COA_TEMPLATE_VERSION = 'original-coa-v1';
export const COA_MAX_BYTES = 8 * 1024 * 1024;
export type OriginalCoaMetadata = Omit<OriginalCoa,'base64'|'sourceBasename'>;
const canonical = (value: string) => value.trim().toLowerCase();
export const coaEmail = (value: unknown): string | null => typeof value === 'string' && value.length <= 254 && !/[\x00-\x1f\x7f]/.test(value) && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
export function coaSender(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) return null;
  const cleaned = value.trim(), match = /^(?:[^<>]+ <([^<>]+)>|([^<>]+))$/.exec(cleaned);
  return match && coaEmail(match[1] || match[2]) ? cleaned : null;
}
export const isCoaRequest = (subject: unknown) => typeof subject === 'string' && /\bCOA\b|certificate of analysis/i.test(subject);
export function exactCoaReport(subject: unknown, originals: readonly OriginalCoaMetadata[]): OriginalCoaMetadata | null {
  if (typeof subject !== 'string') return null;
  const matches = originals.filter(report => canonical(subject) === canonical(`COA request: ${report.productName} / ${report.lot}`));
  if (matches.length !== 1) return null;
  const report = matches[0], product = products.find(item => item.id === report.productId), batch = batchFor(report.productId);
  // A future catalog/lot change never silently inherits this report association.
  if (!product || !batch || productFormat(product) !== 'Vial' || product.categories.some(category => category.slug !== 'research-compounds') || product.name !== report.productName || product.sizes.length !== 1 || product.sizes[0] !== report.strength ||
      batch.product_lot !== report.lot || batch.product_name !== report.productName || report.form !== 'lyophilized powder' ||
      !report.reportId || !report.chemicalIdentity || !/^[a-f0-9]{64}$/.test(report.sha256)) return null;
  return report;
}
export const approvedCoaReportCount = (originals: readonly OriginalCoaMetadata[]) => originals.filter(report => exactCoaReport(`COA request: ${report.productName} / ${report.lot}`, originals) === report).length;
export function coaReportByHash(hash: string, originals: readonly OriginalCoaMetadata[]): OriginalCoaMetadata | null {
  const matches = originals.filter(item => item.sha256 === hash);
  return matches.length === 1 ? exactCoaReport(`COA request: ${matches[0].productName} / ${matches[0].lot}`, originals) : null;
}
const metadataKeys = ['productId','productName','strength','form','lot','reportId','filename','sha256','chemicalIdentity'] as const;
function validatedMetadata(value:unknown, hash:unknown):OriginalCoaMetadata|null {
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))return null;
 const data=value as Record<string,unknown>;
 if(data.sha256!==hash||!Number.isSafeInteger(data.productId)||Number(data.productId)<=0||data.form!=='lyophilized powder')return null;
 const limits={productName:150,strength:50,form:40,lot:100,reportId:150,filename:184,sha256:64,chemicalIdentity:300};
 for(const [key,max] of Object.entries(limits)){const text=data[key];if(typeof text!=='string'||!text.trim()||text.length>max||/[\x00-\x1f\x7f]/.test(text))return null;}
 if(!/^[^/\\\x00-\x1f\x7f]{1,180}\.pdf$/i.test(String(data.filename)))return null;
 return Object.fromEntries(metadataKeys.map(key=>[key,data[key]])) as OriginalCoaMetadata;
}
/** Metadata only: private PDF bytes/provenance are not read for administration or eligibility. */
export async function loadCoaReports(db:D1Database):Promise<OriginalCoaMetadata[]> {
 const rows=(await db.prepare("SELECT sha256,CASE WHEN json_valid(data) THEN json_remove(data,'$.base64','$.sourceBasename') ELSE NULL END AS metadata FROM coa_original_reports WHERE enabled=1 ORDER BY sha256 LIMIT 101").all<{sha256:string;metadata:string|null}>()).results;
 if(rows.length>100)throw new Error('Approved COA registry requires review.');
 const reports:OriginalCoaMetadata[]=[];
 for(const row of rows){let value:unknown;try{value=JSON.parse(row.metadata||'null');}catch{throw new Error('Approved COA registry requires review.');}const report=validatedMetadata(value,row.sha256);if(!report)throw new Error('Approved COA registry requires review.');reports.push(report);}
 return reports;
}
/** Full original is fetched by approved hash only at the send boundary, never from a URL. */
export async function readCoaOriginal(db:D1Database,expected:OriginalCoaMetadata):Promise<OriginalCoa|null>{
 const row=await db.prepare('SELECT data FROM coa_original_reports WHERE sha256=? AND enabled=1 AND length(data)<=?').bind(expected.sha256,Math.ceil(COA_MAX_BYTES/3)*4+10000).first<{data:string}>();
 if(!row)return null;
 let data:OriginalCoa;try{data=JSON.parse(row.data);}catch{return null;}
 const metadata=validatedMetadata(data,expected.sha256);
 if(!metadata||JSON.stringify(metadata)!==JSON.stringify(Object.fromEntries(metadataKeys.map(key=>[key,expected[key]])))||typeof data.base64!=='string')return null;
 return {...metadata,base64:data.base64,sourceBasename:''};
}
export async function coaHash(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifiedCoaAttachment(report: OriginalCoa): Promise<{ filename: string; content: string }> {
  if (!/^[^/\\\x00-\x1f\x7f]{1,180}\.pdf$/i.test(report.filename) || !/^[A-Za-z0-9+/]*={0,2}$/.test(report.base64) || report.base64.length > Math.ceil(COA_MAX_BYTES / 3) * 4) throw new Error('original_integrity_failed');
  const bytes = Buffer.from(report.base64, 'base64');
  if (!bytes.length || bytes.length > COA_MAX_BYTES || bytes.toString('base64') !== report.base64 || bytes.subarray(0, 5).toString() !== '%PDF-' || await coaHash(bytes) !== report.sha256) throw new Error('original_integrity_failed');
  return { filename: report.filename, content: report.base64 };
}
export function coaMessage(report: OriginalCoaMetadata) {
  return {
    subject: `Original COA: ${report.productName} / ${report.lot}`,
    text: `Attached is the original laboratory report for ${report.productName}, ${report.strength} ${report.form}, lot ${report.lot}.\n\nReport: ${report.reportId}\nChemical identity in the original report: ${report.chemicalIdentity}\n\nCompare the report's lot with the vial you receive. Results apply to the submitted sample; this report does not confirm which lot will ship. The attachment has not been edited.\n\nFor laboratory research only, not for human or animal use. Please reply with any documentation questions.\n\nBIOMOD`,
  };
}
