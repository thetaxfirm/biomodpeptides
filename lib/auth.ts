import { cookies } from 'next/headers';
import { runtime, one, run, uid, timestamp } from './runtime';
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
export async function requireAdmin() { const u = await requireCustomer(); if (!(runtime().STORE_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).includes(u.email.toLowerCase()))
    throw new Error('Administrator access is required.'); return u; }
export async function rateLimit(key: string, limit = 30) { const now = timestamp(); const row = await one<{
    count: number;
}>('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING count', key, now + 600000, now, now); if ((row?.count || 0) > limit)
    throw new Error('Too many requests. Please wait a few minutes.'); }
