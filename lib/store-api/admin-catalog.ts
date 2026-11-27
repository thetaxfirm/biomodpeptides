import { savePresaleCampaign } from '@/lib/presale-campaigns';
import { adminBatchRecords, validateBatchEdit } from '@/lib/product-batch';
import { coaHash } from '@/lib/coa-delivery';
import { withAuditDb } from '@/lib/change-history';
import inventorySql from '@/lib/inventory-statements.json';
import { z } from 'zod';
import { catalog } from '@/lib/commerce';
import { availabilityOptions, hasPublicationHold, sourcePublicationHold, blockedReleaseLot } from '@/lib/availability';
import { one, uid, database } from '@/lib/runtime';
import { supportsPacks, standardPackPrices } from '@/lib/packs';
import type { AdminPostContext } from '@/lib/store-api/context';
import { j } from '@/lib/store-api/shared';

export async function adminCatalog(context: AdminPostContext) {
    const { action, b, actor, auditActor } = context;
    if (action === 'admin-product') {
        const packPricingMode = z.enum(['automatic', 'custom']).optional().parse(b.packPricingMode);
        const data = z.object({ batch: z.object({ lot: z.string().trim().max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/).nullable(), reportRef: z.string().max(200).regex(/^(?:public:[A-Za-z0-9._-]+|private:[a-f0-9]{64})$/).nullable(), coaAvailable: z.boolean() }).optional(), publicationRelease: z.object({lot:z.string(),reason:z.string().optional()}).nullable().optional(), availability: z.enum(availabilityOptions).optional(), preorder: z.object({ enabled: z.boolean(), percentOff: z.number().min(0.01).max(99), ships: z.string().trim().min(1).max(120) }).nullable().optional(), sale: z.object({ enabled: z.boolean(), percentOff: z.number().min(0.01).max(99), starts: z.string().datetime(), ends: z.string().datetime() }).nullable().optional(), price: z.number().int().min(1).max(9999999), packPrices: z.record(z.number().int().min(1).max(99999999).nullable()).optional(), inStock: z.boolean(), purchasable: z.boolean(), stockQuantity: z.number().int().min(0).max(100000).nullable(), maxQuantity: z.number().int().min(1).max(100000) }).parse(b);
        if (data.sale && Date.parse(data.sale.ends) <= Date.parse(data.sale.starts)) throw new Error('Sale end must follow its start.');
        if (Object.keys(data.packPrices || {}).some(n => !['3','5','10'].includes(n))) throw new Error('Unknown pack size.');
        const currentProduct = (await catalog(false, true)).find(p => p.id === b.id);
        if (!currentProduct) throw new Error('Product not found.');
        if (actor.role === 'catalog') {
            // Catalog staff change prices, sales and lot/COA links only (catalogEditableFields).
            // Stock, availability, preorders and limits keep their current values whatever the request says.
            if (b.releaseReviewed === true) throw new Error('Only an owner can release a product review hold.');
            if (currentProduct.availability !== undefined) data.availability = currentProduct.availability; else delete data.availability;
            if (currentProduct.preorder !== undefined) data.preorder = currentProduct.preorder; else delete data.preorder;
            data.inStock = currentProduct.inStock;
            data.purchasable = currentProduct.purchasable;
            data.stockQuantity = currentProduct.stockQuantity ?? null;
            data.maxQuantity = currentProduct.maxQuantity ?? data.maxQuantity;
        }
        const savedRow = await one<{data:string}>('SELECT data FROM product_overrides WHERE id=?', b.id);
        if (typeof b.expectedVersion !== 'string' || b.expectedVersion !== currentProduct.editVersion || b.expectedVersion !== await coaHash(savedRow?.data || '')) throw new Error('This product changed or the editor is outdated. Refresh administration and review the latest values before saving.');
        const previousBatch = (await adminBatchRecords(database(), [currentProduct]))[0];
        if (data.batch) {
            if (!b.expectedBatch || b.expectedBatch.lot !== previousBatch?.lot || b.expectedBatch.reportRef !== previousBatch?.reportRef || b.expectedBatch.coaAvailable !== previousBatch?.coaAvailable) throw new Error('The current lot or original report changed. Refresh administration before saving.');
            const unchanged = previousBatch && data.batch.lot === previousBatch.lot && data.batch.reportRef === previousBatch.reportRef && data.batch.coaAvailable === previousBatch.coaAvailable;
            if (!unchanged) data.batch = await validateBatchEdit(database(), currentProduct, data.batch);
            // A price-only save must not convert a legacy mismatched report into a new association.
            if (unchanged && currentProduct.batch === undefined) delete data.batch;
        } else if (currentProduct.batch !== undefined) data.batch = currentProduct.batch;
        const lotChanged = data.batch !== undefined && data.batch.lot !== (previousBatch?.lot || null);
        // Release attestations are accepted only through this owner-only path, never from a raw client object.
        data.publicationRelease = lotChanged ? null : currentProduct.publicationRelease;
        if (b.releaseReviewed === true) {
            if (actor.role !== 'owner') throw new Error('Only an owner can release a product review hold.');
            const lot = data.batch?.lot || previousBatch?.lot || null;
            if (!sourcePublicationHold(currentProduct) || !lot || blockedReleaseLot(currentProduct, lot)) throw new Error('Identify the verified current selling lot. The older flagged Wolverine lot cannot be released here.');
            if (!data.stockQuantity || data.stockQuantity <= 0) throw new Error('Enter the verified stock quantity before releasing this lot.');
            data.publicationRelease = { lot, reason: z.string().trim().min(10).max(500).parse(b.releaseReason) };
        }
        const nextProduct = { ...currentProduct, ...data };
        if (data.availability !== undefined) {
            if (data.availability === 'available' && hasPublicationHold(nextProduct)) throw new Error('Review the current lot and complete the owner release confirmation before making this product available.');
            data.inStock = data.availability === 'available';
            data.purchasable = data.availability === 'available';
        } else if (currentProduct.availability !== undefined) data.availability = currentProduct.availability;
        if (hasPublicationHold(nextProduct)) { data.inStock = false; data.purchasable = false; }
        // Optional fields omitted by an older editor retain their current source.
        if (!Object.hasOwn(b, 'sale') && currentProduct.sale !== undefined) data.sale = currentProduct.sale;
        // Reprice on the server as well: an older editor must not save old pack totals with a new base price.
        const basePriceChanged = data.price !== currentProduct.price;
        if (supportsPacks(currentProduct) && (packPricingMode === 'automatic' || (basePriceChanged && packPricingMode !== 'custom'))) {
            data.packPrices = standardPackPrices(data.price);
        } else {
            if (supportsPacks(currentProduct) && basePriceChanged && packPricingMode === 'custom' && !Object.hasOwn(b, 'packPrices')) throw new Error('Enter the custom pack totals or use automatic pack pricing.');
            if (!Object.hasOwn(b, 'packPrices') && currentProduct.packPrices !== undefined) data.packPrices = currentProduct.packPrices;
        }
        if (currentProduct.preorder !== undefined && !Object.hasOwn(b, 'preorder')) throw new Error('Preorder settings require the current product editor. Refresh administration before editing this product.');
        const db = withAuditDb(database(), { ...auditActor, summary: `${currentProduct.name} product settings updated` });
        const guard = uid(), versionGuard = uid(), batchGuard = uid();
        try { await db.batch([
            db.prepare(inventorySql.checkProductVersion).bind(versionGuard, savedRow?.data ?? null, b.id),
            ...(lotChanged ? [db.prepare(inventorySql.checkBatchEdit).bind(batchGuard, b.id, b.id)] : []),
            db.prepare(inventorySql.checkInventoryEdit).bind(guard, data.stockQuantity, b.id, b.expectedStock ?? null, b.id),
            db.prepare(inventorySql.updateProduct).bind(b.id, JSON.stringify(data)),
            ...[guard,versionGuard,...(lotChanged?[batchGuard]:[])].map(id=>db.prepare(inventorySql.clearGuard).bind(id)),
        ]); } catch { throw new Error(lotChanged ? 'The lot cannot change while stock is reserved or paid orders await fulfillment. Complete those orders first, then refresh. No changes were saved.' : 'The product or reserved stock changed. Refresh administration and review the latest values. No changes were saved.'); }
        return j({ message: 'Product updated.' });
    }
    if (action === 'admin-campaign') return j(await savePresaleCampaign(withAuditDb(database(), auditActor), b, (await catalog(false)).map(p => p.id)));
}

