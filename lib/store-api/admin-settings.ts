import { settingsSnapshot, saveSettingsSnapshot, SettingsConflict } from '@/lib/settings-version';
import { saveCoaConfig } from '@/lib/coa-outbox';
import { z } from 'zod';
import { config } from '@/lib/commerce';
import { database } from '@/lib/runtime';
import type { AdminPostContext } from '@/lib/store-api/context';
import { j } from '@/lib/store-api/shared';

export async function adminSettings(context: AdminPostContext) {
    const { action, b, auditActor, auditEnv } = context;
    if (action === 'admin-coa-config') {
        const settings = z.object({ enabled: z.boolean(), replyTo: z.string().email(), notifyTo: z.string().email().nullable().optional() }).parse(b);
        await saveCoaConfig(auditEnv(), settings);
        return j({ message: 'COA email settings saved.' });
    }
    if (action === 'admin-config') {
        if (typeof b.expectedVersion !== 'string') throw new SettingsConflict();
        const before = await settingsSnapshot(database(), 'store', b.expectedVersion);
        const cfg = z.object({ packDiscounts: z.record(z.number().min(0).max(100).nullable()), shippingCents: z.number().int().min(0).max(100000).nullable().optional(), freeShippingAt: z.number().int().min(0).max(1000000).optional(), presalesEnabled: z.boolean(), rewardsEnabled: z.boolean(), affiliateEnabled: z.boolean(),
            shippingOptions: z.object({ standardEnabled: z.boolean(), expeditedEnabled: z.boolean(), overnightEnabled: z.boolean(), freeStandardEnabled: z.boolean(), standardHandlingCents: z.number().int().min(0).max(100000), expeditedHandlingCents: z.number().int().min(0).max(100000), overnightHandlingCents: z.number().int().min(0).max(100000), carriers: z.array(z.enum(['USPS', 'UPS', 'FedEx'])).min(1).transform(values => [...new Set(values)]) }).strict().optional(),
        }).parse(b);
        if (Object.keys(cfg.packDiscounts).some(k => !['1', '3', '5', '10'].includes(k)))
            throw new Error('Unknown pack size.');
        // Older admin pages do not know about delivery options or newer settings.
        // Preserve the current merged runtime values unless explicitly submitted.
        const currentConfig = await config();
        const nextConfig = { ...currentConfig, ...cfg, shippingCents: cfg.shippingCents === undefined ? currentConfig.shippingCents : cfg.shippingCents, freeShippingAt: cfg.freeShippingAt ?? currentConfig.freeShippingAt, packDiscounts: { ...currentConfig.packDiscounts, ...cfg.packDiscounts, '1': 0 }, shippingOptions: cfg.shippingOptions ? { ...cfg.shippingOptions, ...(currentConfig.shippingOptions.services ? { services: currentConfig.shippingOptions.services } : {}) } : currentConfig.shippingOptions };
        await saveSettingsSnapshot(database(), before, nextConfig, auditActor);
        return j({ message: 'Store settings saved.' });
    }
}

