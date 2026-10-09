import { pageInfo } from './seo-policy';
// Plain-text index for AI assistants (llmstxt.org). Built only from sitemap-eligible pages and their reviewed metadata.
export function llmsText(origin: string, paths: string[]) {
  const line = (path: string) => { const info = pageInfo(path); return `- [${info.title}](${origin}${path}): ${info.description}`; };
  const products = paths.filter(p => p.startsWith('/product/'));
  return ['# BIOMOD (trybiomod.com)', '',
    '> U.S. supplier of lyophilized research peptide vials with batch documents. Each product lists its compound, container contents, 1/3/5/10 pack prices and the original certificate for the supplied lot where available. For laboratory research only; not for human or animal use.', '',
    '## Guides and policies', ...paths.filter(p => !p.startsWith('/product/')).map(line), '',
    '## Research products', ...products.map(line), ''].join('\n');
}
