import { auditRun, withAuditDb, type AuditActor } from '@/lib/change-history';
import { requireStaff } from '@/lib/auth';
import { runtime, database } from '@/lib/runtime';
import { type StaffPermission } from '@/lib/staff';
import type { StorePostContext } from '@/lib/store-api/context';
import { adminOrders } from '@/lib/store-api/admin-orders';
import { adminRequests } from '@/lib/store-api/admin-requests';
import { adminSettings } from '@/lib/store-api/admin-settings';
import { adminCatalog } from '@/lib/store-api/admin-catalog';
import { adminTeam } from '@/lib/store-api/admin-team';

// An unlisted admin action retains the owner-only default. Authorize before domain dispatch.
const adminActionPermission: Record<string, StaffPermission> = {
    'admin-orders': 'orders:read', 'admin-order': 'orders:fulfill', 'admin-order-archive': 'orders:fulfill', 'admin-order-handoff': 'orders:fulfill', 'admin-reconcile': 'orders:reconcile', 'admin-preorder-release': 'orders:fulfill', 'admin-preorder-plan': 'orders:fulfill',
    'admin-request': 'requests:write', 'admin-request-reply': 'requests:write', 'admin-reply-attachments': 'requests:write', 'admin-reply-desk': 'requests:write', 'admin-request-replies': 'requests:write', 'admin-reply-rule': 'requests:write', 'admin-retire-reply-drafts': 'requests:write', 'admin-request-forward': 'requests:write', 'admin-order-conversation': 'requests:write', 'admin-order-hold': 'requests:write', 'admin-win-back': 'requests:write', 'admin-mark-replied': 'requests:write', 'admin-win-back-preview': 'requests:write', 'admin-request-issue': 'requests:write', 'admin-case-log': 'requests:write', 'admin-coa-process': 'requests:write',
    'admin-config': 'store:write', 'admin-product': 'catalog:write', 'admin-campaign': 'store:write', 'admin-reward': 'store:write', 'admin-coa-config': 'store:write',
    'admin-staff': 'team:manage', 'admin-staff-site-updates': 'team:manage',
};
export async function adminWrite(context: StorePostContext) {
    if (!context.action.startsWith('admin-')) return;
    const { action } = context;
    const actor = await requireStaff(adminActionPermission[action] || 'team:manage');
    const auditActor: AuditActor = { source: 'admin', actor: actor.email, actorType: 'staff', action };
    const auditEnv = () => ({ ...runtime(), DB: withAuditDb(database(), auditActor) } as ReturnType<typeof runtime>);
    const run = (sql: string, ...values: (string | number | null)[]) => auditRun(database(), auditActor, sql, ...values);
    const adminContext = { ...context, actor, auditActor, auditEnv, run };
    for (const handle of [adminOrders, adminRequests, adminSettings, adminCatalog, adminTeam]) {
        const response = await handle(adminContext);
        if (response) return response;
    }
}

