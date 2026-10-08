import { cache } from 'react';
import { catalog } from './commerce';
import { products } from './catalog';
export const publicCatalog = cache(async () => {
  try { return { products: await catalog(), verified: true }; }
  catch { return { products, verified: false }; }
});
