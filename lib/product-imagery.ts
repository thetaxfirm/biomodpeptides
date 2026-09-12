import { type Product, imagePath } from './catalog';

export const hasBottleImage = (product: Product) => product.categories.some(category => category.slug === 'softgels');
export const listingImage = (product: Product) => hasBottleImage(product) ? `/products/${product.slug}-bottle-v9.png` : imagePath(product);
export const packagingImage = (product: Product) => hasBottleImage(product) ? `/products/${product.slug}-packaging-v9.jpg` : imagePath(product);

export const productImagery: Record<string, { src: string; alt: string; width: number; height: number }> = {
  'bpc-157-10mg': { src: '/brand/biomod-bpc-157-still-life-v1.png', alt: 'AI studio illustration of the BIOMOD BPC-157 10 mg vial on a dark stone surface', width: 1448, height: 1086 },
  'softgel-methylene-blue-usp': { src: '/brand/biomod-azure-still-life-v1.png', alt: 'AI studio illustration of the blue BIOMOD AZURE softgel bottle on a bronze surface', width: 1448, height: 1086 },
  'forge-bpc-157-spray': { src: '/brand/biomod-forge-still-life-v1.png', alt: 'AI studio illustration of the BIOMOD FORGE spray bottle on dark glass', width: 1448, height: 1086 },
};
