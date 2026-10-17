// Keeps each request's Workers I/O context alive until its own render settles.
//
// The framework memoizes work per isolate (client-component preloads, lazy module
// imports) as one promise that later requests await. On Workers that promise belongs
// to the request that created it; if that client disconnects first (an aborted
// prefetch, a crawler timeout), the runtime drops its continuations, the promise never
// settles, and every later page request on the isolate hangs with near-zero CPU.
// Seen live on 2026-10-17: about one page request in six never answered.
// Upstream report and fix: cloudflare/vinext#4012, #4024 (not in the version used here).
type Context = { waitUntil(promise: Promise<unknown>): void };
type Handler<E> = (request: Request, env: E, ctx: Context) => Response | Promise<Response>;

// After a disconnect, give imports the aborted render already started time to land.
export const DISCONNECT_GRACE_MS = 2000;
const settle = () => undefined;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Only rendered documents and RSC payloads are piped; anything the app encoded itself,
// upgrades and bodiless responses pass through untouched.
const streamedRender = (response: Response) => !!response.body && response.status !== 101
  && !response.headers.has('content-encoding')
  && /^(text\/html|text\/x-component)/i.test(response.headers.get('content-type') || '');

export function keepRequestAlive<E>(handler: Handler<E>, graceMs = DISCONNECT_GRACE_MS): Handler<E> {
  return (request, env, ctx) => {
    const pending = Promise.resolve().then(() => handler(request, env, ctx));
    if (typeof ctx?.waitUntil !== 'function') return pending;
    ctx.waitUntil(pending.then(settle, settle));
    return pending.then(response => {
      if (!streamedRender(response)) return response;
      const { readable, writable } = new TransformStream();
      ctx.waitUntil(response.body!.pipeTo(writable).catch(() => pause(graceMs)).then(settle, settle));
      return new Response(readable, response);
    });
  };
}
