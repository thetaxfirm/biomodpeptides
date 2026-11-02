import publication from './seo-publication-v1.json';
import specificationReviews from './product-specification-review-v1.json';

// Reference pages for each compound Biomod supplies: identifiers, formula, molecular weight and
// sequence, then the Biomod lots and lab reports for that compound. Every molecular value comes
// from the PubChem record named by `cid` (retrieved November 2, 2026, by CAS number); a sequence
// is shown only where PubChem states it as a synonym or IUPAC name. No dosing, handling,
// human-use or outcome statements belong here.
export type Compound = {
  slug: string;
  name: string;
  aliases: string[];
  summary: string;
  cas: string;
  cid: number;
  formula: string;
  weight: string; // g/mol, as PubChem computes it
  sequence?: string;
  residues?: number;
  products: string[]; // single-compound listings first, then blends that contain it
};

export const compounds: Compound[] = [
  { slug: 'aod-9604', name: 'AOD 9604', aliases: ['AOD-9604', 'Tyr-hGH 177-191'], cas: '221231-10-3', cid: 71300630, formula: 'C78H123N23O23S2', weight: '1815.1',
    summary: 'AOD 9604 is a synthetic analog of the C-terminal region (residues 177 to 191) of human growth hormone with an added N-terminal tyrosine.', products: ['aod-9604-10mg'] },
  { slug: 'bpc-157', name: 'BPC-157', aliases: ['BPC157', 'BPC 157', 'Body Protection Compound 157'], cas: '137525-51-0', cid: 9941957, formula: 'C62H98N16O22', weight: '1419.5',
    sequence: 'Gly-Glu-Pro-Pro-Pro-Gly-Lys-Pro-Ala-Asp-Asp-Ala-Gly-Leu-Val', residues: 15,
    summary: 'BPC-157 is a synthetic 15-amino-acid sequence, named Body Protection Compound 157, first described as a partial sequence of a protein isolated from gastric juice.', products: ['bpc-157-10mg'] },
  { slug: 'cjc-1295-no-dac', name: 'CJC-1295 No DAC', aliases: ['Mod GRF 1-29', 'Modified GRF (1-29)', 'CJC-1295 without DAC'], cas: '863288-34-0', cid: 56841945, formula: 'C152H252N44O42', weight: '3367.9',
    sequence: 'Tyr-D-Ala-Asp-Ala-Ile-Phe-Thr-Gln-Ser-Tyr-Arg-Lys-Val-Leu-Ala-Gln-Leu-Ser-Ala-Arg-Lys-Leu-Leu-Gln-Asp-Ile-Leu-Ser-Arg-NH2', residues: 29,
    summary: 'CJC-1295 No DAC, also called Mod GRF 1-29, is a modified 29-amino-acid analog of growth hormone-releasing hormone (GHRH 1-29) without the drug affinity complex (DAC).', products: ['cjc-1295-no-dac-10mg', 'run-gun-10mg'] },
  { slug: 'dsip', name: 'DSIP', aliases: ['Emideltide'], cas: '62568-57-4', cid: 68816, formula: 'C35H48N10O15', weight: '848.8',
    sequence: 'Trp-Ala-Gly-Gly-Asp-Ala-Ser-Gly-Glu', residues: 9,
    summary: 'DSIP (emideltide) is a nine-amino-acid sequence first isolated in 1977 from rabbit cerebral venous blood.', products: ['dsip-10mg'] },
  { slug: 'epitalon', name: 'Epitalon', aliases: ['Epithalon', 'Ala-Glu-Asp-Gly', 'AEDG'], cas: '307297-39-8', cid: 219042, formula: 'C14H22N4O9', weight: '390.35',
    sequence: 'Ala-Glu-Asp-Gly', residues: 4,
    summary: 'Epitalon is the synthetic four-amino-acid sequence Ala-Glu-Asp-Gly.', products: ['epitalon-50mg'] },
  { slug: 'ghk-cu', name: 'GHK-Cu', aliases: ['Prezatide Copper', 'GHK copper complex'], cas: '89030-95-5', cid: 71587328, formula: 'C14H23CuN6O4+', weight: '402.92',
    sequence: 'Gly-His-Lys · Cu(II)', residues: 3,
    summary: 'GHK-Cu (prezatide copper) is the copper(II) complex of glycyl-L-histidyl-L-lysine. CAS 89030-95-5 identifies the copper complex; copper-free GHK is a separate substance (49557-75-7).', products: ['ghk-cu-50mg'] },
  { slug: 'glutathione', name: 'Glutathione', aliases: ['Reduced L-Glutathione', 'GSH'], cas: '70-18-8', cid: 124886, formula: 'C10H17N3O6S', weight: '307.33',
    sequence: 'γ-Glu-Cys-Gly', residues: 3,
    summary: 'Reduced L-glutathione (GSH) is γ-L-glutamyl-L-cysteinylglycine, a three-residue thiol compound.', products: ['glutathione-reduced-l-glutathione'] },
  { slug: 'kisspeptin-10', name: 'Kisspeptin-10', aliases: ['Kisspeptin', 'Metastin (45-54)'], cas: '374675-21-5', cid: 25240297, formula: 'C63H83N17O14', weight: '1302.4',
    summary: 'Kisspeptin-10 is the C-terminal ten-amino-acid fragment of kisspeptin, the product of the KISS1 gene.', products: ['kisspeptin-10mg'] },
  { slug: 'kpv', name: 'KPV', aliases: ['Lys-Pro-Val', 'α-MSH (11-13)'], cas: '67727-97-3', cid: 125672, formula: 'C16H30N4O4', weight: '342.43',
    sequence: 'Lys-Pro-Val', residues: 3,
    summary: 'KPV is Lys-Pro-Val, the C-terminal three-amino-acid sequence (residues 11 to 13) of alpha-melanocyte-stimulating hormone.', products: ['kpv-10mg'] },
  { slug: 'mots-c', name: 'MOTS-c', aliases: ['MOTSc', 'Mitochondrial ORF of the 12S rRNA type-c'], cas: '1627580-64-6', cid: 146675088, formula: 'C101H152N28O22S2', weight: '2174.6',
    sequence: 'Met-Arg-Trp-Gln-Glu-Met-Gly-Tyr-Ile-Phe-Tyr-Pro-Arg-Lys-Leu-Arg', residues: 16,
    summary: 'MOTS-c is a 16-amino-acid sequence encoded within the mitochondrial 12S rRNA gene.', products: ['mots-c-10mg', 'mots-c-40mg'] },
  { slug: 'nad', name: 'NAD+', aliases: ['Nicotinamide Adenine Dinucleotide', 'Nadide', 'β-NAD'], cas: '53-84-9', cid: 5892, formula: 'C21H27N7O14P2', weight: '663.4',
    summary: 'NAD+ (nicotinamide adenine dinucleotide, nadide) is a dinucleotide coenzyme made of nicotinamide and adenine nucleotides joined through their phosphate groups.', products: ['nad-500mg'] },
  { slug: 'pt-141', name: 'PT-141', aliases: ['Bremelanotide', 'PT141'], cas: '189691-06-3', cid: 9941379, formula: 'C50H68N14O10', weight: '1025.2',
    summary: 'PT-141 (bremelanotide) is a synthetic cyclic seven-amino-acid analog of alpha-melanocyte-stimulating hormone.', products: ['pt-141-10mg'] },
  { slug: 'selank', name: 'Selank', aliases: ['TP-7'], cas: '129954-34-3', cid: 11765600, formula: 'C33H57N11O9', weight: '751.9',
    sequence: 'Thr-Lys-Pro-Arg-Pro-Gly-Pro', residues: 7,
    summary: 'Selank is a synthetic seven-amino-acid analog of tuftsin (Thr-Lys-Pro-Arg) extended with Pro-Gly-Pro.', products: ['selank'] },
  { slug: 'semax', name: 'Semax', aliases: ['ACTH (4-7) Pro-Gly-Pro', 'MEHFPGP'], cas: '80714-61-0', cid: 9811102, formula: 'C37H51N9O10S', weight: '813.9',
    sequence: 'Met-Glu-His-Phe-Pro-Gly-Pro', residues: 7,
    summary: 'Semax is a synthetic seven-amino-acid sequence: the ACTH (4-7) fragment Met-Glu-His-Phe extended with Pro-Gly-Pro.', products: ['semax'] },
  { slug: 'ss-31', name: 'SS-31', aliases: ['Elamipretide', 'MTP-131'], cas: '736992-21-5', cid: 11764719, formula: 'C32H49N9O5', weight: '639.8',
    sequence: 'D-Arg-Dmt-Lys-Phe-NH2', residues: 4,
    summary: 'SS-31 (elamipretide) is a synthetic four-residue Szeto-Schiller compound, D-Arg-Dmt-Lys-Phe-NH2, where Dmt is 2′,6′-dimethyltyrosine.', products: ['ss-31-10mg', 'ss-31-50mg'] },
  { slug: 'tesamorelin', name: 'Tesamorelin', aliases: ['TH9507'], cas: '218949-48-5', cid: 16137828, formula: 'C221H366N72O67S', weight: '5136',
    summary: 'Tesamorelin is a synthetic analog of growth hormone-releasing hormone (GHRH 1-44) carrying a trans-3-hexenoyl group at the N-terminus.', products: ['tesamorelin-10mg'] },
  { slug: 'thymosin-alpha-1', name: 'Thymosin Alpha-1', aliases: ['Thymalfasin', 'Tα1'], cas: '62304-98-7', cid: 16130571, formula: 'C129H215N33O55', weight: '3108.3',
    summary: 'Thymosin alpha-1 (thymalfasin) is an N-acetylated 28-amino-acid sequence originally isolated from thymosin fraction 5 of calf thymus.', products: ['thymosin-alpha-1-10mg'] },
];

