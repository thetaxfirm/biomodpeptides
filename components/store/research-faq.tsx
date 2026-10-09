import { packSizes } from '@/lib/packs';
import styles from './research-faq.module.css';

const packOptions = packSizes.slice(0, -1).join(', ') + ' or ' + packSizes.at(-1);

const groups = [
  {
    id: 'product-documents',
    title: 'Certificates and product records',
    questions: [
      {
        id: 'find-coa',
        question: 'Where can I find a Certificate of Analysis?',
        answer: 'Open Testing Results and select a product. Available certificates identify their own batch, methods, and results. Pending documentation is shown as pending. Always compare the certificate lot with the product lot.',
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
        question: 'What does documentation pending mean?',
        answer: 'No original certificate is available in the published record. This is not a completed test result. Ask Biomod about the documentation for the lot being supplied.',
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
        answer: 'Biomod ships within the United States. Standard shipping is free on orders of $200 or more after discounts and before tax.',
        href: '/shipping-policy',
        link: 'Read the shipping policy',
      },
      {
        id: 'order-processing',
        question: 'When will my order be processed?',
        answer: 'Weekday orders placed before 2 p.m. Pacific normally process the same business day, excluding federal holidays. Orders placed later normally process the next business day. Order review may extend processing.',
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

export function ResearchFAQ() {
  return <article className={styles.faq}>
    <header className="page-heading">
      <h1>Frequently asked questions</h1>
      <p>Product documents, pack sizes, shipping and research-use requirements.</p>
    </header>
    {groups.map(group => <section className={styles.group} aria-labelledby={group.id} key={group.id}>
      <h2 id={group.id}>{group.title}</h2>
      <div className={styles.answers}>{group.questions.map(item => <div className={styles.answer} key={item.id}>
        <h3 id={item.id}>{item.question}</h3>
        <p>{item.answer}</p>
        <a href={item.href}>{item.link}</a>
      </div>)}</div>
    </section>)}
  </article>;
}
