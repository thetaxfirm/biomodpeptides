// Server only: resolve approved report associations without moving private originals into public data.
import { products as sourceProducts, productFormat, type Product } from './catalog';
import { batchFor, certificateFor, laboratoryDocuments } from './testing';
import { loadCoaReports, type OriginalCoaMetadata, type CoaBatchAssociation } from './coa-delivery';

export type ProductBatch = { lot: string | null; reportRef: string | null; coaAvailable: boolean };
export type BatchReportChoice = { ref: string; lot: string; reportId: string; filename: string; url?: string; strength: string; productName: string; identityEligible: boolean; eligible: boolean; reason?: string };
export type AdminBatchRecord = ProductBatch & { productId: number; attached: BatchReportChoice | null; choices: BatchReportChoice[] };
const lotPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const refPattern = /^(?:public:[A-Za-z0-9._-]+|private:[a-f0-9]{64})$/;
const cleanLot = (lot: unknown): string | null => typeof lot === 'string' && lotPattern.test(lot.trim()) && !/^(?:pending|not listed)$/i.test(lot.trim()) ? lot.trim() : null;
const equalBatch = (a: ProductBatch, b: ProductBatch) => a.lot === b.lot && a.reportRef === b.reportRef && a.coaAvailable === b.coaAvailable;
function readBatch(value: unknown): ProductBatch | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(k => !['lot', 'reportRef', 'coaAvailable'].includes(k)) || typeof v.coaAvailable !== 'boolean') return null;
    if (v.lot !== null && (typeof v.lot !== 'string' || !lotPattern.test(v.lot.trim()))) return null;
    if (v.reportRef !== null && (typeof v.reportRef !== 'string' || v.reportRef.length > 200 || !refPattern.test(v.reportRef))) return null;
    return { lot: v.lot === null ? null : cleanLot(v.lot), reportRef: v.reportRef as string | null, coaAvailable: v.coaAvailable };
}
function sameProduct(product: Product, expected: Product) {
    return product.id === expected.id && product.slug === expected.slug && product.name === expected.name && product.identity === expected.identity && productFormat(product) === productFormat(expected) && JSON.stringify(product.sizes) === JSON.stringify(expected.sizes);
}
function privateMatches(product: Product, report: OriginalCoaMetadata) {
    return product.id === report.productId && product.name === report.productName && productFormat(product) === 'Vial' && product.categories.every(c => c.slug === 'research-compounds') && product.sizes.length === 1 && product.sizes[0] === report.strength && report.form === 'lyophilized powder';
}
function publicDocuments(product: Product) {
    const source = sourceProducts.find(p => p.id === product.id), record = batchFor(product.id);
    if (!source || !record || !sameProduct(product, source)) return [];
    // Only reviewed source associations, never a filename/name guess or an arbitrary URL.
    const ids = new Set([record.document_id, record.previous_document_id].filter(Boolean));
    return laboratoryDocuments.filter(d => ids.has(d.document_id) && d.is_certificate === true && typeof d.sha256 === 'string' && /^[a-f0-9]{64}$/.test(d.sha256) && cleanLot(d.batch_number) && typeof d.report_id === 'string' && d.report_id && typeof d.filename === 'string' && /\.pdf$/i.test(d.filename) && typeof d.url === 'string' && /^https:\/\//.test(d.url));
}
const normalizedName = (value: unknown) => typeof value === 'string' ? value.toLowerCase().replace(/[\s_-]/g, '') : '';
const normalizedStrength = (value: unknown) => typeof value === 'string' ? value.toLowerCase().replace(/\s/g, '').replace(/\/vial$/, '') : '';
function publicIdentityEligible(product: Product, document: any) {
    if (productFormat(product) !== 'Vial' || product.categories.some(c => c.slug !== 'research-compounds') || product.sizes.length !== 1) return false;
    const record = batchFor(product.id), names = [product.name, product.identity];
    // This spelling alias is already the documented source association, not a fuzzy match.
    if (product.id === 759 && product.name === 'Epitalon') names.push('Epithalon');
    const amountSuffix = /\s*(?:-\s*)?(\d+(?:\.\d+)?\s*mg)\s*$/i;
    const sample = String(document.sample_name || ''), sampleAmount = sample.match(amountSuffix)?.[1];
    const sampleName = sample.replace(amountSuffix, '');
    const expectedNames = new Set(names.map(normalizedName));
    const components = (value: string) => value.split(/[+/]/).map(normalizedName).sort().join('|');
    const identityMatches = expectedNames.has(normalizedName(document.compound || sampleName)) || components(document.compound || sampleName) === components(product.identity);
    const reportedStrength = document.nominal_amount || sampleAmount;
    const strengthMatches = reportedStrength ? normalizedStrength(reportedStrength) === normalizedStrength(product.sizes[0]) : null;
    const formMatches = !document.form || /^(?:lyophilized powder|lyophilized peptide|lyophilized)$/i.test(document.form);
    if (!identityMatches || strengthMatches === false || !formMatches) return false;
    // Keep the exact reviewed, matching source tuple functional when its visibility
    // is switched off and back on. No assay result or filename supplies strength.
    const reviewedCurrent = record?.document_id === document.document_id && record?.lot_match === 'matches' && record?.product_lot === document.batch_number;
    return Boolean(reviewedCurrent || strengthMatches === true);
}
function defaults(product: Product, originals: OriginalCoaMetadata[]): ProductBatch {
    const record = batchFor(product.id), lot = cleanLot(record?.product_lot), document = certificateFor(record);
    const reports = originals.filter(r => privateMatches(product, r) && r.lot === lot);
    if (reports.length === 1) return { lot, reportRef: 'private:' + reports[0].sha256, coaAvailable: true };
    const sourceDocument = document && publicDocuments(product).find(d => d.document_id === document.document_id);
    const eligible = Boolean(sourceDocument && lot && sourceDocument.batch_number === lot && record.lot_match === 'matches' && publicIdentityEligible(product, sourceDocument));
    return { lot, reportRef: eligible ? 'public:' + sourceDocument.document_id : null, coaAvailable: eligible };
}
async function overrides(db: D1Database) {
    const rows = (await db.prepare("SELECT id,json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.batch') AS batch FROM product_overrides WHERE json_type(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.batch') IS NOT NULL").all<{ id: number; batch: string | null }>()).results;
    const values = new Map<number, ProductBatch | null>();
    for (const row of rows) { let value: unknown; try { value = typeof row.batch === 'string' ? JSON.parse(row.batch) : row.batch; } catch { value = null; } values.set(row.id, readBatch(value)); }
    return values;
}
function effective(product: Product, originals: OriginalCoaMetadata[], values: Map<number, ProductBatch | null>) {
    // Invalid stored settings cannot inherit a previously available original.
    return values.has(product.id) ? values.get(product.id) || { lot: defaults(product, originals).lot, reportRef: null, coaAvailable: false } : defaults(product, originals);
}
function choicesFor(product: Product, lot: string | null, originals: OriginalCoaMetadata[]): BatchReportChoice[] {
    const choices: BatchReportChoice[] = publicDocuments(product).map(d => {
        const identityEligible = publicIdentityEligible(product, d), eligible = identityEligible && Boolean(lot && lot === d.batch_number);
        return { ref: 'public:' + d.document_id, lot: d.batch_number, reportId: d.report_id, filename: d.filename, url: d.url, strength: product.sizes.join(', '), productName: product.name, identityEligible, eligible,
            ...(eligible ? {} : { reason: identityEligible ? 'The certificate lot does not match the current selling lot.' : 'The certificate needs exact product, nominal strength and format review before a new association.' }) };
    });
    for (const r of originals.filter(r => r.productId === product.id)) {
        const identity = privateMatches(product, r), eligible = identity && Boolean(lot && r.lot === lot);
        choices.push({ ref: 'private:' + r.sha256, lot: r.lot, reportId: r.reportId, filename: r.filename, url: '/api/store/admin-coa-original?ref=' + encodeURIComponent('private:' + r.sha256), strength: r.strength, productName: r.productName, identityEligible: identity, eligible, ...(eligible ? {} : { reason: identity ? 'The original report lot does not match the current selling lot.' : 'The original report product, strength or format does not match this product.' }) });
    }
    return choices;
}
export async function adminBatchRecords(db: D1Database, products: Product[]): Promise<AdminBatchRecord[]> {
    const [originals, values] = await Promise.all([loadCoaReports(db), overrides(db)]);
    return products.map(product => { const batch = effective(product, originals, values), choices = choicesFor(product, batch.lot, originals); return { productId: product.id, ...batch, attached: choices.find(c => c.ref === batch.reportRef) || null, choices }; });
}
export async function validateBatchEdit(db: D1Database, product: Product, value: unknown): Promise<ProductBatch> {
    const batch = readBatch(value); if (!batch) throw new Error('Enter a valid current lot and select an original COA from this product’s reports.');
    const [originals, values] = await Promise.all([loadCoaReports(db), overrides(db)]), before = effective(product, originals, values);
    if (batch.coaAvailable && (!batch.lot || !batch.reportRef)) throw new Error('A current lot and matching original report are required before marking the COA available.');
    if (batch.reportRef) {
        const choice = choicesFor(product, batch.lot, originals).find(c => c.ref === batch.reportRef);
        const legacy = defaults(product, originals);
        const unchangedLegacyMismatch = equalBatch(batch, before) && equalBatch(batch, legacy) && !batch.coaAvailable && Boolean(choice) && !choice!.eligible;
        if (!choice || (!choice.eligible && !unchangedLegacyMismatch)) throw new Error('Select an original report matching this exact product, strength, format and current selling lot.');
    }
    return batch;
}
function publicCertificate(document: any) {
    const keys = ['document_id','url','filename','pages','content_type','kind','is_certificate','laboratory_name','report_to','sample_name','compound','nominal_amount','batch_number','report_id','report_date','test_date','issue_date','release_date','sample_received_date','verification_urls','verification_checked','notes','report_scope_notes'];
    const result = Object.fromEntries(keys.filter(key => document[key] !== undefined).map(key => [key, document[key]]));
    const resultKeys = ['kind','analyte','result','method','unit','status','specification','loq','page','footnote'];
    return { ...result, results: (Array.isArray(document.results) ? document.results : []).map((r: any) => Object.fromEntries(resultKeys.filter(key => r[key] !== undefined).map(key => [key, r[key]]))) };
}
function resolved(product: Product, batch: ProductBatch, originals: OriginalCoaMetadata[], preserveSource = true) {
    const source = batchFor(product.id), choice = choicesFor(product, batch.lot, originals).find(c => c.ref === batch.reportRef);
    const isPrivate = Boolean(choice?.eligible && batch.coaAvailable && choice.ref.startsWith('private:'));
    const legacy = defaults(product, originals);
    // Inventory's current lot and selected report must agree before any report
    // metadata or link can leave the server. Legacy mismatches remain staff-only.
    const document = choice?.eligible && batch.coaAvailable && choice.ref.startsWith('public:') ? publicDocuments(product).find(d => 'public:' + d.document_id === choice.ref) : null;
    const matched = Boolean(document && document.batch_number === batch.lot && batch.coaAvailable);
    return {
        record_id: source?.record_id || 'biomod-product-' + product.id, product_id: product.id, product_name: product.name, product_slug: product.slug,
        product_url: 'https://trybiomod.com/product/' + product.slug, public_identity: product.identity, sku: product.sku,
        product_lot: batch.lot, certificate_lot: document?.batch_number || null, document_id: document?.document_id || null,
        has_certificate_pdf: Boolean(document), lot_match: matched ? 'matches' : 'not_verifiable',
        coa_status: isPrivate ? 'Original COA available on request' : matched ? 'Matching-lot certificate' : 'Documentation pending',
        coa_available: Boolean(isPrivate || matched), coa_on_request: isPrivate, ...(document ? { certificate: publicCertificate(document), coa_pdf_url: document.url, hub_coa_link_url: document.url } : {}),
        ...(isPrivate ? { report_id: choice!.reportId } : {}),
        review_issues: [],
        ...(matched && preserveSource && equalBatch(batch, legacy) && batch.reportRef === 'public:' + source?.document_id ? { certificate_source_note: source?.certificate_source_note || undefined, recorded_on: source?.recorded_on || undefined } : {}),
    };
}
export async function resolveProductBatches(db: D1Database, products: Product[]): Promise<Product[]> {
    const [originals, values] = await Promise.all([loadCoaReports(db), overrides(db)]);
    return products.map(product => { const { batch: _privateBatch, ...safe } = product as Product & { batch?: ProductBatch }; return { ...safe, resolvedBatch: resolved(product, effective(product, originals, values), originals, !values.has(product.id)) }; });
}
/** Delivery rechecks the selected original. A later lot edit never substitutes another attachment. */
export async function loadCoaBatchContext(db: D1Database): Promise<{ originals: OriginalCoaMetadata[]; associations: CoaBatchAssociation[] }> {
    const [originals, values] = await Promise.all([loadCoaReports(db), overrides(db)]);
    return { originals, associations: sourceProducts.map(product => ({ productId: product.id, ...effective(product, originals, values) })) };
}
