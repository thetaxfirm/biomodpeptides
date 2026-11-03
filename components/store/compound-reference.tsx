'use client';
import { useState, FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Product } from '@/lib/catalog';
import { compounds, compoundAt, comparisonAt, comparisons, comparisonsFor, compoundQuestions, publishedCompound, publishedComparison, pubchemUrl, type Compound } from '@/lib/compound-reference';
import { eligibleDiscovery, vialName } from '@/lib/product-discovery';
import { batchFor, batchPath, batchRecords, batchRecordsFor, batchStatusLabel, matchingCertificateFor, reportedResult } from '@/lib/testing';
import { collections, publishedCollection } from '@/lib/collections';
import { useStore } from './provider';
import styles from './compound-reference.module.css';

const productName = vialName;
const listed = (c: Compound, products: Product[]) => c.products.map(slug => products.find(p => p.slug === slug)).filter((p): p is Product => Boolean(p && eligibleDiscovery(p)));
const ruo = <p className={styles.ruo}>For laboratory research use only. Not for human or animal use. Biomod does not provide dosing or medical advice.</p>;

function Facts({ c }: { c: Compound }) {
  return <dl className={styles.facts}>
    <div><dt>CAS number</dt><dd>{c.cas}</dd></div>
    <div><dt>Molecular formula</dt><dd>{c.formula}</dd></div>
    <div><dt>Molecular weight</dt><dd>{c.weight} g/mol</dd></div>
    {c.sequence && <div className={styles.wide}><dt>Sequence{c.residues ? ` (${c.residues} residues)` : ''}</dt><dd>{c.sequence}</dd></div>}
    {c.aliases.length > 0 && <div className={styles.wide}><dt>Also listed as</dt><dd>{c.aliases.join(', ')}</dd></div>}
    <div><dt>PubChem record</dt><dd><a href={pubchemUrl(c)} rel="noopener" target="_blank">CID {c.cid}</a></dd></div>
  </dl>;
}

// The current Biomod lot for each product and, when its lot matches, the original lab results.
function Lots({ products }: { products: Product[] }) {
  if (!products.length) return null;
  return <div className={styles.lots}>{products.map(p => {
    const record = batchFor(p.id, p), doc = matchingCertificateFor(record);
    return <article key={p.id}>
      <h3><a href={'/product/' + p.slug}>{productName(p)}</a></h3>
      <dl>
        <div><dt>Lot on label</dt><dd>{record?.product_lot || 'Update in progress'}</dd></div>
        <div><dt>Lab report</dt><dd>{record ? batchStatusLabel(record) : 'Update in progress'}</dd></div>
        {doc && <><div><dt>Purity (reported)</dt><dd>{reportedResult(doc, 'purity')}</dd></div>
          <div><dt>Measured content</dt><dd>{reportedResult(doc, 'assay')}</dd></div>
          {doc.laboratory_name && <div><dt>Laboratory</dt><dd>{doc.laboratory_name}</dd></div>}</>}
      </dl>
      <div className={styles.links}>{record && <a href={batchPath(record)}>Batch record</a>}{doc?.url && <a href={doc.url} target="_blank" rel="noopener">Original COA (PDF)</a>}<a href={'/product/' + p.slug}>View product</a></div>
    </article>;
  })}</div>;
}

export function CompoundIndex() {
  const { store } = useStore();
  const shown = compounds.filter(publishedCompound);
  return <div className={styles.page}>
    <div className="page-heading"><h1>Compound reference</h1><p>CAS numbers, molecular formulas, molecular weights and sequences for every compound Biomod supplies, each linked to its PubChem record and to the lab report for the lot we ship.</p></div>
    <div className={styles.tableWrap}><table className={styles.table}>
      <caption className="sr-only">Compound identifiers and molecular data</caption>
      <thead><tr><th scope="col">Compound</th><th scope="col">CAS</th><th scope="col">Formula</th><th scope="col">Molecular weight (g/mol)</th><th scope="col">Biomod products</th></tr></thead>
      <tbody>{shown.map(c => <tr key={c.slug}><th scope="row"><a href={'/compounds/' + c.slug}>{c.name}</a></th><td>{c.cas}</td><td>{c.formula}</td><td>{c.weight}</td>
        <td>{listed(c, store.products).map(p => <a key={p.id} href={'/product/' + p.slug}>{productName(p)}</a>)}</td></tr>)}</tbody>
    </table></div>
    <section className={styles.section} aria-labelledby="compare-heading"><h2 id="compare-heading">Side-by-side comparisons</h2>
      <ul className={styles.plainList}>{comparisons.filter(publishedComparison).map(x => <li key={x.slug}><a href={'/compare/' + x.slug}>{compoundAt(x.a)!.name} vs {compoundAt(x.b)!.name}</a></li>)}</ul></section>
    <section className={styles.section} aria-labelledby="areas-heading"><h2 id="areas-heading">Shop by research area</h2>
      <ul className={styles.plainList}>{collections.filter(publishedCollection).map(x => <li key={x.slug}><a href={'/collections/' + x.slug}>{x.title}</a></li>)}</ul></section>
    <section className={styles.section} aria-labelledby="verify-heading"><h2 id="verify-heading">Check the lot on your vial</h2>
      <p>Enter the lot printed on your label to open its batch record and lab report.</p><a className="editorial-link" href="/verify">Verify a COA by lot number <ArrowRight size={17}/></a></section>
    {ruo}
  </div>;
}

