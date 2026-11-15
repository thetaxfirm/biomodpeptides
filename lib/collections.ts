import publication from './seo-publication-v1.json';
import specificationReviews from './product-specification-review-v1.json';
import { compoundForProduct } from './compound-reference';

// Shop collections: published products grouped by what the compounds are (their structural
// origin or the research field they are catalogued under) or by supplied format, never by an outcome. Intros state
// structural facts already given on the compound reference pages. A collection is indexed
// while at least two of its products are published, so no collection is a one-product page.
// byFormat marks a collection grouped by how the product is supplied; it has no compound reference table.
export type Collection = { slug: string; name: string; title: string; description: string; intro: string; products: string[]; byFormat?: boolean };

export const collections: Collection[] = [
  { slug: 'growth-hormone-axis', name: 'Growth Hormone Axis', title: 'Growth Hormone Axis Peptides',
    description: 'CJC-1295 No DAC, Tesamorelin, AOD 9604 and Run & Gun research peptide vials: GHRH analogs and an hGH fragment, with lab reports by lot.',
    intro: 'Synthetic analogs of growth hormone-releasing hormone (GHRH) and a fragment of human growth hormone. CJC-1295 No DAC is a modified GHRH (1-29) sequence, Tesamorelin is GHRH (1-44) with an N-terminal trans-3-hexenoyl group, and AOD 9604 is hGH (177-191) with an added tyrosine. Run & Gun combines CJC-1295 No DAC with Ipamorelin.',
    products: ['cjc-1295-no-dac-10mg', 'tesamorelin-10mg', 'aod-9604-10mg', 'run-gun-10mg'] },
  { slug: 'mitochondrial-research', name: 'Mitochondrial Research', title: 'Mitochondrial Peptides and NAD+',
    description: 'MOTS-c, SS-31 and NAD+ research vials in 10 mg to 500 mg sizes, with CAS, molecular data and lab reports for each lot.',
    intro: 'Compounds catalogued under mitochondrial research. MOTS-c is a 16-amino-acid sequence encoded within the mitochondrial 12S rRNA gene, SS-31 is a synthetic four-residue Szeto-Schiller compound, and NAD+ is the dinucleotide coenzyme that carries electrons in cellular respiration.',
    products: ['mots-c-10mg', 'mots-c-40mg', 'ss-31-10mg', 'ss-31-50mg', 'nad-500mg'] },
  { slug: 'neuroscience-research', name: 'Neuroscience Research', title: 'Neuroscience Research Peptides',
    description: 'Semax, Selank and DSIP research peptide vials: short synthetic sequences with CAS, formula, molecular weight and lab reports by lot.',
    intro: 'Short synthetic sequences catalogued under neuroscience research. Semax extends the ACTH (4-7) fragment with Pro-Gly-Pro, Selank extends tuftsin with the same Pro-Gly-Pro, and DSIP is a nine-amino-acid sequence first isolated from rabbit cerebral venous blood.',
    products: ['semax', 'selank', 'dsip-10mg'] },
  { slug: 'melanocortin-research', name: 'Melanocortin Research', title: 'Melanocortin Research Peptides',
    description: 'PT-141 and KPV research peptide vials, both derived from alpha-MSH, with CAS, sequence data and lab reports by lot.',
    intro: 'Compounds derived from alpha-melanocyte-stimulating hormone (α-MSH). PT-141 (bremelanotide) is a cyclic seven-amino-acid α-MSH analog; KPV is Lys-Pro-Val, α-MSH residues 11 to 13.',
    products: ['pt-141-10mg', 'kpv-10mg'] },
  { slug: 'coenzymes-antioxidants', name: 'Coenzymes and Antioxidants', title: 'NAD+ and Glutathione Research Supply',
    description: 'NAD+ 500 mg and reduced L-glutathione research vials, with CAS, molecular formula and lab reports for each lot.',
    intro: 'NAD+ (nicotinamide adenine dinucleotide) is a dinucleotide coenzyme of cellular redox reactions. Reduced L-glutathione (GSH) is γ-L-glutamyl-L-cysteinylglycine, the most abundant low-molecular-weight thiol in cells.',
    products: ['nad-500mg', 'glutathione-reduced-l-glutathione'] },
  { slug: 'thymosins', name: 'Thymosins', title: 'Thymosin Research Peptides',
    description: 'Thymosin Alpha-1 and TB-500 research peptide vials, with CAS, sequence data and lab reports by lot.',
    intro: 'Thymosins were first isolated from thymosin fraction 5 of calf thymus. Thymosin alpha-1 (thymalfasin) is an N-acetylated 28-amino-acid sequence; TB-500 is a synthetic sequence derived from thymosin beta-4.',
    products: ['thymosin-alpha-1-10mg', 'tb500-10mg'] },
  { slug: 'research-blends', name: 'Research Blends', title: 'Research Peptide Blends',
    description: 'Biomod multi-compound research vials such as Run & Gun, Wolverine, KLOW and GLOW, with every compound and lab report listed.',
    intro: 'Vials that combine two or more compounds. Each product page lists every compound in the vial, the lot printed on its label and the laboratory report for that lot.',
    products: ['run-gun-10mg', 'wolverine-10mg', 'wolverine-20mg', 'klow-80mg', 'glow-70mg'] },
  { slug: 'research-sprays', name: 'Research Sprays', title: 'Research Peptide Sprays',
    description: 'Biomod research compounds in spray bottles: Semax, Selank, BPC-157, NAD+, GHK-Cu, PT-141 and Melanotan II, with total content per bottle.',
    intro: 'Research compounds supplied as a solution in a spray bottle instead of a lyophilized vial. Each product page lists the compound, the total content per bottle and the available batch record. APEX is Semax, EQUIL is Selank, FORGE is BPC-157, FLUX is NAD+, GLOW is GHK-Cu, SOLARA is Melanotan II, IGNITE combines PT-141 with oxytocin, and KLOW combines GHK-Cu, BPC-157 and KPV.',
    products: ['apex-semax-spray', 'equil-selank-spray', 'forge-bpc-157-spray', 'flux-nad-spray', 'glow-spray', 'ignite-pt-141-oxy-spray', 'klow-spray', 'solara-melanotan-ii-spray', 'noctis-blend-spray', 'zenith-semax-selank-spray'], byFormat: true },
];

const holds = specificationReviews as Record<string, string>;
const published = (slug: string) => publication.productSlugs.includes(slug) && !holds[slug];
export const collectionAt = (slug: string) => collections.find(c => c.slug === slug);
export const publishedProducts = (c: Collection) => c.products.filter(published);
export const publishedCollection = (c?: Collection) => Boolean(c && publishedProducts(c).length >= 2);
// Collections a published product belongs to, for links from its own page.
export const collectionsFor = (productSlug: string) => published(productSlug) ? collections.filter(c => c.products.includes(productSlug) && publishedCollection(c)) : [];
// Compound reference pages for the collection's published products, in product order, once each.
export const collectionCompounds = (c: Collection) => publishedProducts(c).map(compoundForProduct).filter((x, i, all): x is NonNullable<typeof x> => Boolean(x) && all.indexOf(x) === i);
