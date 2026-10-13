import { packSizes } from './packs';

// Research FAQ content. The /faq page renders it and its FAQPage structured data reads it.
// 'shipping-area' is rendered with live shipping terms, so it stays out of the markup.
const packOptions = packSizes.slice(0, -1).join(', ') + ' or ' + packSizes.at(-1);

export const researchFaqGroups = [
  {
    id: 'buying',
    title: 'Buying research peptides',
    questions: [
      {
        id: 'how-to-buy',
        question: 'How do I buy research peptides from Biomod?',
        answer: `Open the shop, choose a product such as BPC-157 10mg, MOTS-c or SS-31, and select a single vial or a ${packOptions.replace(/^1, /, '')}-pack. Each product lists its contents, price per vial and per mg, and its batch record. Add it to your cart and check out. Orders ship within the United States to adults age 21 and older purchasing for laboratory research.`,
        href: '/shop',
        link: 'Shop research peptides',
      },
    ],
  },
  {
    id: 'product-documents',
    title: 'Certificates and product records',
    questions: [
      {
        id: 'find-coa',
        question: 'Where can I find a Certificate of Analysis?',
        answer: 'Open Batch documents and select a product. Each lab report shows its lot, methods and results; match its lot to the label on your vial.',
        href: '/testing',
        link: 'Find a product or lot in the batch library',
      },
      {
        id: 'match-coa',
        question: 'How do I match a certificate to my product?',
        answer: 'Compare the product name, stated amount and lot number on the certificate with the product record and the supplied label. Check the laboratory, report reference and date. If the lot numbers differ, ask Biomod for the relevant report. A report for another lot does not establish results for yours.',
        href: '/quality-standard#match-the-lot',
        link: 'Read the lot-matching example',
      },
      {
        id: 'purity-and-content',
        question: 'What is the difference between purity and measured content?',
        answer: 'Chromatographic purity is a method-specific percentage. Assay reports measured content in the units shown on the certificate. A purity percentage alone does not tell you the milligrams in a vial. Keep the report’s units and qualifications with each result.',
        href: '/quality-standard#read-the-results',
        link: 'Understand the individual tests',
      },
      {
        id: 'pending-documentation',
        question: 'What does Update in progress mean?',
        answer: 'The lab report for the current lot is being added to the library. Ask Biomod anytime for the latest documentation on a lot.',
        href: '/contact?subject=Product%20lot%20and%20COA%20question',
        link: 'Ask about a product lot or certificate',
      },
    ],
  },
  {
    id: 'pack-options',
    title: 'Singles and packs',
    questions: [
      {
        id: 'pack-contents',
        question: 'What do the 1, 3, 5 and 10-pack options include?',
        answer: `Pack sizes count containers: ${packOptions} complete vials or bottles. A product-page pack contains that many of the same product; the listed contents apply to each vial or bottle. Build a Pack lets you choose eligible products or add multiples of one product. Availability and quantity limits apply. Review the displayed pack total before adding it to your cart.`,
        href: '/multi-pack',
        link: 'Choose products for a pack',
      },
    ],
  },
  {
    id: 'shipping-and-orders',
    title: 'Shipping and orders',
    questions: [
      {
        id: 'shipping-area',
        question: 'Where does Biomod ship?',
        answer: 'Biomod ships within the United States. Available shipping services and charges are shown at checkout before payment.',
        href: '/shipping-policy',
        link: 'Read the shipping policy',
      },
      {
        id: 'order-processing',
        question: 'When will my order be processed?',
        answer: 'For products ready to ship, weekday orders placed before 2 p.m. Pacific normally process the same business day, excluding federal holidays. Preorders follow the estimate shown on each product. Orders containing preorder items ship together when all items are ready. Orders placed later normally process the next business day. Order review may extend processing.',
        href: '/shipping-policy',
        link: 'Review processing and delivery information',
      },
      {
        id: 'order-problem',
        question: 'What if my order is damaged or incorrect?',
        answer: 'Contact contact@trybiomod.com within 48 hours of delivery with your order number and photos of the product and packaging. Read the Returns & Refunds policy for details.',
        href: '/returns-refunds',
        link: 'Read the returns and refunds policy',
      },
    ],
  },
  {
    id: 'research-use',
    title: 'Research use',
    questions: [
      {
        id: 'purchasing-eligibility',
        question: 'Who can purchase Biomod products?',
        answer: 'Products are available to adults age 21 and older for laboratory, analytical, and scientific research. They are not for human or animal use.',
        href: '/research-use-only',
        link: 'Read the research-use policy',
      },
      {
        id: 'medical-advice',
        question: 'Can you provide dosing or medical advice?',
        answer: 'No. Biomod supplies products for research and does not provide dosing, treatment, or medical guidance.',
        href: '/research-use-only',
        link: 'Review the scope of research use',
      },
    ],
  },
];

export const researchFaqSchemaItems = () => researchFaqGroups.flatMap(group => group.questions).filter(item => item.id !== 'shipping-area');
