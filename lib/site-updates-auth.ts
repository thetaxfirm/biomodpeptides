// Sign-in check for website update requests. Kept apart from lib/auth.ts so that module's
// dependencies stay exactly as its isolated tests expect.
import { requireCustomer, staffRole } from './auth';
import { runtime } from './runtime';
import { hasSiteUpdateAccess } from './site-updates';
/** An owner, or active staff an owner has granted website updates to. */
export async function requireSiteRequester() {
    const u = await requireCustomer(), role = await staffRole(u.email);
    if (!role) throw new Error('Administrator access is required.');
    if (!await hasSiteUpdateAccess(runtime().DB, { email: u.email, role })) throw new Error('Your administrator role does not include this.');
    return { ...u, role };
}
