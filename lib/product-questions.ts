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
    ? 'The laboratory\'s original report for the lot printed on the vial label is published with this product. Open it for the full methods and results.'
    : 'The lab report for this lot is being updated. Contact BIOMOD anytime for the latest documentation.';
  const nameQuestions: ProductQuestion[] = product.slug === 'bpc-157-10mg' ? [
    { id: 'name-variants', question: 'Are BPC157, BPC 157 and BPC-157 the same product name?', answer: [
      'BPC157 and BPC 157 are common spellings of BPC-157. This listing is BIOMOD BPC-157 10 mg, a single-compound vial. Check the strength, format and batch record when comparing listings; a similar name does not establish identical contents.',
    ] },
    { id: 'compare-blend', question: 'How does BPC-157 10 mg differ from Wolverine?', answer: [
      'BPC-157 10 mg lists BPC-157 alone. Wolverine lists BPC-157 + TB-500 as a blend. A blend’s total weight is not the amount of each ingredient, so the two listings are not interchangeable.',
    ] },
  ] : product.slug === 'wolverine-10mg' ? [
    { id: 'name-variants', question: 'What is the Wolverine peptide blend?', answer: [
      'BIOMOD Wolverine combines BPC-157 + TB-500 in a lyophilized powder vial. Searches for Wolverine peptide, Wolverine stack or BPC157 TB500 can refer to this combination, but other sellers may use those names for different strengths or separate-vial bundles. Compare the actual listing and batch record.',
    ] },
    { id: 'blend-contents', question: 'Does Wolverine 10 mg contain 10 mg of each ingredient?', answer: [
      'No. The listed 10 mg is the total blend content per vial, not 10 mg of BPC-157 plus 10 mg of TB-500. Use the matching batch record for reported component results; do not infer an equal split from the product name.',
    ] },
    { id: 'compare-blend', question: 'Is Wolverine the same as BPC-157 alone?', answer: [
      'No. Wolverine is a BPC-157 + TB-500 blend. The separate BPC-157 10 mg listing contains BPC-157 alone. Compare compound identity as well as total vial contents when choosing a product.',
    ] },
  ] : [];
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
    ...nameQuestions,
  ];
}
