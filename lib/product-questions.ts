import { type Product } from './catalog';
import { packContents, packSizes, supportsPacks } from './packs';
import { batchFor, batchStatus, coaRequestNoticeFor } from './testing';

// Product page questions. The visible "Product questions" section and the FAQPage
// structured data both read this list, so the markup can never drift from the page.
export type ProductQuestion = { id: string; question: string; answer: string[] };

// "BPC-157 10mg", or the bare name when the size is already part of it or unknown.
export function productLabel(product: Product) {
  const contents = packContents(product).replace(/\s*\/\s*(vial|bottle)/i, '');
  return contents && !product.name.toLowerCase().includes(contents.toLowerCase()) ? `${product.name} ${contents}` : product.name;
}

export function productQuestions(product: Product): ProductQuestion[] {
  const packOptions = packSizes.slice(0, -1).join(', ') + ' or ' + packSizes.at(-1);
  const multiPacks = packSizes.slice(1, -1).join(', ') + ' or ' + packSizes.at(-1);
  const status = batchStatus(batchFor(product.id, product));
  const documentation = status === 'on-request' ? coaRequestNoticeFor(batchFor(product.id, product)) : status === 'matched'
    ? 'A certificate is published with a lot number matching this listing. Confirm the lot supplied with your order and read the original report for its methods and results.'
    : 'Contact BIOMOD to request the COA for the listed lot.';
  return [
    { id: 'buy', question: `How do I buy ${productLabel(product)}?`, answer: [
      supportsPacks(product)
        ? `Choose a single vial or a ${multiPacks}-pack on this page and add it to your cart, then check out.`
        : 'Choose a quantity on this page and add it to your cart, then check out.',
      'Orders ship within the United States to adults age 21 and older purchasing for laboratory research. Available shipping services and charges are shown at checkout before payment.',
    ] },
    { id: 'contents', question: 'What is included in a single vial or pack?', answer: [
      `The listed contents for one ${product.name} vial are ${packContents(product) || 'not provided'}.${product.sku ? ` SKU: ${product.sku}.` : ''}`,
      `Pack sizes of ${packOptions} count complete vials. The listed contents apply to each vial. Availability and quantity limits apply.`,
    ] },
    { id: 'documentation', question: 'What documentation is available for this product?', answer: [documentation] },
  ];
}
