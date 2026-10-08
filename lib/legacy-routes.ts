// Exact old URLs observed in the original storefront or indexed search results.
// Keep redirects relevant; unknown content still returns a genuine 404.
export const legacyRoutes: Record<string, string> = {
  // Former Spanish pages verified in public search on 2026-10-08.
  // The current equivalents are English; unknown /es paths remain 404.
  'es': '/',
  'es/product/mots-c-10mg': '/product/mots-c-10mg',
  'es/product/mots-c-40mg': '/product/mots-c-40mg',
  'es/coa': '/testing',
  'product-category/research-peptides': '/shop',
  'product-category/softgels': '/softgels',
  'product-category/spray-products': '/shop?category=spray-products',
  'product-category/aminos-liquids': '/shop?category=aminos-liquids',
  'my-account': '/account',
  'peptide-store-las-vegas-near-me-biomod': '/locations',
  'las-vegas-medical-district-lab-supply-sourcing-high-purity-research-peptides': '/quality-standard',
  'research-peptide-supplier-las-vegas-evaluating-analytical-grade-standards': '/quality-standard',
  'las-vegas-research-peptide-warehouse-local-supply-and-analytical-standards': '/quality-standard',
  'peptide-softgels-in-las-vegas-a-laboratory-procurement-guide-2026': '/softgels',
};
