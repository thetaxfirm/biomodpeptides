// Exact old URLs observed in the original storefront or indexed search results.
// Keep redirects relevant; unknown content still returns a genuine 404.
export const legacyRoutes: Record<string, string> = {
  // Former Spanish pages verified in public source pages and search records.
  // The current equivalents are English; unknown /es paths remain 404.
  'es': '/',
  'es/product/mots-c-10mg': '/product/mots-c-10mg',
  'es/product/mots-c-40mg': '/product/mots-c-40mg',
  'es/product/ss-31-10mg': '/product/ss-31-10mg',
  'es/coa': '/testing',
  'product-category/research-peptides': '/shop',
  'product-category/softgels': '/softgels',
  'product-category/spray-products': '/shop?category=spray-products',
  'product-category/aminos-liquids': '/shop?category=aminos-liquids',
  'my-account': '/account',
  // Press releases renamed without the word peptide (owner, October 17, 2026).
  'news/biomod-peptides-online-store-trybiomod': '/news/biomod-online-store-trybiomod',
  'news/guide-to-reading-peptide-coa': '/news/guide-to-reading-coa',
  'peptide-store-las-vegas-near-me-biomod': '/locations',
  'las-vegas-medical-district-lab-supply-sourcing-high-purity-research-peptides': '/quality-standard',
  'research-peptide-supplier-las-vegas-evaluating-analytical-grade-standards': '/quality-standard',
  'las-vegas-research-peptide-warehouse-local-supply-and-analytical-standards': '/quality-standard',
  'peptide-softgels-in-las-vegas-a-laboratory-procurement-guide-2026': '/softgels',
  // Old-domain URLs still listed by Bing (site:biomodpeptides.com, October 14, 2026)
  // that previously ended in a 404 after the domain move.
  'biomod-peptide-quality-standards': '/quality-standard',
  'henderson-lab-supplies-sourcing-high-purity-research-peptides-in-nevada': '/quality-standard',
  'peptide-supplier-with-third-party-testing-2026-analytical-standards': '/testing',
  'alternative-to-gray-market-research-chemicals-verified-standards-for-analytical-labs': '/choosing-a-research-supplier',
  'reliable-peptide-source-in-las-vegas-a-researchers-buying-guide-2026': '/choosing-a-research-supplier',
  'product-tag/blends': '/shop',
  // More old-domain URLs listed by Bing on October 18, 2026 that still ended in a 404.
  // Tag archives point to the live page covering the same topic.
  'tag/scientific-reproducibility': '/quality-standard',
  'tag/reproducibility': '/quality-standard',
  'tag/research-reproducibility': '/quality-standard',
  'tag/spray-formulation': '/shop',
  'tag/longevity-supplement-peptides': '/',
  'longevity-peptide-stack': '/shop',
  // Old-domain URLs listed by Bing on October 23, 2026 that still ended in a 404.
  'research-peptide-storage-and-inventory-management-2026-laboratory-protocol-guide': '/quality-standard',
  'research-peptide-sourcing-for-startups-in-las-vegas-a-2026-procurement-guide': '/choosing-a-research-supplier',
  'comprehensive-checklist-for-vetting-new-lab-peptide-suppliers-in-2026': '/choosing-a-research-supplier',
  'nevada-research-peptides-a-selection-guide': '/choosing-a-research-supplier',
  'research-peptides/blends': '/shop',
  'tag/nevada-research-supply': '/about',
  // Old-domain URLs listed by Bing on October 28, 2026 that still ended in a 404.
  // The first two rank for brand searches ("biomod peptides", "biomod softgels").
  'tag/peptides': '/shop',
  'peptide-softgel-starter-kit-beginners': '/softgels',
  'peptide-softgels-inflammation-joint-pain-research': '/softgels',
  'laboratory-research-supplies-in-north-las-vegas-a-peptide-procurement-guide-2026': '/choosing-a-research-supplier',
};
