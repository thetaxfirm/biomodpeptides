import { z } from 'zod';
import { database } from '@/lib/runtime';
import { assignableRoles } from '@/lib/staff';
import { saveStaffMember } from '@/lib/staff-store';
import { setSiteUpdateAccess, SiteUpdateError } from '@/lib/site-updates';
import type { AdminPostContext } from '@/lib/store-api/context';
import { j } from '@/lib/store-api/shared';

export async function adminTeam(context: AdminPostContext) {
    const { action, b, actor, auditEnv } = context;
    if (action === 'admin-staff') {
        const member = z.object({ email: z.string().trim().min(3).max(254), name: z.string().trim().max(100).optional(), role: z.enum(assignableRoles), active: z.boolean() }).parse(b);
        return j(await saveStaffMember(auditEnv(), actor.email, member));
    }
    if (action === 'admin-staff-site-updates') {
        // Owner-only. Lets one named staff member send website update requests (pictures, lab reports, wording).
        const grant = z.object({ email: z.string().trim().min(3).max(254), active: z.boolean() }).parse(b);
        try { return j(await setSiteUpdateAccess(database(), actor.email, grant.email, grant.active)); }
        catch (e) { if (e instanceof SiteUpdateError) return j({ error: e.message }, e.status); throw e; }
    }
    if (action === 'admin-reward') {
        return j({ error: 'Use the reward ledger to review the current balance and record an adjustment.' }, 409);
    }
}

