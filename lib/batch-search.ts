import type { Product } from './catalog';
import { productSearchScore, searchWords } from './product-search';
import { certificateFor, coaOnRequest } from './testing';

type SearchableBatch = {
  product_id: number;
  product_lot?: string | null;
  certificate_lot?: string | null;
  document_id?: string | null;
};

// Match whole public identifiers, retaining every digit and leading zero. Spaces
// and hyphens may differ, but an identifier fragment is not a product strength.
function withoutIdentifiers(words: string[], identifiers: string[]): string[] {
  const keys = new Set(identifiers.map(value => searchWords(value).join('')).filter(Boolean));
  const longest = Math.max(0, ...Array.from(keys, key => key.length));
  const remaining: string[] = [];
  for (let start = 0; start < words.length; start++) {
    let key = '', matchedEnd = -1;
    for (let end = start; end < words.length; end++) {
      key += words[end];
      if (key.length > longest) break;
      // Never consume a requested quantity and leave its unit behind.
      if (keys.has(key) && !/^(mg|mcg|g|ml)$/.test(words[end + 1] || '')) matchedEnd = end;
    }
    if (matchedEnd >= start) start = matchedEnd;
    else remaining.push(words[start]);
  }
  return remaining;
}

export function batchMatchesSearch(record: SearchableBatch, product: Product | undefined, query: string): boolean {
  const words = searchWords(query.slice(0, 200));
  if (!words.length) return true;
  if (!product || product.id !== record.product_id) return false;

  // Only public storefront fields and this record's displayed metadata qualify.
  // Restricted records must never match an unpublished certificate's metadata.
  const document = coaOnRequest(record) ? undefined : certificateFor(record);
  const identifiers = [product.sku, record.product_lot,
    ...(!coaOnRequest(record) ? [record.certificate_lot, document?.report_id] : []),
  ].filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  const remaining = withoutIdentifiers(words, identifiers);
  if (!remaining.length) return true;

  // Product names, reviewed aliases, form and listed contents use the existing
  // matcher. Keep identifier digits out of its free-text product vocabulary.
  return productSearchScore({ ...product, sku: '', casNumber: '' }, remaining.join(' ')) > 0;
}
