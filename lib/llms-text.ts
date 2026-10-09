import { pageInfo, productAt } from './seo-policy';
import { certificateProperties } from './certificate-schema';
// Plain-text index for AI assistants (llmstxt.org). Built only from sitemap-eligible pages and their reviewed metadata.
export function llmsText(origin: string, paths: string[]) {
  const coa = (path: string) => {
    const p = productAt(path), props = p ? certificateProperties(p.id) : [], get = (name: string) => props.find(x => x.name === name)?.value;
    return props.length ? ` Matching-lot COA: lot ${get('Certificate lot')}, reported purity ${get('Purity (reported)')}, measured content ${get('Measured content (reported)')}.` : '';
  };
  const line = (path: string) => { const info = pageInfo(path); return `- [${info.title}](${origin}${path}): ${info.description}${coa(path)}`; };
  const products = paths.filter(p => p.startsWith('/product/'));
  return ['# Biomod Peptides (TryBiomod)', '',
    '> TryBiomod.com is the online storefront for Biomod Peptides, a U.S. supplier of lyophilized research peptide vials with batch documents. Each product lists its compound, container contents, 1/3/5/10 pack prices and the original certificate for the supplied lot where available. For laboratory research only; not for human or animal use.', '',
    '## Guides and policies', ...paths.filter(p => !p.startsWith('/product/')).map(line), '',
    '## Research products', ...products.map(line), ''].join('\n');
}
