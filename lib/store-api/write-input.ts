import { NextRequest, NextResponse } from 'next/server';

import { j } from '@/lib/store-api/shared';

/** Preserve the existing streamed byte limit and JSON validation before opening a session. */
export async function readWriteBody(req: NextRequest): Promise<{ body: Record<string, any> } | { response: NextResponse }> {
    if (req.headers.get('origin') !== req.nextUrl.origin)
        return { response: j({ error: 'Please refresh the page and try again.' }, 403) };
    if (Number(req.headers.get('content-length') || 0) > 30000)
        return { response: j({ error: 'Request too large.' }, 413) };
    const reader = req.body?.getReader();
    let raw = '';
    let bytes = 0;
    if (reader) {
        const decoder = new TextDecoder();
        while (true) {
            const part = await reader.read();
            if (part.done)
                break;
            bytes += part.value.byteLength;
            if (bytes > 30000) {
                await reader.cancel();
                return { response: j({ error: 'Request too large.' }, 413) };
            }
            raw += decoder.decode(part.value, { stream: true });
        }
        raw += decoder.decode();
    }
    if (raw.length > 30000)
        return { response: j({ error: 'Request too large.' }, 413) };
    const b = JSON.parse(raw);
    if (!b || typeof b !== 'object' || Array.isArray(b) || !req.headers.get('content-type')?.includes('application/json'))
        return { response: j({ error: 'A JSON object is required.' }, 400) };
    return { body: b };
}
