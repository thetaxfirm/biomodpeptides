// Read provider evidence into the protected TryBiomod change history. No provider settings are changed.
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { target, safeFiles, commitEvent, deploymentEvent, versionEvent, checkEvent, auditEvent, insertStatement } from '../lib/change-history-provider-events.mjs';
export { target, safeFiles, commitEvent, deploymentEvent, versionEvent, checkEvent, auditEvent, insertStatement } from '../lib/change-history-provider-events.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const accountBase = `/accounts/${target.account}`;
const workerBase = `${accountBase}/workers/scripts/${target.worker}`;
function command(executable, args) {
  try { return execFileSync(executable, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }); }
  catch { throw new Error(`The ${executable === 'gh' ? 'GitHub' : executable === 'git' ? 'local Git' : 'Cloudflare login'} command failed; output withheld to protect credentials.`); }
}
function github(path) { return JSON.parse(command('gh', ['api', path])); }
function cloudflareHeaders() {
  const credentials = JSON.parse(command(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json']));
  if (credentials.token) return { Authorization: `Bearer ${credentials.token}` };
  if (credentials.type === 'api_key' && credentials.key && credentials.email) return { 'X-Auth-Key': credentials.key, 'X-Auth-Email': credentials.email };
  throw new Error('Cloudflare login unavailable.');
}
async function cloudflare(path, headers, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method: body ? 'POST' : 'GET', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000), redirect: 'error' });
  const data = await response.json();
  if (!response.ok || data.success !== true || (Array.isArray(data.result) && data.result.some(r => r?.success === false))) throw new Error(`Cloudflare returned HTTP ${response.status}; provider details withheld.`);
  return data;
}
export async function collectHistory({ now = Date.now(), gh = github, cf, filePaths } = {}) {
  const events = [], sync = [];
  const state = (source, status, description) => sync.push({ source, synced_at: now, state: status, description });
  let commits = [], githubComplete = false;
  try {
    for (let page = 1; page <= 100; page++) {
      const batch = gh(`repos/${target.repository}/commits?sha=main&per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('Unexpected GitHub response.');
      commits.push(...batch);
      if (batch.length < 100) { githubComplete = true; break; }
    }
    for (const commit of commits) {
      let paths = []; try { paths = filePaths ? filePaths(commit.sha) : command('git', ['diff-tree', '--root', '-m', '--no-commit-id', '--name-only', '-r', commit.sha]).split('\n'); } catch { /* Evidence link remains available when this checkout is behind. */ }
      const item = commitEvent(commit, paths, now); if (item) events.push(item);
    }
    let checkReads = 0;
    for (const commit of commits.slice(0, 20)) {
      try { for (const check of gh(`repos/${target.repository}/commits/${commit.sha}/check-runs?per_page=100`).check_runs || []) { const item = checkEvent(check, commit.sha, now); if (item) events.push(item); } checkReads++; } catch { /* Report partial check coverage below. */ }
    }
    state('github', githubComplete ? 'active' : 'partial', `${commits.length} commits read from GitHub main; ${githubComplete ? 'available commit pages exhausted' : 'page limit reached'}. Check results read for ${checkReads} of the newest ${Math.min(20, commits.length)} commits. Git author and committer fields are self-reported metadata; they do not identify an AI assistant or prove who deployed.`);
  } catch { state('github', 'unavailable', 'GitHub history could not be read. Earlier imported entries remain; this run does not establish current coverage.'); }
  for (const [suffix, key, convert] of [['deployments', 'deployments', deploymentEvent], ['versions', 'items', versionEvent]]) {
    let count = 0, complete = false;
    try {
      if (!cf) throw new Error('Cloudflare unavailable.');
      for (let page = 1; page <= 100; page++) {
        const response = await cf(`${workerBase}/${suffix}?per_page=100&page=${page}`);
        const batch = response.result?.[key]; if (!Array.isArray(batch)) throw new Error('Unexpected Cloudflare response.');
        for (const raw of batch) { const item = convert(raw, now); if (item) events.push(item); }
        count += batch.length;
        if (batch.length < 100 || (response.result_info?.total_count !== undefined && count >= response.result_info.total_count)) { complete = true; break; }
      }
      state(suffix === 'deployments' ? 'cloudflare' : 'cloudflare_versions', complete ? 'active' : 'partial', `${count} retained Worker ${suffix} read from Cloudflare. ${complete ? 'Available provider pages exhausted.' : 'Page limit reached.'} Provider accounts are not proof of the individual behind shared credentials. Older events outside provider retention cannot be reconstructed.`);
    } catch { state(suffix === 'deployments' ? 'cloudflare' : 'cloudflare_versions', 'unavailable', `Cloudflare ${suffix} could not be read. Earlier entries remain; platform settings coverage is reported separately.`); }
  }
  try {
    if (!cf) throw new Error('Cloudflare unavailable.');
    let cursor = '', complete = false, count = 0;
    const since = new Date(now - 30 * 86_400_000).toISOString(), before = new Date(now).toISOString();
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ since, before, limit: '100', ...(cursor ? { cursor } : {}) });
      const response = await cf(`${accountBase}/logs/audit?${query}`);
      if (!Array.isArray(response.result)) throw new Error('Unexpected audit response.');
      for (const raw of response.result) { const item = auditEvent(raw, now); if (item) { events.push(item); count++; } }
      const next = response.result_info?.cursor;
      if (!next || response.result.length === 0) { complete = true; break; }
      if (next === cursor) break;
      cursor = next;
    }
    state('cloudflare_audit', complete ? 'active' : 'partial', `${count} TryBiomod-scoped platform events read in the 30 days ending ${before}. ${complete ? 'Available pages exhausted.' : 'Pagination incomplete.'} Only exact Worker/database resources or the trybiomod.com zone are retained. Settings values, IP addresses and raw requests are never imported.`);
  } catch { state('cloudflare_audit', 'unavailable', 'Cloudflare account audit logs could not be read with the current login. Dashboard, DNS and direct platform settings changes are not fully covered. Audit Logs Read or the broader Account Settings Read permission is required; no permissions were changed.'); }
  state('vercel', 'unavailable', 'The current TryBiomod production runtime is Cloudflare Workers and D1. Vercel is not connected to this history. No Vercel project or BiomodPro account was inspected or changed.');
  return { events, sync };
}
export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--dry-run', '--remote'].includes(arg)) || (args.includes('--remote') && args.includes('--dry-run'))) throw new Error('Use --dry-run (default) or --remote.');
  let headers; try { headers = cloudflareHeaders(); } catch { /* Collect GitHub and report Cloudflare coverage unavailable. */ }
  const report = await collectHistory({ cf: headers ? path => cloudflare(path, headers) : undefined });
  let inserted = 0;
  if (args.includes('--remote')) {
    if (!headers) throw new Error('Cloudflare login is required to import history into D1.');
    const endpoint = `${accountBase}/d1/database/${target.database}/query`;
    const statements = report.events.map(insertStatement);
    for (let offset = 0; offset < statements.length; offset += 25) {
      const result = await cloudflare(endpoint, headers, { batch: statements.slice(offset, offset + 25) });
      inserted += result.result.reduce((sum, item) => sum + (Number(item.meta?.changes) || 0), 0);
    }
    // Only mark a provider sync after all its sanitized event inserts succeeded.
    await cloudflare(endpoint, headers, { batch: report.sync.map(item => ({ sql: 'INSERT INTO change_history_sync(source,synced_at,state,description) VALUES (?,?,?,?) ON CONFLICT(source) DO UPDATE SET synced_at=excluded.synced_at,state=excluded.state,description=excluded.description', params: [item.source, item.synced_at, item.state, item.description] })) });
  }
  console.log(JSON.stringify({ mode: args.includes('--remote') ? 'imported' : 'dry-run', observed: report.events.length, inserted: args.includes('--remote') ? inserted : null, preservedExisting: args.includes('--remote') ? report.events.length - inserted : null, byAction: Object.fromEntries([...new Set(report.events.map(e => e.action))].map(action => [action, report.events.filter(e => e.action === action).length])), coverage: report.sync }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
