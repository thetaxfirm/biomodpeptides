import styles from './quality-guide.module.css';

export function SupplierGuide() {
  return <article className={styles.guide}>
    <header className="page-heading">
      <h1>Choosing a research peptide supplier</h1>
      <p>Start with records you can check. A polished storefront or a high purity percentage does not establish what is in a vial. Evaluate the exact material, the documents for the supplied lot and the terms of sale before ordering for laboratory research.</p>
    </header>

    <section aria-labelledby="confirm-material" className={styles.section}>
      <h2 id="confirm-material">Confirm the exact material</h2>
      <p>Match the product name, chemical or peptide identity, physical form and labeled contents. Check whether an amount applies to one container, one ingredient in a blend or the whole pack. A similar name does not establish the same sequence, salt or formulation. If a specification conflicts with the label, ask the supplier to resolve it before ordering.</p>
    </section>

    <section aria-labelledby="check-lot-evidence" className={styles.section}>
      <h2 id="check-lot-evidence">Check the lot and the original report</h2>
      <p>Ask which lot will ship and compare it with the original Certificate of Analysis. Read the issuing laboratory, report reference, dates, sample identity and test methods. A certificate for an earlier or different lot cannot establish results for the material you receive.</p>
      <p>Read purity and measured content separately. A chromatographic percentage is not the milligrams in a vial. Identity, endotoxins, elemental impurities and sterility also require their own reported methods and results; an omitted test is not a pass. Keep the laboratory’s sampling limitations and reporting limits with its findings.</p>
      <p><a href="/testing">Find Biomod’s published batch records</a>, or use the <a href="/quality-standard">guide to reading a COA</a>. Published records do not promise the lot that will ship.</p>
    </section>

    <section aria-labelledby="request-handling-documents" className={styles.section}>
      <h2 id="request-handling-documents">Request missing handling documents</h2>
      <p>Ask for an authentic Safety Data Sheet and supplier-specific storage and handling information for the exact material. If those documents are missing, request them; do not substitute another supplier’s sheet or infer storage conditions from a similar product. A COA and a Safety Data Sheet serve different purposes.</p>
    </section>

    <section aria-labelledby="compare-order-contents" className={styles.section}>
      <h2 id="compare-order-contents">Compare the complete order</h2>
      <p>Compare like-for-like contents, container counts and formats. Include shipping and applicable tax in the total, and read processing, return and order-review terms. Price per milligram is meaningful only when the material and quantity basis match. <a href="/shop">Use the catalog’s product comparison</a> to review listed contents, prices and documentation together.</p>
    </section>

    <section aria-labelledby="resolve-open-questions" className={styles.section}>
      <h2 id="resolve-open-questions">Resolve open questions before ordering</h2>
      <p>Keep the supplier’s written response with your procurement records. <a href="/contact?subject=Research%20supplier%20documentation%20question">Contact Biomod about current documentation</a> if a lot, specification or document is unclear. These checks help assess evidence; they do not establish suitability for human or animal use.</p>
    </section>

    <footer className={styles.sources}>
      <p><a href="https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q7a-good-manufacturing-practice-guidance-active-pharmaceutical-ingredients">FDA Q7A, section 11.4</a> describes certificate contents in the API manufacturing context. It does not certify Biomod or other research suppliers.</p>
    </footer>
  </article>;
}
