import source from './catalog-facts-v2.json';
import vialBranding from './vial-branding-v37.json';
import competitive from './competitive-pricing-v3.json';
import retail from './retail-pricing-v4.json';
export type Product = {
    id: number;
    name: string;
    identity: string;
    casNumber: string;
    slug: string;
    categories: {
        name: string;
        slug: string;
    }[];
    price: number;
    regularPrice: number;
    sale?: { enabled: boolean; percentOff: number; starts: string; ends: string } | null;
    activeSale?: { percentOff: number; ends: string; basePrice: number; basePackPrices?: Record<string, number | null> };
    packPrices?: Record<string, number | null>;
    currency: string;
    inStock: boolean;
    purchasable: boolean;
    sku: string;
    description: string;
    shortDescription: string;
    image: {
        filename: string;
        alt: string;
        width: number;
        height: number;
    };
    sizes: string[];
    sourceIssues: unknown[];
    stockQuantity?: number | null;
    maxQuantity?: number;
    presaleId?: string | null;
};
export const products: Product[] = (source as Product[]).map(p => ({ ...p, categories: p.categories.map(c => c.slug === 'research-peptides' ? { slug: 'research-compounds', name: 'Research Compounds' } : c), ...(competitive as Record<string, Pick<Product, 'price' | 'packPrices'>>)[p.slug], ...(retail as Record<string, Pick<Product, 'price' | 'packPrices'>>)[p.slug], shortDescription: p.description, description: p.description.replaceAll('—', '-') })).sort((a, b) => a.name.localeCompare(b.name));
export const categories = [{ slug: 'research-compounds', name: 'Research Compounds' }, { slug: 'softgels', name: 'Softgels' }, { slug: 'spray-products', name: 'Spray Products' }, { slug: 'aminos-liquids', name: 'Aminos & Liquids' }];
export const money = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
export const size = (p: Product) => p.sizes[0] || '';
export const mass = (p: Product) => { if (p.categories[0]?.slug !== 'research-compounds')
    return null; const m = size(p).match(/^(\d+(?:\.\d+)?)\s*mg\b/i); return m ? Number(m[1]) : null; };
export const imagePath = (p: Product) => '/products/' + ((vialBranding as Record<string,string>)[p.image.filename] || p.image.filename);
export const cas = (p: Product) => p.casNumber || '';
export const compound = (p: Product) => p.identity || p.name;
export const productFormat = (p: Product) => p.categories.some(c => c.slug === 'softgels') ? 'Softgels' : p.categories.some(c => c.slug === 'spray-products') ? 'Spray' : p.categories.some(c => c.slug === 'research-compounds') ? 'Vial' : 'Research supply';
export const productSummary = (p: Product) => p.description;
export const specificationNote = (p: Product) => p.slug === 'softgel-lumen-ghk-cu-ahk-cu-astaxanthin-vitamin-e' ? 'Astaxanthin quantities differ between the source specifications. Confirm the current formulation with Biomod before ordering.' : p.slug === 'noctis-blend-spray' ? 'Source documents list both 110 mg and 111 mg per bottle. Confirm the current bottle specification with Biomod.' : p.slug === 'zenith-semax-selank-spray' ? 'The full specification lists 100 mg per bottle; an older product summary lists 20 mg. Confirm the current label before ordering.' : '';
