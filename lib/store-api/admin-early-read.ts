import { loadCoaReports, readCoaOriginal, verifiedCoaAttachment } from '@/lib/coa-delivery';
import { changeHistory } from '@/lib/change-history';
import { promoAnalytics } from '@/lib/promo-analytics';
import { storedPromotions } from '@/lib/promo-codes';
import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth';
import { all, database } from '@/lib/runtime';
import { salesDiagnostics } from '@/lib/sales-diagnostics';
import type { StoreGetContext } from '@/lib/store-api/context';
import { j } from '@/lib/store-api/shared';

export async function adminEarlyRead(context: StoreGetContext) {
    const { req, action } = context;
    if (action === 'admin-coa-original') {
        try { await requireStaff('catalog:write'); } catch { try { await requireStaff('requests:write'); } catch { return j({ error: 'Administrator product access required.' }, 403); } }
        const ref = req.nextUrl.searchParams.get('ref') || '';
        if (!/^private:[a-f0-9]{64}$/.test(ref)) return j({ error: 'Original report not found.' }, 404);
        const report = (await loadCoaReports(database())).find(r => 'private:' + r.sha256 === ref);
        const original = report ? await readCoaOriginal(database(), report) : null;
        if (!original) return j({ error: 'Original report unavailable.' }, 404);
        const attachment = await verifiedCoaAttachment(original);
        return new NextResponse(Uint8Array.from(atob(attachment.content), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(attachment.filename), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "frame-ancestors 'self'" } });
    }
    if (action === 'admin-changes') {
        try { await requireStaff('reports:read'); } catch { return j({ error: 'Administrator reporting access required.' }, 403); }
        return j(await changeHistory(database(), req.nextUrl.searchParams));
    }
    if (action === 'admin-diagnostics')
        return j(await salesDiagnostics({ requireAdmin: () => requireStaff('reports:read'), all }, req.nextUrl.searchParams.get('days'), Date.now(), req.nextUrl.searchParams));
    if (action === 'admin-promos')
        return j(await promoAnalytics({ requireAdmin: () => requireStaff('reports:read'), all, storedPromos: () => storedPromotions(database()) }, req.nextUrl.searchParams.get('days'), Date.now(), req.nextUrl.searchParams.get('complete') === 'true', req.nextUrl.searchParams));
}

