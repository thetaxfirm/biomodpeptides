import source from './catalog-source-v1.json';
export type Product = {
    id: number;
    name: string;
    slug: string;
    categories: {
        name: string;
        slug: string;
    }[];
    price: number;
    regularPrice: number;
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
export const products: Product[] = (source as Product[]).map(p => ({ ...p, shortDescription: p.description, description: p.description.replaceAll('—', '-') })).sort((a, b) => a.name.localeCompare(b.name));
export const categories = [{ slug: 'research-peptides', name: 'Research Peptides' }, { slug: 'softgels', name: 'Softgels' }, { slug: 'spray-products', name: 'Spray Products' }, { slug: 'aminos-liquids', name: 'Aminos & Liquids' }];
export const money = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
export const size = (p: Product) => p.sizes[0] || '';
export const mass = (p: Product) => { if (p.categories[0]?.slug !== 'research-peptides')
    return null; const m = size(p).match(/^(\d+(?:\.\d+)?)\s*mg\b/i); return m ? Number(m[1]) : null; };
export const imagePath = (p: Product) => '/products/' + p.image.filename;
export const cas = (p: Product) => p.description.match(/CAS:\s*([\d\s/\-]+)[.]/)?.[1]?.trim() || '';
