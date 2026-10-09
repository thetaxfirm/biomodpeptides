import { batchFor, batchPath, certificateFor } from '@/lib/testing';
import styles from './quality-guide.module.css';

const checks = [
  ['Identity', 'Check the stated compound and the method used to identify it. A product name in the heading alone does not establish a peptide sequence or chemical form.'],
  ['Purity and assay', 'Read these separately. Chromatographic purity describes a method-specific result; the assay reports measured content with its own units. A purity percentage alone does not tell you the milligrams in a vial.'],
  ['Elemental impurities', 'Read each analyte, result, unit and reporting limit. Keep qualifiers such as ND (non-detect) with the result; do not turn them into a claim of zero impurities.'],
  ['Microbiological tests', 'Look for the actual methods and results for endotoxins or sterility, if tested. A purity result does not answer these questions. Read the laboratory’s limits and sample qualifications.'],
];

export function QualityGuide() {
  const example = batchFor(753);
  const certificate = certificateFor(example);
  return <article className={styles.guide}>
    <header className="page-heading">
      <h1>How to read a peptide COA</h1>
      <p>A Certificate of Analysis records laboratory results for a submitted sample. Start with the lot number, then read the methods, values and limitations in the original report.</p>
      <a className="button button-dark" href="/testing">Find a product or lot</a>
    </header>

    <section aria-labelledby="match-the-lot" className={styles.section}>
      <h2 id="match-the-lot">Match the report to the lot</h2>
      <p>Compare the product name, stated amount and lot number on the certificate with the product record and the label on the supplied vial. Check the laboratory name, report reference, report date and any retest or expiry date.</p>
      <p>If the numbers differ, ask Biomod to confirm the documentation for the lot being supplied. A report for another lot does not establish results for yours.</p>
      {example && certificate && example.lot_match === 'matches' && <aside className={styles.example} aria-label="Example from the batch library">
        <h3>Example from the batch library: {example.product_name}</h3>
        <dl>
          <div><dt>Listed lot</dt><dd>{example.product_lot}</dd></div>
          <div><dt>Laboratory</dt><dd>{certificate.laboratory_name}</dd></div>
          <div><dt>Report reference</dt><dd>{certificate.report_id}</dd></div>
        </dl>
        <a className="editorial-link" href={batchPath(example)}>Open this batch record</a>
        <p>This is a listed record, not a promise of the lot that will ship. Confirm the supplied lot before relying on its report.</p>
      </aside>}
    </section>

    <section aria-labelledby="read-the-results" className={styles.section}>
      <h2 id="read-the-results">Read each test on its own terms</h2>
      <dl className={styles.checks}>{checks.map(([title, description]) => <div key={title}><dt>{title}</dt><dd>{description}</dd></div>)}</dl>
      <p>Keep the laboratory’s units, inequality signs and qualifications intact. The original PDF takes precedence over a storefront summary.</p>
    </section>

    <section aria-labelledby="document-status" className={styles.section}>
      <h2 id="document-status">What the library status means</h2>
      <dl className={styles.checks}>
        <div><dt>Matching-lot certificate</dt><dd>The certificate lot matches the listed product lot. This describes the document match; read the report for test scope and results.</dd></div>
        <div><dt>Lot needs confirmation</dt><dd>A certificate is available, but its lot has not been matched to the listed product. Ask for the relevant report before relying on it.</dd></div>
        <div><dt>Documentation pending</dt><dd>No original certificate is available in the published record. This is not a completed test result.</dd></div>
      </dl>
    </section>

    <section aria-labelledby="report-limitations" className={styles.section}>
      <h2 id="report-limitations">Read the laboratory’s limitations</h2>
      <p>The Vanguard report linked in the example limits its results to the portion of the sample tested and states that the laboratory did not select the sample or verify that it represents the batch. A matching lot number does not remove those limitations.</p>
      <p>A COA does not establish regulatory approval, clinical effectiveness or suitability for human or animal use. Biomod research products are supplied for laboratory research only.</p>
      <p>Use the <a href="/choosing-a-research-supplier">research supplier checklist</a> to compare identity, lot documentation, handling records and complete order costs.</p>
      <a className="editorial-link" href="/contact?subject=Product%20lot%20and%20COA%20question">Ask about a product lot or report</a>
    </section>

    <footer className={styles.sources}>
      <h2>Source documents</h2>
      <p><a href="https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q7a-good-manufacturing-practice-guidance-active-pharmaceutical-ingredients">FDA Q7A guidance, section 11.4: Certificates of Analysis</a>. This reference explains certificate contents in its API manufacturing context; it does not certify Biomod or its products.</p>
      {example && certificate && <p><a href={batchPath(example)}>Original laboratory report and record for {example.product_name}</a>.</p>}
    </footer>
  </article>;
}
