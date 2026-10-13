// Company press releases, published on /news for readers, search engines and AI assistants.
// Every statement must be checkable on the live site: no quotes, rankings, efficacy,
// dosing, human-use or regulatory claims, and no BiomodPro cross-links while it is held.
export type PressRelease = {
  slug: string;
  date: string; // ISO publication date
  headline: string;
  summary: string; // subheadline and meta description, 160 characters or fewer
  body: string[];
  links: { label: string; href: string }[];
};

export const pressBoilerplate = 'Biomod Peptides is a U.S. Marine Corps veteran-owned supplier of lyophilized research peptide vials with retail roots in Las Vegas, Nevada. Its online store, TryBiomod.com, lists each product’s compound, container contents, 1, 3, 5 and 10-pack prices and its batch documentation. Products are sold for laboratory research only and are not for human or animal use.';
export const pressContact = 'contact@trybiomod.com';

export const pressReleases: PressRelease[] = [
  {
    slug: 'biomod-peptides-online-store-trybiomod',
    date: '2026-10-12',
    headline: 'Biomod Peptides Moves Online Store to TryBiomod.com',
    summary: 'Research buyers can now buy research peptides such as BPC-157 10mg, MOTS-c and SS-31 at TryBiomod.com, with batch records and 1, 3, 5 and 10-packs.',
    body: [
      'Biomod Peptides’ online store is now TryBiomod.com. Visitors to the company’s previous web address, biomodpeptides.com, are redirected to the new store.',
      'TryBiomod.com lists lyophilized research vials including BPC-157 10mg, MOTS-c 10mg and 40mg, SS-31 10mg and 50mg, NAD+ 500mg, Semax and Selank. Each product page shows the compound, the contents of each vial, the CAS number where one applies, and prices for single vials and for 3, 5 and 10-packs, including the price per vial and per milligram.',
      'Each product links to its batch record. The store’s batch library pairs each product with the laboratory report for the lot printed on its label, or a printed COA in the box. Available original laboratory reports are published with their stated methods, units and limitations.',
      'Orders ship within the United States to adults age 21 and older purchasing for laboratory research. Available shipping services and charges are shown at checkout before payment. Biomod does not provide dosing or medical advice.',
    ],
    links: [
      { label: 'Shop research peptides', href: '/shop' },
      { label: 'BPC-157 10mg research vial', href: '/product/bpc-157-10mg' },
      { label: 'Batch library', href: '/testing' },
      { label: 'How to buy research peptides', href: '/faq' },
    ],
  },
  {
    slug: 'guide-to-reading-peptide-coa',
    date: '2026-10-12',
    headline: 'Biomod Peptides Publishes Peptide COA Reading Guide',
    summary: 'A free guide at TryBiomod.com explains lot matching, chromatographic purity, measured content and the limits of a peptide Certificate of Analysis.',
    body: [
      'Biomod Peptides has published an online guide to reading peptide Certificates of Analysis (COAs) at TryBiomod.com. The guide explains how to compare a report with a product lot and how to read the methods, results and limitations stated by the laboratory.',
      'The guide distinguishes chromatographic purity from measured content. It explains why a purity percentage alone does not establish the milligrams in a vial, and why sterility and endotoxins are separate questions that need their own reported results.',
      'A worked example links to a listed BPC-157 batch record and its laboratory report. The guide states that a listed batch record is not a promise of the lot that will ship and that a report for one lot does not establish results for another.',
      'The guide and the related batch library are available without an account. A COA does not establish regulatory approval, clinical effectiveness or suitability for human or animal use.',
    ],
    links: [
      { label: 'Read the COA guide', href: '/quality-standard' },
      { label: 'Batch library', href: '/testing' },
      { label: 'Choosing a research peptide supplier', href: '/choosing-a-research-supplier' },
    ],
  },
];

export const pressReleaseAt = (path: string) => path.startsWith('/news/') ? pressReleases.find(release => release.slug === path.slice(6)) : undefined;
export const pressDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