export function CompoundPage({ slug }: { slug: string }) {
  const { store } = useStore();
  const c = compoundAt(slug)!;
  const products = listed(c, store.products);
  const questions = compoundQuestions(c, products.map(productName));
  const related = comparisonsFor(c.slug);
  return <div className={styles.page}>
    <nav aria-label="Breadcrumb" className={styles.crumbs}><a href="/compounds">Compound reference</a><span aria-hidden="true">/</span><span>{c.name}</span></nav>
    <div className="page-heading"><h1>{c.name}</h1><p>{c.summary}</p></div>
    <section className={styles.section} aria-labelledby="data-heading"><h2 id="data-heading">Reference data</h2><Facts c={c}/>
      <p className={styles.source}>Formula, molecular weight and sequence from PubChem CID {c.cid}. Molecular weight is the computed average mass of the neutral structure; a salt form such as an acetate weighs more.</p></section>
    <section className={styles.section} aria-labelledby="lots-heading"><h2 id="lots-heading">Biomod lots and lab reports</h2><Lots products={products}/></section>
    {related.length > 0 && <section className={styles.section} aria-labelledby="related-heading"><h2 id="related-heading">Compare</h2>
      <ul className={styles.plainList}>{related.map(x => <li key={x.slug}><a href={'/compare/' + x.slug}>{compoundAt(x.a)!.name} vs {compoundAt(x.b)!.name}</a></li>)}</ul></section>}
    <section className={styles.section} aria-labelledby="questions-heading"><h2 id="questions-heading">Questions</h2>
      <div className={styles.questions}>{questions.map(q => <div key={q.question}><h3>{q.question}</h3><p>{q.answer}</p></div>)}</div></section>
    {ruo}
  </div>;
}

export function ComparisonPage({ slug }: { slug: string }) {
  const { store } = useStore();
  const x = comparisonAt(slug)!, pair = [compoundAt(x.a)!, compoundAt(x.b)!];
  const rows: [string, (c: Compound) => string][] = [['CAS number', c => c.cas], ['Molecular formula', c => c.formula], ['Molecular weight', c => c.weight + ' g/mol'],
    ['Residues', c => c.residues ? String(c.residues) : 'See PubChem record'], ['Sequence', c => c.sequence || 'See PubChem record'], ['Also listed as', c => c.aliases.join(', ')]];
  return <div className={styles.page}>
    <nav aria-label="Breadcrumb" className={styles.crumbs}><a href="/compounds">Compound reference</a><span aria-hidden="true">/</span><span>{pair[0].name} vs {pair[1].name}</span></nav>
    <div className="page-heading"><h1>{pair[0].name} vs {pair[1].name}</h1><p>{x.intro}</p></div>
    <div className={styles.tableWrap}><table className={`${styles.table} ${styles.pair}`}>
      <caption className="sr-only">{pair[0].name} and {pair[1].name} compared</caption>
      <thead><tr><td/>{pair.map(c => <th key={c.slug} scope="col"><a href={'/compounds/' + c.slug}>{c.name}</a></th>)}</tr></thead>
      <tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th>{pair.map(c => <td key={c.slug} className={label === 'Sequence' ? styles.sequence : undefined}>{value(c)}</td>)}</tr>)}
        <tr><th scope="row">PubChem</th>{pair.map(c => <td key={c.slug}><a href={pubchemUrl(c)} target="_blank" rel="noopener">CID {c.cid}</a></td>)}</tr></tbody>
    </table></div>
    {pair.map(c => <section key={c.slug} className={styles.section} aria-labelledby={c.slug + '-lots'}><h2 id={c.slug + '-lots'}>{c.name} from Biomod</h2><p>{c.summary}</p><Lots products={listed(c, store.products)}/></section>)}
    {ruo}
  </div>;
}

export function VerifyCoa() {
  const { store } = useStore();
  const [lot, setLot] = useState('');
  const [missing, setMissing] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const wanted = lot.trim().toLowerCase();
    if (!wanted) return;
    const record = [...batchRecordsFor(store.products), ...batchRecords].find(r => String(r.product_lot || '').toLowerCase() === wanted);
    if (record) window.location.assign(batchPath(record));
    else setMissing(lot.trim());
  }
  return <div className={styles.page}>
    <div className="page-heading"><h1>Verify your COA by lot number</h1><p>Every Biomod vial label carries a lot number, such as 202-10-0001. Enter it to open the batch record for that lot and the original laboratory report when one is published.</p></div>
    <form className={styles.verify} onSubmit={submit} role="search" aria-label="Find a lot">
      <label htmlFor="verify-lot">Lot number on your label</label>
      <div><input id="verify-lot" name="lot" value={lot} onChange={e => { setLot(e.target.value); setMissing(''); }} placeholder="e.g. 202-10-0001" autoComplete="off" inputMode="text" required/>
        <button className="button button-dark" type="submit">Find lot</button></div>
      {missing && <p role="status" className={styles.missing}>No Biomod lot matches {missing}. Check the label for the full lot, or <a href={'/contact?subject=' + encodeURIComponent('COA for lot ' + missing)}>send us the lot</a> and we will reply with its record.</p>}
    </form>
    <section className={styles.section} aria-labelledby="verify-how"><h2 id="verify-how">What the record shows</h2>
      <p>The batch record lists the product, the lot printed on the label, its manufacture and expiry dates, and whether the laboratory report covers that exact lot. Matching reports show the laboratory, report number, reported purity and measured content, with the original PDF.</p>
      <p><a href="/testing">Browse all batch documents</a> or read <a href="/quality-standard">how to read a COA</a>.</p></section>
    {ruo}
  </div>;
}
