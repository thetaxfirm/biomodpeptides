const repository = 'thetaxfirm/biomodpeptides';
const apiUrl = `https://api.github.com/repos/${repository}/commits?sha=main&per_page=100`;
const atomUrl = `https://github.com/${repository}/commits/main.atom`;
export type SourceRevision = { sha: string; timestamp: number };
type Feed = 'REST API' | 'Atom feed';
class SourceFailure extends Error {}

function revision(sha: unknown, date: unknown, feed: Feed): SourceRevision {
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(date)) throw new SourceFailure(`${feed} metadata validation failed`);
  const timestamp = Date.parse(date);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || new Date(timestamp).toISOString().slice(0, 19) !== date.slice(0, 19)) throw new SourceFailure(`${feed} metadata validation failed`);
  return { sha, timestamp };
}

async function read(request: typeof fetch, url: string, feed: Feed, maxBytes: number): Promise<string> {
  let response: Response;
  try {
    response = await request(url, { headers: { Accept: feed === 'REST API' ? 'application/vnd.github+json' : 'application/atom+xml', 'User-Agent': 'TryBiomod-history' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { throw new SourceFailure(`${feed} network request failed`); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new SourceFailure(`${feed} HTTP ${response.status}${response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' ? ' (rate limited)' : ''}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SourceFailure(`${feed} response body missing`);
  const decoder = new TextDecoder(); let bytes = 0, text = '';
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new SourceFailure(`${feed} response exceeded size limit`); }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) { if (error instanceof SourceFailure) throw error; throw new SourceFailure(`${feed} response read failed`); }
}

function apiRevisions(text: string): SourceRevision[] {
  let rows: unknown;
  try { rows = JSON.parse(text); } catch { throw new SourceFailure('REST API response format invalid'); }
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new SourceFailure('REST API metadata validation failed');
  return rows.map(row => revision(row?.sha, row?.commit?.committer?.date, 'REST API'));
}

function atomRevisions(text: string): SourceRevision[] {
  // Parse only GitHub's bounded, unprefixed Atom metadata. No XML entities, authored content,
  // titles or author fields are interpreted; every revision must match this repository's link.
  if (!/<feed\b[^>]*\bxmlns="http:\/\/www\.w3\.org\/2005\/Atom"[^>]*>/.test(text) || !/<\/feed>\s*$/.test(text) || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<!--/i.test(text)) throw new SourceFailure('Atom feed response format invalid');
  const entries = [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  if (!entries.length || entries.length > 20 || (text.match(/<entry\b/g) || []).length !== entries.length) throw new SourceFailure('Atom feed metadata validation failed');
  return entries.map(([, entry]) => {
    const ids = [...entry.matchAll(/<id>([^<]*)<\/id>/g)], dates = [...entry.matchAll(/<updated>([^<]*)<\/updated>/g)];
    const sha = ids.length === 1 ? ids[0][1].match(/^tag:github\.com,2008:Grit::Commit\/([a-f0-9]{40})$/)?.[1] : undefined;
    const result = revision(sha, dates.length === 1 ? dates[0][1] : undefined, 'Atom feed');
    const links = [...entry.matchAll(/<link\b([^>]*)\/>/g)].map(([, attributes]) => Object.fromEntries([...attributes.matchAll(/\b(type|rel|href)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
    if (links.filter(link => link.rel === 'alternate' && link.type === 'text/html' && link.href === `https://github.com/${repository}/commit/${result.sha}`).length !== 1) throw new SourceFailure('Atom feed repository link validation failed');
    return result;
  });
}

/** Public, bounded observations only. Persistence happens only after the whole feed validates. */
export async function recentSourceRevisions(request: typeof fetch): Promise<{ revisions: SourceRevision[]; detail: string }> {
  let apiFailure: string;
  try { return { revisions: apiRevisions(await read(request, apiUrl, 'REST API', 2 * 1024 * 1024)), detail: 'GitHub REST API' }; }
  catch (error) { apiFailure = error instanceof SourceFailure ? error.message : 'REST API read failed'; }
  try { return { revisions: atomRevisions(await read(request, atomUrl, 'Atom feed', 256 * 1024)), detail: `Public Atom fallback (${apiFailure})` }; }
  catch (error) { throw new SourceFailure(`${apiFailure}; ${error instanceof SourceFailure ? error.message : 'Atom feed read failed'}`); }
}

export const sourceFailureDescription = (error: unknown) => error instanceof SourceFailure ? error.message : 'Source read failed';
