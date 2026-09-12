import type { Metadata } from 'next';
import { runtime } from './runtime';
import { canonicalPath, mayIndex, pageInfo, productAt, seoConfig, type SEOConfig } from './seo-policy';
import { imagePath } from './catalog';
import { headers } from 'next/headers';

export const currentSEO = () => seoConfig(runtime());
export function seoForOrigin(origin: string) {
  const config = currentSEO();
  return config.enabled && origin !== config.publicOrigin ? { ...config, enabled: false, origin: seoConfig().origin } : config;
}
export async function requestSEO() {
  const config = currentSEO();
  const host = (await headers()).get('host');
  if (config.enabled && host !== new URL(config.publicOrigin).host) return { ...config, enabled: false, origin: seoConfig().origin };
  return config;
}
export function routeMetadata(path: string, query: URLSearchParams = new URLSearchParams(), config: SEOConfig = currentSEO()): Metadata {
  const info = pageInfo(path);
  const index = mayIndex(path, query, config);
  const canonical = config.origin + canonicalPath(path);
  const title = path === '/' ? info.title : info.title + ' | BIOMOD Peptides';
  const p = productAt(path);
  return {
    title: { absolute: title }, description: info.description,
    alternates: { canonical },
    robots: { index, follow: index, googleBot: { index, follow: index, 'max-image-preview': index ? 'large' : 'none' } },
    openGraph: { type: 'website', locale: 'en_US', siteName: 'BIOMOD Peptides', title, description: info.description, url: canonical,
      ...(p ? { images: [{ url: config.origin + imagePath(p), alt: p.image.alt || p.name }] } : {}) },
    twitter: { card: 'summary', title, description: info.description },
  };
}
export function routeStructuredData(path: string, config: SEOConfig = currentSEO()) {
  const clean = canonicalPath(path), info = pageInfo(path), p = productAt(path);
  if (!mayIndex(path, new URLSearchParams(), config)) return null;
  const organization = { '@type': 'Organization', '@id': config.origin + '/#organization', name: 'BIOMOD Peptides', url: config.origin, logo: config.origin + '/brand/logo-v1.svg', email: 'contact@biomodpeptides.com' };
  const graph: Record<string, unknown>[] = [organization,
    { '@type': 'WebSite', '@id': config.origin + '/#website', url: config.origin, name: 'BIOMOD Peptides', publisher: { '@id': organization['@id'] } },
    { '@type': 'WebPage', '@id': config.origin + clean + '#page', url: config.origin + clean, name: info.title, description: info.description, isPartOf: { '@id': config.origin + '/#website' } },
  ];
  if (p) graph.push({ '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Shop', item: config.origin + '/shop' },
    { '@type': 'ListItem', position: 2, name: p.name, item: config.origin + clean },
  ] });
  return { '@context': 'https://schema.org', '@graph': graph };
}
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
