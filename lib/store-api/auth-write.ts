import { AUTH_RETURN_COOKIE, AUTH_RETURN_MAX_AGE, safeAuthReturn, clearAuthSessionCookies, ANONYMOUS_SESSION_COOKIE, needsAccountSession } from '@/lib/auth-return';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { session, customer, authCall, storeAuth, requestPasswordRecovery } from '@/lib/auth';
import { database } from '@/lib/runtime';
import { transferGuestOrders } from '@/lib/guest-checkout';
import type { StorePostContext } from '@/lib/store-api/context';
import { j, str } from '@/lib/store-api/shared';
import { cartImports } from '@/lib/store-api/shopper';
import { captureContact } from '@/lib/store-api/contact-capture';

export async function authWrite(context: StorePostContext) {
    const { req, action, b, secure, s } = context;
    if (action === 'auth-login') {
        const prior = await customer();
        const d = await authCall('token?grant_type=password', { email: z.string().email().parse(b.email), password: z.string().min(1).max(200).parse(b.password) });
        const c = await cookies();
        // A direct account switch must not carry the previous member's browser cart.
        const claimedOwner = await cartImports().ownerForSession(s.id);
        const switchingAccount = needsAccountSession(prior?.id, d.user?.id, claimedOwner, Boolean(c.get('bm_access') || c.get('bm_refresh')), s.id, c.get(ANONYMOUS_SESSION_COOKIE)?.value);
        if (switchingAccount) c.delete('bm_session');
        const loginSession = switchingAccount ? await session(secure) : s;
        if (typeof d.user?.id !== 'string') throw new Error('Please sign in again.');
        await cartImports().record(d.user.id, loginSession.id);
        await storeAuth(d, secure);
        await captureContact({ email: d.user.email, owner: d.user.id, name: d.user.user_metadata?.name, phone: d.user.user_metadata?.phone, source: 'account' });
        // Orders placed as a guest with this email join the account. Only once the provider has verified the address.
        if (d.user.email_confirmed_at && typeof d.user.email === 'string') { try { await transferGuestOrders(database(), d.user.id, d.user.email); } catch { /* sign-in never fails on this */ } }
        c.delete(ANONYMOUS_SESSION_COOKIE);
        const returnTo = safeAuthReturn(b.returnTo ?? c.get(AUTH_RETURN_COOKIE)?.value);
        c.delete(AUTH_RETURN_COOKIE);
        return j({ returnTo });
    }
    if (action === 'auth-register') {
        const name = str(b.name, 100);
        const email = z.string().email().parse(b.email);
        const password = z.string().min(8).max(200).parse(b.password);
        const phone = z.string().trim().regex(/^[0-9+().\-\s]{7,30}$/, 'Enter a valid phone number.').parse(b.phone);
        const company = str(b.company, 150);
        const businessType = z.enum(['university', 'researcher', 'laboratory', 'medical_professional', 'other'], { errorMap: () => ({ message: 'Choose your type of business.' }) }).parse(b.businessType);
        if (password !== b.confirmPassword)
            throw new Error('Passwords do not match.');
        // Supabase sends the verification email; unverified members cannot sign in (see customer() in lib/auth.ts).
        const d = await authCall('signup?redirect_to=' + encodeURIComponent(req.nextUrl.origin + '/login'), { email, password, data: { name, company, phone, business_type: businessType } });
        await captureContact({ email, owner: typeof d?.user?.id === 'string' ? d.user.id : typeof d?.id === 'string' ? d.id : null, name, phone, source: 'account' });
        (await cookies()).set(AUTH_RETURN_COOKIE, safeAuthReturn(b.returnTo), { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: AUTH_RETURN_MAX_AGE });
        return j({ message: 'Almost done. Check your email and click the link to verify your membership, then sign in.', verificationRequired: true });
    }
    if (action === 'auth-recover') {
        await requestPasswordRecovery(z.string().trim().email().parse(b.email), req.nextUrl.origin);
        (await cookies()).set(AUTH_RETURN_COOKIE, safeAuthReturn(b.returnTo), { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: AUTH_RETURN_MAX_AGE });
        return j({ message: 'If this address is eligible, check your email for a secure password link.' });
    }
    if (action === 'auth-reset') {
        const token = str(b.token, 5000);
        const password = z.string().min(8).max(200).parse(b.password);
        if (password !== b.confirmPassword)
            throw new Error('Passwords do not match.');
        await authCall('user', { password }, token);
        return j({ message: 'Your password has been updated. Sign in to continue.' });
    }
    if (action === 'auth-refresh') {
        const token = (await cookies()).get('bm_refresh')?.value;
        if (!token)
            return j({ ok: true });
        const d = await authCall('token?grant_type=refresh_token', { refresh_token: token });
        await storeAuth(d, secure);
        return j({ ok: true });
    }
    if (action === 'auth-logout') {
        const c = await cookies();
        clearAuthSessionCookies(c);
        return j({ ok: true });
    }
}

