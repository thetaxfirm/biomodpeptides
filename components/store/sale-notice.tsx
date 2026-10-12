'use client';
import { useEffect, useState } from 'react';
import type { Product } from '@/lib/catalog';
import { saleRemaining } from '@/lib/sale-display';
import styles from './sale-notice.module.css';

export function SaleNotice({ product, compact = false }: { product: Product; compact?: boolean }) {
    const [now, setNow] = useState<number | null>(null);
    const sale = product.activeSale;
    useEffect(() => {
        if (!sale) return;
        const tick = () => setNow(Date.now());
        tick();
        const timer = setInterval(tick, 1000);
        document.addEventListener('visibilitychange', tick);
        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
    }, [sale?.ends]);
    if (product.activePreorder || !sale || !product.inStock || !product.purchasable) return null;
    const remaining = now === null ? null : saleRemaining(sale.ends, now);
    const date = new Date(sale.ends);
    if (!Number.isFinite(date.getTime()) || remaining?.expired) return null;
    const deadline = date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    return <div className={styles.offer} data-compact={compact || undefined}>
        <div className={styles.heading}><strong>Sale · {sale.percentOff}% off</strong><span>Ends {deadline}</span></div>
        <div className={styles.clock} role="timer" aria-label={'Sale ends ' + deadline} aria-live="off">
            <span className={styles.caption}>Time remaining</span>
            {remaining ? <span className={styles.digits}>{remaining.days > 0 && <><b>{remaining.days}</b>d </>}<b>{String(remaining.hours).padStart(2, '0')}</b>h <b>{String(remaining.minutes).padStart(2, '0')}</b>m <b>{String(remaining.seconds).padStart(2, '0')}</b>s</span> : <time dateTime={sale.ends}>{deadline}</time>}
        </div>
    </div>;
}
