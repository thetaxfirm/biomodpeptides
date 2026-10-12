import type { Product } from '@/lib/catalog';
import { productAvailability, productAvailabilityLabel } from '@/lib/availability';
import styles from './product-status.module.css';

export function ProductStatus({ product, includeAvailable = false }: { product: Product; includeAvailable?: boolean }) {
    const status = productAvailability(product);
    if (status === 'available' && !includeAvailable) return null;
    return <p className={styles.status} data-status={status}>{status === 'available' && product.activePreorder ? 'Available for preorder' : productAvailabilityLabel(product)}</p>;
}
