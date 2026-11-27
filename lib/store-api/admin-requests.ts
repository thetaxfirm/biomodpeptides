import { publicCatalog } from '@/lib/public-catalog';
import { batchRecordsFor, batchStatus, batchPath } from '@/lib/testing';
import { externalRepliesFor, markReplied } from '@/lib/request-external';
import { startOrderConversation, saveRequestIssue, issuesFor, caseLog, setOrderHold, startWinBack, winBackPreview } from '@/lib/request-cases';
import { forwardRequest, forwardsFor, teamMembers, activityFor } from '@/lib/request-forward';
import { retireStaleReplyDrafts, replyCustomerContext, summarizeRequestReplies, prepareRequestReply, previewReplyAttachments, replyDeskOptions, saveReplyRule } from '@/lib/request-replies';
import { z } from 'zod';
import { all, one, parse, runtime } from '@/lib/runtime';
import type { AdminPostContext } from '@/lib/store-api/context';
import { j } from '@/lib/store-api/shared';

async function publicCoaLinks() {
    try {
        const snapshot = await publicCatalog();
        if (!snapshot.verified) return [];
        return batchRecordsFor(snapshot.products).filter(record => batchStatus(record) === 'matched').map(record => {
            const product = snapshot.products.find(item => item.id === record.product_id);
            return { label: `${product?.name || record.product_name || 'Product'}${product?.sizes?.[0] ? ' ' + product.sizes[0] : ''} · lot ${record.product_lot}`, url: 'https://trybiomod.com' + batchPath(record) };
        }).sort((a, b) => a.label.localeCompare(b.label));
    } catch { return []; }
}
export async function adminRequests(context: AdminPostContext) {
    const { action, b, actor, run } = context;
    if (action === 'admin-reply-attachments') {
        const input = z.object({ id: z.string().uuid(), expectedRevision: z.number().int().positive().nullable(), coaSha256: z.string().max(330).nullable().optional() }).parse(b);
        try { return j(await previewReplyAttachments(runtime(), { ...input, requestId: input.id }, actor)); }
        catch (error) {
            const status = (error as Error & { status?: number }).status;
            return j({ error: status ? (error as Error).message : 'Attachments could not be checked. Try again.' }, status || 500);
        }
    }
    if (action === 'admin-request-reply') {
        const input = z.object({ id: z.string().uuid(), mode: z.enum(['ai', 'staff']), body: z.string().max(12000).optional(), instruction: z.string().max(2000).optional(), expectedRevision: z.number().int().positive().nullable(), coaSha256: z.string().max(330).nullable().optional(), send: z.boolean().optional(), purpose: z.enum(['checkout_recovery', 'reply']).optional() }).parse(b);
        try {
            const reply = await prepareRequestReply(runtime(), { ...input, requestId: input.id }, actor);
            return j({ reply, message: input.send ? 'Sending from contact@trybiomod.com through Jarvis.' : input.mode === 'ai' ? 'AI is writing the draft.' : 'Draft saved. Nothing was sent.' });
        } catch (error) {
            const status = (error as Error & { status?: number }).status;
            return j({ error: status ? (error as Error).message : 'The reply could not be prepared. Refresh and try again.' }, status || 500);
        }
    }
    if (action === 'admin-reply-desk') return j({ ...(await replyDeskOptions(runtime())), links: await publicCoaLinks(), team: await teamMembers(runtime()) });
    if (action === 'admin-request-replies') {
        const input = z.object({ ids: z.array(z.string().uuid()).max(200), refreshRequests: z.boolean().optional(), focusId: z.string().uuid().nullable().optional() }).parse(b);
        type RequestRow = { id: string; kind: string; status: string; data: string; created: number };
        let requests: (Omit<RequestRow, 'data'> & { data: Record<string, unknown> })[] | undefined;
        if (input.refreshRequests) {
            const rows = await all<RequestRow>("SELECT id,kind,status,data,created FROM requests WHERE kind IN ('contact','stock','affiliate') ORDER BY created DESC,id DESC LIMIT 200");
            const focusId = input.focusId?.toLowerCase();
            // An alert can refer to an older or deleted conversation. Its exact row
            // remains reachable without expanding the general request list.
            if (focusId && !rows.some(row => row.id === focusId)) {
                const focused = await one<RequestRow>("SELECT id,kind,status,data,created FROM requests WHERE id=? AND kind IN ('contact','stock','affiliate')", focusId);
                if (focused) rows.push(focused);
            }
            requests = rows.map(row => {
                const data = parse<unknown>(row.data, {});
                return { ...row, data: data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {} };
            });
        }
        const ids = [...new Set([...input.ids.map(id => id.toLowerCase()), ...(requests || []).map(row => row.id)])];
        const env = runtime();
        const replies: Awaited<ReturnType<typeof summarizeRequestReplies>> = {}, forwards: Awaited<ReturnType<typeof forwardsFor>> = {}, activity: Awaited<ReturnType<typeof activityFor>> = {}, issues: Awaited<ReturnType<typeof issuesFor>> = {}, external: Awaited<ReturnType<typeof externalRepliesFor>> = {};
        // At most 401 IDs: 200 displayed IDs, 200 fresh rows and one focused row.
        // Each helper intentionally accepts only 200, so never silently truncate one.
        for (let offset = 0; offset < ids.length; offset += 200) {
            const chunk = ids.slice(offset, offset + 200);
            const [nextReplies, nextForwards, nextActivity, nextIssues, nextExternal] = await Promise.all([
                summarizeRequestReplies(env, chunk), forwardsFor(env, chunk), activityFor(env, chunk), issuesFor(env, chunk), externalRepliesFor(env, chunk),
            ]);
            Object.assign(replies, nextReplies); Object.assign(forwards, nextForwards); Object.assign(activity, nextActivity); Object.assign(issues, nextIssues); Object.assign(external, nextExternal);
        }
        const customerContext = input.focusId ? { requestId: input.focusId, context: await replyCustomerContext(env, input.focusId).catch(() => null) } : undefined;
        return j({ replies, forwards, activity, issues, external, ...(customerContext ? { customerContext } : {}), ...(requests ? { requests } : {}) });
    }
    if (action === 'admin-order-conversation') {
        const input = z.object({ orderId: z.string().min(6).max(80) }).parse(b);
        try { const result = await startOrderConversation(runtime(), input.orderId, actor); return j({ ...result, message: result.created ? 'Conversation started. Nothing was sent.' : 'Opened the existing conversation for this order.' }); }
        catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not open a conversation for this order.' }, status || 500); }
    }
    if (action === 'admin-order-hold') {
        const input = z.object({ orderId: z.string().min(6).max(80), issue: z.string().max(40).optional(), note: z.string().max(500).optional(), clear: z.boolean().optional() }).parse(b);
        try {
            if (input.clear) { await setOrderHold(runtime(), input.orderId, null, actor); return j({ message: 'Hold cleared. The order can ship again.' }); }
            const hold = await setOrderHold(runtime(), input.orderId, { issue: input.issue || '', note: input.note }, actor);
            const conversation = await startOrderConversation(runtime(), input.orderId, actor);
            const known = (await issuesFor(runtime(), [conversation.requestId]))[conversation.requestId];
            await saveRequestIssue(runtime(), { requestId: conversation.requestId, issue: hold!.issue, resolutions: known?.resolutions || [], note: hold!.note || known?.note || '' }, actor);
            return j({ hold, requestId: conversation.requestId, message: 'Order on hold. Nothing was sent to the customer.' });
        } catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not update the hold.' }, status || 500); }
    }
    if (action === 'admin-mark-replied') {
        const input = z.object({ id: z.string().uuid(), note: z.string().max(1000).optional() }).parse(b);
        try { return j({ reply: await markReplied(runtime(), { requestId: input.id, note: input.note }, actor), message: 'Marked as replied.' }); }
        catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not mark it.' }, status || 500); }
    }
    if (action === 'admin-win-back') {
        const input = z.object({ orderId: z.string().min(6).max(80), template: z.string().max(40) }).parse(b);
        try { return j({ ...(await startWinBack(runtime(), input.orderId, input.template, actor)), message: 'Draft ready in Requests. Nothing was sent.' }); }
        catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not prepare the email.' }, status || 500); }
    }
    if (action === 'admin-win-back-preview') {
        const input = z.object({ id: z.string().uuid() }).parse(b);
        try { return j({ templates: await winBackPreview(runtime(), input.id) }); }
        catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Templates unavailable.' }, status || 500); }
    }
    if (action === 'admin-request-issue') {
        const input = z.object({ id: z.string().uuid(), issue: z.string().max(40), resolutions: z.array(z.string().max(40)).max(10).optional(), note: z.string().max(1000).optional() }).parse(b);
        try { return j({ issue: await saveRequestIssue(runtime(), { requestId: input.id, issue: input.issue, resolutions: input.resolutions, note: input.note }, actor) }); }
        catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Could not save the issue.' }, status || 500); }
    }
    if (action === 'admin-case-log') return j({ cases: await caseLog(runtime()) });
    if (action === 'admin-request-forward') {
        const input = z.object({ id: z.string().uuid(), to: z.string().email().max(254), note: z.string().max(2000).optional() }).parse(b);
        try { const forward = await forwardRequest(runtime(), { requestId: input.id, to: input.to, note: input.note }, actor); return j({ forward, message: 'Forwarded to ' + forward.to + '.' }); }
        catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Email status unconfirmed. Check the mail provider before retrying.' }, status || 500); }
    }
    if (action === 'admin-retire-reply-drafts') {
        try { return j(await retireStaleReplyDrafts(runtime(), actor)); }
        catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'Old drafts could not be removed. Refresh and try again.' }, status || 500); }
    }
    if (action === 'admin-reply-rule') {
        const input = z.object({ rule: z.string().max(500).optional(), removeId: z.string().uuid().optional(), issue: z.string().max(40).nullable().optional() }).parse(b);
        try { await saveReplyRule(runtime(), input, actor); return j({ ...(await replyDeskOptions(runtime())), links: await publicCoaLinks(), team: await teamMembers(runtime()), message: input.removeId ? 'Rule removed.' : 'Rule saved. The next drafts will follow it.' }); }
        catch (error) { const status = (error as Error & { status?: number }).status; return j({ error: status ? (error as Error).message : 'The rule could not be saved.' }, status || 500); }
    }
    if (action === 'admin-coa-process') {
        return j({ error: 'Automatic COA sending is disabled. Prepare a reply for Ash to review in Jarvis.' }, 409);
    }
    if (action === 'admin-request') {
        const id = z.string().uuid().parse(b.id);
        const status = z.enum(['new', 'in_progress', 'resolved', 'spam', 'reviewed', 'deleted']).parse(b.status);
        if (b.expectedStatus === undefined)
            return j({ error: 'Refresh the request list before changing its status.', code: 'request_refresh_required' }, 400);
        // Compare the saved value exactly, including legacy statuses. This
        // only records an inbox workflow decision; it never approves an
        // affiliate, changes request content or processes an email.
        const expectedStatus = z.string().min(1).max(50).parse(b.expectedStatus);
        const result = await run('UPDATE requests SET status=? WHERE id=? AND status=? AND kind IN (\'contact\',\'stock\',\'affiliate\')', status, id, expectedStatus);
        if (!result.meta.changes) {
            const existing = await one('SELECT id FROM requests WHERE id=? AND kind IN (\'contact\',\'stock\',\'affiliate\')', id);
            return existing
                ? j({ error: 'This request changed since you loaded it. Refresh the request list and try again.', code: 'request_status_conflict' }, 409)
                : j({ error: 'Request not found.' }, 404);
        }
        return j({ ok: true, id, status, message: 'Request status updated.' });
    }
}

