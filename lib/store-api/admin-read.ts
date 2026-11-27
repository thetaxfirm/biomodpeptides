import { listPresaleCampaigns } from '@/lib/presale-campaigns';
import { settingsSnapshot } from '@/lib/settings-version';
import { summarizeRequestReplies } from '@/lib/request-replies';
import { adminBatchRecords } from '@/lib/product-batch';
import { recoveryAdminStatus } from '@/lib/checkout-recovery';
import { coaAutomationStatus } from '@/lib/coa-outbox';
import { requireStaff, requireStaffAny } from '@/lib/auth';
import { presentationData } from '@/lib/private-presentation';
import { adminOrderView } from '@/lib/catalog-visibility';
import { catalog, config } from '@/lib/commerce';
import { all, parse, runtime, database } from '@/lib/runtime';
import { paymentEnvironment } from '@/lib/payments';
import { searchReport, seoConfig } from '@/lib/seo-policy';
import { can, permissionsFor, tabPermission, type StaffPermission } from '@/lib/staff';
import { staffDirectory } from '@/lib/staff-store';
import { hasSiteUpdateAccess, siteUpdateAccessList } from '@/lib/site-updates';
import { readAdminOverviewOrderSummary } from '@/lib/admin-overview-db';
import { adminOverview } from '@/lib/admin-overview';
import type { StoreGetContext } from '@/lib/store-api/context';
import { j } from '@/lib/store-api/shared';

export async function adminRead(context: StoreGetContext) {
    const { req, action } = context;
    if (action === 'admin-overview') {
        // "Today" home: work waiting now, sales and setup gaps. Each section is limited to what the role may see.
        const { role } = await requireStaff('orders:read');
        const allowed = (permission: StaffPermission) => can(role, permission);
        const now=Date.now(), products=await catalog(false,true), store=await config();
        const orderSummary=await readAdminOverviewOrderSummary(database(),products,now);
        return j(await adminOverview(runtime() as any, { orders: [], orderSummary, now, products, shipping: store.shippingOptions, environment: paymentEnvironment(runtime()),
            access: { orders: true, requests: allowed('requests:write'), reports: allowed('reports:read'), store: allowed('store:write') } }));
    }
    if (action === 'admin-orders') {
        // Moved to POST: the search term is a customer's email, phone or address, and a query string
        // is recorded by every proxy and log in front of this app. See the POST branch.
        return j({ error: 'Use POST for the order queue.' }, 405);
    }
    if (action === 'admin') {
        // Each section is sent only to roles that hold it. Catalog staff get products and lot reports, never orders.
        let access;try {access=await requireStaffAny(['orders:read', 'catalog:write']);}catch{return j({error:'Administrator access required.'},403);}
        const {role,email:actorEmail}=access;
        // Website updates is granted per person, not per role, so it is added to the role's list here.
        const siteRequests = await hasSiteUpdateAccess(database(), { email: actorEmail, role });
        const allowed = (permission: StaffPermission) => can(role, permission);
        const requestedSection = req.nextUrl.searchParams.get('section');
        if (requestedSection) {
            if (!Object.hasOwn(tabPermission, requestedSection)) return j({error:'Choose an administration section.'},400);
            // The initial Today link falls back to Products for a catalog-only colleague.
            const section = requestedSection === 'overview' && !allowed('orders:read') ? 'products' : requestedSection;
            if (!(section === 'updates' ? siteRequests : allowed(tabPermission[section])) || (section==='restaurants' && role!=='owner')) return j({error:'This section is not available to your role.'},403);
            const snapshot:Record<string,unknown> = {role,section,permissions:[...permissionsFor(role),...(siteRequests?['site:request']:[])]};
            if (['settings','products','presales'].includes(section)) {
                snapshot.settingsVersion=(await settingsSnapshot(database(),'store')).version;
                snapshot.config=await config();
            }
            if (['products','presales'].includes(section)) {
                const products=await catalog(false,allowed('catalog:write'));
                snapshot.products=products;
                if(section==='products') snapshot.batchRecords=await adminBatchRecords(database(),products);
            }
            if(section==='orders') snapshot.checkoutRecovery=await recoveryAdminStatus(runtime());
            if(section==='requests') {
                // The inbox owns its paged queue. Loading another section never reads messages.
                snapshot.requests=[];snapshot.requestReplies={};
                if(allowed('store:write')) {snapshot.coaAutomation=await coaAutomationStatus(runtime(),[]);snapshot.checkoutRecovery=await recoveryAdminStatus(runtime());}
            }
            if(section==='presales') snapshot.campaigns=(await listPresaleCampaigns(database())).map(c=>presentationData(c));
            if(section==='search') snapshot.searchPublishing=searchReport(seoConfig(runtime()));
            if(section==='team') snapshot.team={...await staffDirectory(runtime()),siteUpdateAccess:await siteUpdateAccessList(database())};
            return j(snapshot);
        }
        const requests = allowed('requests:write') ? await all<{ id: string; data: string }>("SELECT * FROM requests WHERE kind IN ('contact','stock','affiliate') ORDER BY created DESC LIMIT 200") : [];
        const settings = await settingsSnapshot(database(), 'store');
        const adminProducts = await catalog(false, allowed('catalog:write'));
        return j({ role, settingsVersion: settings.version, permissions: [...permissionsFor(role), ...(siteRequests ? ['site:request'] : [])], batchRecords: allowed('catalog:write') ? await adminBatchRecords(database(), adminProducts) : [], checkoutRecovery: allowed('orders:read') ? await recoveryAdminStatus(runtime()) : null, searchPublishing: allowed('reports:read') ? searchReport(seoConfig(runtime())) : null, config: await config(), products: adminProducts, orders: allowed('orders:read') ? (await all<{
                data: string;
            }>('SELECT id,owner,status,total,data,created FROM orders ORDER BY created DESC LIMIT 200')).map(o => ({ ...o, data: adminOrderView(parse(o.data, {})) })) : [], requests: requests.map(o => ({ ...o, data: parse(o.data, {}) })), requestReplies: allowed('requests:write') ? await summarizeRequestReplies(runtime(), requests.map(r => r.id)) : {}, coaAutomation: allowed('requests:write') ? await coaAutomationStatus(runtime(), requests.map(r => r.id)) : null, campaigns: allowed('store:write') ? (await listPresaleCampaigns(database())).map(c=>presentationData(c)) : [], team: allowed('team:manage') ? { ...await staffDirectory(runtime()), siteUpdateAccess: await siteUpdateAccessList(database()) } : null });
    }
}

