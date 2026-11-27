import { NextRequest } from 'next/server';
import { z } from 'zod';
import { customer, session, rateLimit } from '@/lib/auth';
import { runtime } from '@/lib/runtime';
import { replyBridgeRoute } from '@/lib/request-reply-route';
import { j } from '@/lib/store-api/shared';
import { readWriteBody } from '@/lib/store-api/write-input';
import { stateRead } from '@/lib/store-api/state-read';
import { accountRead } from '@/lib/store-api/account-read';
import { accountWrite } from '@/lib/store-api/account-write';
import { cartWrite } from '@/lib/store-api/cart-write';
import { authWrite } from '@/lib/store-api/auth-write';
import { checkoutRead } from '@/lib/store-api/checkout-read';
import { checkoutWrite } from '@/lib/store-api/checkout-write';
import { inquiryWrite } from '@/lib/store-api/inquiry-write';
import { adminEarlyRead } from '@/lib/store-api/admin-early-read';
import { adminRead } from '@/lib/store-api/admin-read';
import { adminWrite } from '@/lib/store-api/admin-write';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ action: string }> };

/** Stable transport boundary. Domain handlers retain their existing validation and business rules. */
export async function GET(req: NextRequest, { params }: RouteContext) {
    try {
        const { action } = await params;
        const early = await adminEarlyRead({ req, action, u: null });
        if (early) return early;
        const context = { req, action, u: await customer() };
        for (const handle of [stateRead, checkoutRead, accountRead, adminRead]) {
            const response = await handle(context);
            if (response) return response;
        }
        return j({ error: 'Not found.' }, 404);
    } catch (e) {
        return j({ error: (e as Error).message }, 400);
    }
}
export async function POST(req: NextRequest, { params }: RouteContext) {
    try {
        const { action } = await params;
        // The signed bridge has its own authentication and deliberately precedes browser-origin checks.
        if (action === 'reply-bridge') return replyBridgeRoute(req, runtime());
        const input = await readWriteBody(req);
        if ('response' in input) return input.response;
        const secure = req.nextUrl.protocol === 'https:';
        const s = await session(secure);
        // Routine page navigation refreshes an existing session; credential attempts keep the lower budget.
        await rateLimit(action + ':' + (req.headers.get('cf-connecting-ip') || s.id), action.startsWith('auth') && action !== 'auth-refresh' ? 12 : 120);
        const context = { req, action, b: input.body, secure, s };
        for (const handle of [cartWrite, authWrite, inquiryWrite, accountWrite, checkoutWrite, adminWrite]) {
            const response = await handle(context);
            if (response) return response;
        }
        return j({ error: 'Not found.' }, 404);
    } catch (e) {
        const message = e instanceof z.ZodError ? 'Please check the required fields and their formats.' : (e as Error).message;
        return j({ error: message }, e instanceof Error && 'status' in e && e.status === 409 ? 409 : 400);
    }
}
