import { ArrowRight } from 'lucide-react';
import { pressBoilerplate, pressContact, pressDate, pressReleases } from '@/lib/press-releases';
import styles from './quality-guide.module.css';

export function Newsroom() {
  return <article className={styles.guide}>
    <header className="page-heading">
      <h1>News and press releases</h1>
      <p>Announcements from Biomod Research Supply Company and TryBiomod.com. Media enquiries: <a href={'mailto:' + pressContact}>{pressContact}</a>.</p>
    </header>
    {pressReleases.map(release => <section className={styles.section} key={release.slug} aria-labelledby={'release-' + release.slug}>
      <p className="muted"><time dateTime={release.date}>{pressDate(release.date)}</time></p>
      <h2 id={'release-' + release.slug}><a href={'/news/' + release.slug}>{release.headline}</a></h2>
      <p>{release.summary}</p>
      <a className="editorial-link" href={'/news/' + release.slug}>Read the release <ArrowRight size={17}/></a>
    </section>)}
  </article>;
}

export function PressReleasePage({ slug }: { slug: string }) {
  const release = pressReleases.find(item => item.slug === slug);
  if (!release) return null;
  return <article className={styles.guide}>
    <p className="breadcrumbs"><a href="/news">News</a> / Press release</p>
    <header className="page-heading">
      <h1>{release.headline}</h1>
      <p>{release.summary}</p>
    </header>
    <section className={styles.section} aria-label="Release">
      <p><strong>LAS VEGAS, Nevada, <time dateTime={release.date}>{pressDate(release.date)}</time></strong>. {release.body[0]}</p>
      {release.body.slice(1).map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      <ul>{release.links.map(link => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}</ul>
    </section>
    <section className={styles.section} aria-labelledby="about-biomod">
      <h2 id="about-biomod">About Biomod Research Supply Company</h2>
      <p>{pressBoilerplate}</p>
      <p>Media contact: <a href={'mailto:' + pressContact}>{pressContact}</a></p>
    </section>
  </article>;
}
