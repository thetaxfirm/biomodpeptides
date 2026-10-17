import type { Metadata } from 'next';
import { runtime } from './runtime';
import { canonicalPath, mayIndex, pageInfo, productAt, seoConfig, privatePath, type SEOConfig } from './seo-policy';
import { imagePath } from './catalog';
import { schemaAvailability } from './availability';
import { publicCatalog } from './public-catalog';
import { merchantPolicies } from './merchant-policies';
import { certificateProperties } from './certificate-schema';
import { productQuestions } from './product-questions';
import { researchFaqSchemaItems } from './research-faq';
import { pressReleaseAt } from './press-releases';
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
  const follow = config.enabled && !privatePath(path);
  const canonical = config.origin + canonicalPath(path);
  const title = path === '/' ? info.title : info.title + ' | Biomod Research Supply Company';
  const p = productAt(path);
  // Public editorial/store pages use the current brand mark. Product previews keep
  // their own catalog images; private, held and preview routes get no new artwork.
  const shareImage = !p && index ? { url: config.origin + '/brand/logo-navy-tm-v36.png',
    width: 1320, height: 381, type: 'image/png', alt: 'Biomod Research Supply Company logo' } : null;
  return {
    title: { absolute: title }, description: info.description,
    alternates: { canonical },
    robots: { index, follow, googleBot: { index, follow, 'max-image-preview': index ? 'large' : 'none' } },
    openGraph: { type: 'website', locale: 'en_US', siteName: 'Biomod Research Supply Company', title, description: info.description, url: canonical,
      ...(p ? { images: [{ url: config.origin + imagePath(p), alt: p.image.alt || p.name }] } : shareImage ? { images: [shareImage] } : {}) },
    twitter: { card: 'summary', title, description: info.description,
      ...(shareImage ? { images: [{ url: shareImage.url, alt: shareImage.alt }] } : {}) },
  };
}
const faqPage = (url: string, items: { question: string; answer: string }[]) => ({ '@type': 'FAQPage', '@id': url + '#faq', url,
  mainEntity: items.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) });
export async function routeStructuredData(path: string, config: SEOConfig = currentSEO()) {
  const clean = canonicalPath(path), info = pageInfo(path), p = productAt(path);
  if (!mayIndex(path, new URLSearchParams(), config)) return null;
  // Stable policies are defined on their own pages and repeated on eligible
  // products, so every Offer reference also resolves within its document.
  const policies = p || clean === '/shipping-policy' || clean === '/returns-refunds' ? await merchantPolicies(config.origin) : null;
  const organization = { '@type': 'Organization', '@id': config.origin + '/#organization', name: 'Biomod Research Supply Company', alternateName: ['TryBiomod', 'BIOMOD'], description: 'Biomod Research Supply Company supplies lyophilized compound vials for laboratory research through TryBiomod.com. Not for human or animal use.', url: config.origin, logo: config.origin + '/brand/logo-navy-tm-v36.png', email: 'contact@trybiomod.com',
    ...(policies ? { hasMerchantReturnPolicy: policies.hasMerchantReturnPolicy } : {}),
    ...(policies?.hasShippingService ? { hasShippingService: policies.hasShippingService } : {}),
  };
  const graph: Record<string, unknown>[] = [organization,
    { '@type': 'WebSite', '@id': config.origin + '/#website', url: config.origin, name: 'Biomod Research Supply Company', alternateName: ['TryBiomod', 'BIOMOD'], publisher: { '@id': organization['@id'] } },
    { '@type': 'WebPage', '@id': config.origin + clean + '#page', url: config.origin + clean, name: info.title, description: info.description, isPartOf: { '@id': config.origin + '/#website' } },
  ];
  if (p) graph.push({ '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Shop', item: config.origin + '/shop' },
    { '@type': 'ListItem', position: 2, name: p.name, item: config.origin + clean },
  ] });
  if (p) {
    const snapshot = await publicCatalog();
    const live = snapshot.products.find(item => item.id === p.id);
    graph.push({ '@type': 'Product', '@id': config.origin + clean + '#product',
      name: info.name || info.title, description: info.description, url: config.origin + clean,
      image: config.origin + imagePath(p), ...(p.sku?.trim() ? { sku: p.sku.trim() } : {}),
      brand: { '@type': 'Brand', name: 'BIOMOD' }, category: p.categories[0]?.name,
      additionalProperty: [{ '@type': 'PropertyValue', name: 'Compound', value: p.identity },
        { '@type': 'PropertyValue', name: 'Container contents', value: p.sizes[0] },
        ...(p.casNumber ? [{ '@type': 'PropertyValue', name: 'CAS', value: p.casNumber }] : []),
        ...(snapshot.verified && live ? certificateProperties(p.id, live) : [])],
      ...(snapshot.verified && live && live.price > 0 ? { offers: { '@type': 'Offer', url: config.origin + clean,
        priceCurrency: 'USD', price: (live.price / 100).toFixed(2),
        ...(live.activeSale && !live.activePreorder && Number.isFinite(Date.parse(live.activeSale.ends)) ? { priceValidUntil: new Date(live.activeSale.ends).toISOString().slice(0, 10) } : {}),
        availability: schemaAvailability(live),
        seller: { '@id': organization['@id'] },
        ...(policies ? { hasMerchantReturnPolicy: { '@id': policies.hasMerchantReturnPolicy['@id'] } } : {}),
        ...(policies?.hasShippingService ? { shippingDetails: { '@type': 'OfferShippingDetails', hasShippingService: { '@id': policies.hasShippingService['@id'] } } } : {}),
      } } : {}) });
    // Mirrors the visible Product questions, using the live product so lot status matches.
    graph.push(faqPage(config.origin + clean, productQuestions(live ? { ...p, ...live } : p).map(item => ({ question: item.question, answer: item.answer.join(' ') }))));
  }
  const release = pressReleaseAt(clean);
  if (release) graph.push({ '@type': 'NewsArticle', '@id': config.origin + clean + '#article', mainEntityOfPage: { '@id': config.origin + clean + '#page' },
    headline: release.headline, description: release.summary, datePublished: release.date, dateModified: release.date,
    image: config.origin + '/brand/logo-navy-tm-v36.png', author: { '@id': organization['@id'] }, publisher: { '@id': organization['@id'] },
    articleBody: release.body.join(' ') });
  // Question markup mirrors the visible /faq answers exactly.
  if (clean === '/faq') graph.push(faqPage(config.origin + clean, researchFaqSchemaItems().map(item => ({ question: item.question, answer: item.answer }))));
  return { '@context': 'https://schema.org', '@graph': graph };
}
// Escape characters that could end a script tag or break inline JSON. Written without unicode escape sequences on purpose.
const BACKSLASH = String.fromCharCode(92), LINE_SEP = String.fromCharCode(0x2028), PARA_SEP = String.fromCharCode(0x2029);
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, BACKSLASH + 'u003c').replaceAll(LINE_SEP, BACKSLASH + 'u2028').replaceAll(PARA_SEP, BACKSLASH + 'u2029');
