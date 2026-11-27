export class ProviderHistoryError extends Error {
  constructor(message: string, public retryAfterMs = 15 * 60000) { super(message); }
}

/** Fixed provider URLs only; redirects are never followed, and raw errors/bodies never reach health. */
export async function providerJson(request: typeof fetch, url: string, token?: string): Promise<{ data: any; headers: Headers }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !['api.github.com', 'api.cloudflare.com'].includes(parsed.hostname)) throw new ProviderHistoryError('Provider target validation failed');
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'TryBiomod-history' };
  if (parsed.hostname === 'api.github.com') { headers.Accept = 'application/vnd.github+json'; headers['X-GitHub-Api-Version'] = '2022-11-28'; }
  if (token) headers.Authorization = 'Bearer ' + token;
  let response: Response;
  try { response = await request(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
  catch { throw new ProviderHistoryError('Provider network request failed'); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const retry = Number(response.headers.get('retry-after')) * 1000;
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
    const wait = Math.min(86400000, Math.max(15 * 60000, Number.isFinite(retry) ? retry : 0, Number.isFinite(reset) && response.headers.get('x-ratelimit-remaining') === '0' ? reset : 0));
    throw new ProviderHistoryError(`Provider HTTP ${response.status}${response.status === 401 || response.status === 403 ? ': read access unavailable or rate limited' : response.status === 429 ? ': rate limited' : ''}`, wait);
  }
  const reader = response.body?.getReader(); if (!reader) throw new ProviderHistoryError('Provider response body unavailable');
  let bytes = 0, text = ''; const decoder = new TextDecoder();
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new ProviderHistoryError('Provider response exceeded size limit'); } text += decoder.decode(part.value, { stream: true }); }
    text += decoder.decode();
  } catch (error) { if (error instanceof ProviderHistoryError) throw error; throw new ProviderHistoryError('Provider response read failed'); }
  let data: any; try { data = JSON.parse(text); } catch { throw new ProviderHistoryError('Provider response format invalid'); }
  if (parsed.hostname === 'api.cloudflare.com' && data?.success !== true) throw new ProviderHistoryError('Provider reported an unsuccessful response');
  return { data, headers: response.headers };
}
