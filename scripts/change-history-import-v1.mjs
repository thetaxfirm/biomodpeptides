// Read provider evidence into the protected TryBiomod change history. No provider settings are changed.
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const target = Object.freeze({ account: '99aaaddf04e12ed1467d146bb2467455', worker: 'biomod-peptides', database: '877af242-59d4-4122-a1ff-50fcf02a54dc', repository: 'thetaxfirm/biomodpeptides' });
const root = fileURLToPath(new URL('../', import.meta.url));
const accountBase = `/accounts/${target.account}`;
const workerBase = `${accountBase}/workers/scripts/${target.worker}`;
const dashboard = `https://dash.cloudflare.com/${target.account}/workers/services/view/${target.worker}/production`;
const uuid = /^[a-f0-9-]{32,36}$/i;
const sha = /^[a-f0-9]{40}$/i;
const field = (name, after) => ({ field: name, before: null, after });
function text(value, length = 160) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, length) : ''; }
function date(value) { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function actor(value) { const s = text(value); return s && !/https?:|bearer|password|secret|token\s*[:=]/i.test(s) ? s : 'Not identified by source'; }
function event(values, now) { return { ...values, recorded_at: now }; }
export function safeFiles(paths) {
  return [...new Set(paths.filter(p => typeof p === 'string' && p.length <= 240 && !/(^|\/)\.env|credential|secret|private|\.pem$|\.key$|[\u0000-\u001f]/i.test(p) && /^(app\/|components\/|lib\/|scripts\/|tests\/|drizzle\/|public\/|\.github\/|worker\.ts$|vite\.config\.ts$|package(?:-lock)?\.json$|README\.md$|AGENTS\.md$)/.test(p)))].sort();
}
function codeSummary(files) {
  const areas = [];
  if (files.some(p => /catalog|product|sales|preorder|promotion|pack|pricing/.test(p))) areas.push('products or pricing');
  if (files.some(p => /checkout|payment|order|fulfillment|shipping|easypost/.test(p))) areas.push('checkout or orders');
  if (files.some(p => /admin|auth|staff|account/.test(p))) areas.push('administration or access');
  if (files.some(p => /seo|search|sitemap|robots/.test(p))) areas.push('search visibility');
  if (files.some(p => /coa|mail|notification/.test(p))) areas.push('reports or email');
  if (files.some(p => /worker|vite|package|drizzle|\.github/.test(p))) areas.push('hosting or data');
  return `Source revision recorded on main${areas.length ? ': ' + areas.join(', ') : ''}.`;
}
export function commitEvent(commit, files, now) {
  if (!sha.test(commit?.sha) || !date(commit?.commit?.committer?.date)) return null;
  const paths = safeFiles(files);
  return event({ id: `github:commit:${commit.sha}`, occurred_at: date(commit.commit.committer.date), source: 'github', actor: actor(commit.commit.author?.name), actor_type: 'git', action: 'source_commit', entity_type: 'source', entity_id: commit.sha, summary: codeSummary(paths), status: 'observed', changes: [field('Git author (self-reported metadata)', actor(commit.commit.author?.name)), field('Git committer (self-reported metadata)', actor(commit.commit.committer?.name)), field('GitHub author account, when linked', text(commit.author?.login) || 'Not linked'), field('Signature verified by GitHub', commit.commit.verification?.verified === true), field('Changed source paths', paths.length ? paths.join('\n').slice(0, 8000) : 'Path detail unavailable in this checkout; inspect source evidence'), field('Attribution limit', 'Git metadata does not establish which person, assistant, or tool made or deployed each edit.')], evidence_url: `https://github.com/${target.repository}/commit/${commit.sha}`, evidence_ref: commit.sha }, now);
}
export function deploymentEvent(deployment, now) {
  if (!uuid.test(deployment?.id) || !date(deployment.created_on)) return null;
  const versions = (Array.isArray(deployment.versions) ? deployment.versions : []).filter(v => uuid.test(v.version_id) && Number.isFinite(v.percentage) && v.percentage >= 0 && v.percentage <= 100).map(v => `${v.version_id} (${v.percentage}%)`);
  return event({ id: `cloudflare:deployment:${deployment.id}`, occurred_at: date(deployment.created_on), source: 'cloudflare', actor: actor(deployment.author_email), actor_type: deployment.author_email ? 'provider' : 'unknown', action: 'worker_deployment', entity_type: 'deployment', entity_id: deployment.id, summary: 'TryBiomod Worker deployment recorded by Cloudflare.', status: 'observed', changes: [field('Deployment source', text(deployment.source)), field('Version traffic allocation', versions.join('\n')), field('Attribution limit', 'Cloudflare identifies the deploying account, not necessarily the person who authored each change.')], evidence_url: dashboard + '/deployments', evidence_ref: deployment.id }, now);
}
export function versionEvent(version, now) {
  if (!uuid.test(version?.id) || !date(version.metadata?.created_on)) return null;
  return event({ id: `cloudflare:version:${version.id}`, occurred_at: date(version.metadata.created_on), source: 'cloudflare', actor: actor(version.metadata.author_email), actor_type: version.metadata.author_email ? 'provider' : 'unknown', action: 'worker_version', entity_type: 'version', entity_id: version.id, summary: 'TryBiomod Worker version uploaded; upload alone does not confirm deployment.', status: 'observed', changes: [field('Version number', Number.isSafeInteger(version.number) ? version.number : null), field('Upload source', text(version.metadata.source))], evidence_url: dashboard + '/deployments', evidence_ref: version.id }, now);
}
export function checkEvent(check, commitSha, now) {
  if (!sha.test(commitSha) || !Number.isSafeInteger(check?.id) || !date(check.completed_at || check.started_at)) return null;
  const app = check.app?.slug;
  if (!['github-actions', 'cloudflare-workers-and-pages'].includes(app)) return null;
  if (app === 'cloudflare-workers-and-pages' && check.name !== `Workers Builds: ${target.worker}`) return null;
  const status = ['success', 'failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'action_required', 'stale'].includes(check.conclusion) ? check.conclusion : ['queued', 'in_progress', 'completed'].includes(check.status) ? check.status : 'unknown';
  const url = typeof check.details_url === 'string' && (check.details_url.startsWith(`https://github.com/${target.repository}/actions/`) || check.details_url.startsWith(dashboard + '/builds/')) ? check.details_url.split('?')[0] : `https://github.com/${target.repository}/commit/${commitSha}/checks`;
  return event({ id: `github:check:${check.id}:${status}`, occurred_at: date(check.completed_at || check.started_at), source: 'github', actor: app, actor_type: 'provider', action: 'build_check', entity_type: 'build', entity_id: String(check.id), summary: `${app === 'github-actions' ? 'GitHub release check' : 'Cloudflare build check'}: ${status}.`, status: status === 'failure' || status === 'timed_out' ? 'failed' : 'observed', changes: [field('Source commit', commitSha), field('Reported result', status), field('Meaning', 'This is the provider check result for this exact commit; it is not a customer workflow or delivery test.')], evidence_url: url, evidence_ref: `${commitSha}:${check.id}` }, now);
}
export function auditEvent(entry, now) {
  if (!uuid.test(entry?.id) || !date(entry.action?.time)) return null;
  const uri = typeof entry.raw?.uri === 'string' ? entry.raw.uri.split('?')[0] : '';
  const workerScoped = uri === workerBase || uri.startsWith(workerBase + '/');
  const databasePath = `${accountBase}/d1/database/${target.database}`;
  const databaseScoped = uri === databasePath || uri.startsWith(databasePath + '/');
  const zoneScoped = entry.zone?.name === 'trybiomod.com';
  if (!workerScoped && !databaseScoped && !zoneScoped) return null;
  // Query/raw/response bodies may contain credentials, SQL and customer records. Never store them.
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.raw?.method)) return null;
  const operation = ['create', 'update', 'delete'].includes(entry.action?.type) ? entry.action.type : 'change';
  const resource = workerScoped ? 'TryBiomod Worker' : databaseScoped ? 'TryBiomod database' : 'trybiomod.com zone';
  return event({ id: `cloudflare:audit:${entry.id}`, occurred_at: date(entry.action.time), source: 'cloudflare', actor: actor(entry.actor?.email), actor_type: entry.actor?.email ? 'provider' : 'unknown', action: 'platform_change', entity_type: 'platform', entity_id: workerScoped ? target.worker : databaseScoped ? target.database : 'trybiomod.com', summary: `${resource}: provider-recorded ${operation}.`, status: entry.action.result === 'success' ? 'observed' : 'failed', changes: [field('Operation', operation), field('Provider result', entry.action.result === 'success' ? 'success' : 'not successful'), field('Access context', ['api', 'api_key', 'api_token', 'dash', 'oauth', 'origin_ca_key'].includes(entry.actor?.context) ? entry.actor.context : 'Not reported'), field('Recorded detail', 'Only event metadata is retained. Configuration values, request bodies and customer records are excluded.')], evidence_url: `https://dash.cloudflare.com/${target.account}/audit-log`, evidence_ref: entry.id }, now);
}
export function insertStatement(item) {
  const columns = ['id','occurred_at','recorded_at','source','actor','actor_type','action','entity_type','entity_id','summary','status','changes','evidence_url','evidence_ref'];
  // A later checkout may know more paths for the same commit. Preserve the first
  // record and avoid even attempting an insert when its immutable ID already exists.
  return { sql: `INSERT INTO change_events (${columns.join(',')}) SELECT ${columns.map(() => '?').join(',')} WHERE NOT EXISTS (SELECT 1 FROM change_events WHERE id=?)`, params: [...columns.map(key => key === 'changes' ? JSON.stringify(item.changes) : item[key] ?? null), item.id] };
}
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
  } catch { state('cloudflare_audit', 'unavailable', 'Cloudflare account audit logs could not be read with the current login. Dashboard, DNS and direct platform settings changes are not fully covered. The Account Settings Read permission is required; no permissions were changed.'); }
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
