import { type Product } from '@/lib/catalog';

/** Uses the merged catalog offer so every consumer shows the same timing and rate. */
export function PreorderNotice({ product, compact = false }: { product: Product; compact?: boolean }) {
    const preorder = product.activePreorder;
    if (!preorder) return null;
    return <div className={'preorder-notice' + (compact ? ' preorder-notice-compact' : '')}>
        <div className="preorder-notice-heading"><strong>{preorder.percentOff}% off</strong><span>Preorder</span></div>
        <p>Limited initial run. Estimated dispatch: <strong>{preorder.ships}</strong>. Timing may change.</p>
        {!compact && <p className="preorder-order-terms">Charged at checkout. Orders containing preorder items ship together when all items are ready.</p>}
    </div>;
}