// Side-by-side pages for pairs researchers compare. Each states only structural facts.
export type Comparison = { slug: string; a: string; b: string; intro: string };
export const comparisons: Comparison[] = [
  { slug: 'semax-vs-selank', a: 'semax', b: 'selank',
    intro: 'Semax and Selank are both synthetic seven-amino-acid sequences that end in Pro-Gly-Pro. They differ in the four residues before it: Semax carries the ACTH (4-7) fragment Met-Glu-His-Phe, Selank carries tuftsin, Thr-Lys-Pro-Arg.' },
  { slug: 'cjc-1295-no-dac-vs-tesamorelin', a: 'cjc-1295-no-dac', b: 'tesamorelin',
    intro: 'CJC-1295 No DAC and Tesamorelin are both synthetic analogs of growth hormone-releasing hormone. CJC-1295 No DAC is a modified 29-residue GHRH (1-29) sequence; Tesamorelin is the full 44-residue GHRH (1-44) sequence with an N-terminal trans-3-hexenoyl group.' },
  { slug: 'mots-c-vs-ss-31', a: 'mots-c', b: 'ss-31',
    intro: 'MOTS-c and SS-31 are both studied in mitochondrial research but are structurally unrelated. MOTS-c is a 16-amino-acid sequence encoded in mitochondrial DNA; SS-31 is a synthetic four-residue compound containing D-arginine and 2′,6′-dimethyltyrosine.' },
  { slug: 'pt-141-vs-kisspeptin-10', a: 'pt-141', b: 'kisspeptin-10',
    intro: 'PT-141 and Kisspeptin-10 are both synthetic sequences derived from natural signaling molecules. PT-141 is a cyclic seven-amino-acid analog of alpha-melanocyte-stimulating hormone; Kisspeptin-10 is the linear C-terminal ten-amino-acid fragment of kisspeptin.' },
];

