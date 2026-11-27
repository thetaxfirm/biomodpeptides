// Pure provider evidence transformations shared by the CLI importer and scheduled Worker.
// Never import provider bodies, configuration values or credentials.
export const target = Object.freeze({ account: '99aaaddf04e12ed1467d146bb2467455', worker: 'biomod-peptides', database: '877af242-59d4-4122-a1ff-50fcf02a54dc', repository: 'thetaxfirm/biomodpeptides' });
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
