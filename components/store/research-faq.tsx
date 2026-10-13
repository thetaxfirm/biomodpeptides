import { shippingTerms } from '@/lib/shipping-terms';
import { useStore } from './provider';
import { researchFaqGroups as groups } from '@/lib/research-faq';
import styles from './research-faq.module.css';

export function ResearchFAQ() {
  const {store, ready, loadError} = useStore();
  const terms = shippingTerms(ready && !loadError ? store.config : null);
  return <article className={styles.faq}>
    <header className="page-heading">
      <h1>Frequently asked questions</h1>
      <p>Product documents, pack sizes, shipping and research-use requirements.</p>
    </header>
    {groups.map(group => <section className={styles.group} aria-labelledby={group.id} key={group.id}>
      <h2 id={group.id}>{group.title}</h2>
      <div className={styles.answers}>{group.questions.map(item => <div className={styles.answer} key={item.id}>
        <h3 id={item.id}>{item.question}</h3>
        <p>{item.id === 'shipping-area' ? 'Biomod ships within the United States. ' + terms.standard : item.answer}</p>
        <a href={item.href}>{item.link}</a>
      </div>)}</div>
    </section>)}
  </article>;
}