const holds = specificationReviews as Record<string, string>;
const published = (slug: string) => publication.productSlugs.includes(slug) && !holds[slug];
export const compoundAt = (slug: string) => compounds.find(c => c.slug === slug);
export const comparisonAt = (slug: string) => comparisons.find(c => c.slug === slug);
// A compound page is public while at least one of its products is published.
export const publishedCompound = (c?: Compound) => Boolean(c && c.products.some(published));
export const publishedComparison = (c?: Comparison) => Boolean(c && publishedCompound(compoundAt(c.a)) && publishedCompound(compoundAt(c.b)));
export const compoundForProduct = (productSlug: string) => compounds.find(c => c.products.includes(productSlug));
export const pubchemUrl = (c: Compound) => 'https://pubchem.ncbi.nlm.nih.gov/compound/' + c.cid;
export const comparisonsFor = (slug: string) => comparisons.filter(c => (c.a === slug || c.b === slug) && publishedComparison(c));

// Title fits the 70-character result line with the 33-character brand suffix.
export function compoundTitle(c: Compound) {
  const long = `${c.name} Molecular Weight and CAS`;
  return long.length <= 37 ? long : `${c.name} Formula, MW and CAS`;
}
export const compoundDescription = (c: Compound) =>
  `${c.name} reference data: CAS ${c.cas}, formula ${c.formula}, molecular weight ${c.weight} g/mol${c.residues ? `, ${c.residues}-residue sequence` : ''}, plus Biomod lab reports by lot.`.slice(0, 160);
export function comparisonTitle(x: Comparison) {
  const pair = `${compoundAt(x.a)!.name} vs ${compoundAt(x.b)!.name}`;
  return (pair + ' Compared').length <= 37 ? pair + ' Compared' : pair;
}
export const comparisonDescription = (x: Comparison) => {
  const a = compoundAt(x.a)!, b = compoundAt(x.b)!;
  return `${a.name} vs ${b.name}: sequence, molecular formula, molecular weight and CAS side by side, with Biomod lab reports for each. Research use only.`.slice(0, 160);
};

// Visible questions on each compound page; the FAQPage markup reads the same list.
export function compoundQuestions(c: Compound, productNames: string[]) {
  return [
    { question: `What is the molecular weight of ${c.name}?`, answer: `PubChem lists the molecular weight of ${c.name} (CID ${c.cid}) as ${c.weight} g/mol, for the formula ${c.formula}.` },
    { question: `What is the CAS number for ${c.name}?`, answer: `The CAS registry number for ${c.name} is ${c.cas}.` },
    ...(c.sequence ? [{ question: `What is the ${c.name} sequence?`, answer: `${c.name} is ${c.sequence}${c.residues ? `, ${c.residues} residues` : ''}.` }] : []),
    ...(c.aliases.length ? [{ question: `What other names is ${c.name} listed under?`, answer: `${c.name} is also listed as ${c.aliases.join(', ')}.` }] : []),
    { question: `Which Biomod products contain ${c.name}?`, answer: `${productNames.join(', ')}. Each product page lists the lot printed on its label and links the laboratory report for that lot when one is published.` },
  ];
}
