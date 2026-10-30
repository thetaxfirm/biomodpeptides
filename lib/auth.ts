import { cookies } from 'next/headers';
import { runtime, one, run, uid, timestamp } from './runtime';
import { can, isAssignableRole, normalizeStaffEmail, type StaffPermission, type StaffRole } from './staff';
export type Customer = {
    id: string;
    email: string;
    name: string;
};
export const authReady = () => Boolean(runtime().SUPABASE_URL && runtime().SUPABASE_ANON_KEY);
export async function authCall(path: string, body?: unknown, token?: string) {
    if (!authReady())
        throw new Error('Customer sign-in is being connected. Please try again later.');
    const r = await fetch(runtime().SUPABASE_URL + '/auth/v1/' + path, { method: body ? (path === 'user' ? 'PUT' : 'POST') : 'GET', headers: { apikey: runtime().SUPABASE_ANON_KEY!, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json() as Record<string, any>;
    if (!r.ok)
        throw new Error(path.startsWith('token') ? 'The email or password could not be verified.' : 'This account request could not be completed. Please check your details.');
    return d;
}
export async function customer(): Promise<Customer | null> { const c = await cookies(); const token = c.get('bm_access')?.value; if (!token || !authReady())
    return null; try {
    const u = await authCall('user', undefined, token);
    return u.id && u.email_confirmed_at ? { id: u.id, email: u.email, name: u.user_metadata?.name || '' } : null;
}
catch {
    return null;
} }
export async function requireCustomer() { const u = await customer(); if (!u)
    throw new Error('Please sign in to continue.'); return u; }
export async function storeAuth(data: Record<string, any>, secure: boolean) { const c = await cookies(); if (data.access_token)
    c.set('bm_access', data.access_token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: data.expires_in || 3600 }); if (data.refresh_token)
    c.set('bm_refresh', data.refresh_token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 2592000 }); }
export async function session(secure: boolean) { const c = await cookies(); let id = c.get('bm_session')?.value; let row = id && /^[a-f0-9-]{36}$/.test(id) ? await one<{
    id: string;
    cart: string;
    wishlist: string;
}>('SELECT id,cart,wishlist FROM sessions WHERE id=?', id) : null; if (!row) {
    id = uid();
    await run('INSERT INTO sessions(id,updated) VALUES(?,?)', id, timestamp());
    c.set('bm_session', id, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 2592000 });
    row = { id, cart: '[]', wishlist: '[]' };
} return row; }
// Owners: the STORE_ADMIN_EMAILS runtime setting.
export const isAdminEmail = (email: string) => (runtime().STORE_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
// Owner from the runtime setting, otherwise an active staff row. Any lookup failure
// (including the staff table not existing yet) denies access rather than granting it.
export async function staffRole(email: string): Promise<StaffRole | null> {
    const normalized = normalizeStaffEmail(email || '');
    if (!normalized) return null;
    if (isAdminEmail(normalized)) return 'owner';
    try {
        const row = await one<{ role: string }>('SELECT role FROM staff WHERE email=? AND active=1', normalized);
        return row && isAssignableRole(row.role) ? row.role : null;
    }
    catch { return null; }
}
// Only owners and active staff can create an account through recovery.
// The provider emails a verification link; this never sets a password or grants a session.
export async function requestPasswordRecovery(email: string, origin: string) {
    const normalized = email.trim().toLowerCase();
    const admin = Boolean(await staffRole(normalized));
    await authCall((admin ? 'otp' : 'recover') + '?redirect_to=' + encodeURIComponent(origin + '/reset-password'), { email: normalized, ...(admin ? { create_user: true } : {}) });
}
export async function requireStaff(permission: StaffPermission) { const u = await requireCustomer(); const role = await staffRole(u.email);
    if (!role) throw new Error('Administrator access is required.');
    if (!can(role, permission)) throw new Error('Your administrator role does not include this.');
    return { ...u, role }; }
/** Any one of several permissions, for shared admin views (the dashboard load). */
export async function requireStaffAny(permissions: StaffPermission[]) { const u = await requireCustomer(); const role = await staffRole(u.email);
    if (!role) throw new Error('Administrator access is required.');
    if (!permissions.some(permission => can(role, permission))) throw new Error('Your administrator role does not include this.');
    return { ...u, role }; }
// Full store administration (owners and managers).
export const requireAdmin = () => requireStaff('store:write');
export async function rateLimit(key: string, limit = 30) { const now = timestamp(); const row = await one<{
    count: number;
}>('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING count', key, now + 600000, now, now); if ((row?.count || 0) > limit)
    throw new Error('Too many requests. Please wait a few minutes.'); }
