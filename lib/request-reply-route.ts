import { handleReplyBridge } from './request-replies';
type Env = Record<string, string | undefined> & { DB: D1Database };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
async function equalCredential(left: string, right: string) {
 const encode = new TextEncoder();
 const hashes = await Promise.all([left, right].map(value => crypto.subtle.digest('SHA-256', encode.encode(value))));
 const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]);
 let mismatch = 0; for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
 return mismatch === 0;
}
/** Scoped server-to-server pull bridge. No browser session, general admin API or send capability. */
export async function replyBridgeRoute(request: Request, env: Env) {
 const expected = env.REQUEST_REPLY_BRIDGE_TOKEN;
 const header = request.headers.get('authorization') || '';
 if (!expected || expected.length < 32) return response({ error: 'Reply bridge unavailable.' }, 503);
 if (header.length > 300 || !header.startsWith('Bearer ') || !(await equalCredential(header.slice(7), expected))) return response({ error: 'Unauthorized.' }, 401);
 if (!request.headers.get('content-type')?.includes('application/json')) return response({ error: 'A JSON object is required.' }, 400);
 if (Number(request.headers.get('content-length') || 0) > 300000) return response({ error: 'Request too large.' }, 413);
 try {
  let size = 0, raw = ''; const reader = request.body?.getReader(), decoder = new TextDecoder();
  if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 300000) { await reader.cancel(); return response({ error: 'Request too large.' }, 413); } raw += decoder.decode(chunk.value, { stream: true }); }
  raw += decoder.decode();
  let payload: unknown; try { payload = JSON.parse(raw); } catch { return response({ error: 'A JSON object is required.' }, 400); }
  return response(await handleReplyBridge(env, payload));
 } catch (error) {
  const code = (error as Error & { status?: number }).status;
  return response({ error: code && [400,403,404,409].includes(code) ? (error as Error).message : 'Reply bridge temporarily unavailable.' }, code && [400,403,404,409].includes(code) ? code : 503);
 }
}
