import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { auditEvent, checkEvent, collectHistory, commitEvent, deploymentEvent, insertStatement, safeFiles, target, versionEvent } from '../scripts/change-history-import-v1.mjs';

const now = Date.parse('2026-10-12T21:00:00Z');
const hash = 'a'.repeat(40), id = 'f'.repeat(32);
const commit = { sha: hash, author: { login: 'contributor' }, commit: { author: { name: 'Contributor' }, committer: { name: 'Committer', date: '2026-10-12T20:00:00Z' }, message: 'Do not import customer@example.test or password=hidden', verification: { verified: false } } };
const source = commitEvent(commit, ['lib/catalog.ts', 'components/store/admin.tsx', '.env.production', 'private/customer.json', 'lib/credentials.ts'], now);
assert.equal(source.actor_type, 'git');
assert.equal(source.actor, 'Contributor');
assert.equal(source.status, 'observed');
assert.equal(source.occurred_at, Date.parse('2026-10-12T20:00:00Z'));
assert.match(source.summary, /products or pricing/);
assert.doesNotMatch(JSON.stringify(source), /customer@|password|\.env|credentials/);
assert.equal(source.evidence_url, `https://github.com/${target.repository}/commit/${hash}`);
assert.deepEqual(safeFiles(['lib/x.ts', 'lib/x.ts', 'lib/secret.ts', 'lib/bad\nname.ts']), ['lib/x.ts']);
assert.equal(commitEvent({ ...commit, sha: "x'); DROP TABLE x" }, [], now), null);

const deployment = deploymentEvent({ id, created_on: '2026-10-12T20:01:00Z', author_email: 'operator@example.test', source: 'wrangler', versions: [{ version_id: id, percentage: 100 }], annotations: { 'private': 'Do not copy me' } }, now);
assert.equal(deployment.actor_type, 'provider');
assert.doesNotMatch(JSON.stringify(deployment), /Do not copy/);
assert.equal(versionEvent({ id, number: 7, metadata: { created_on: '2026-10-12T20:00:50Z', source: 'wrangler', author_email: 'operator@example.test' }, resources: { bindings: [{ secret: 'NOT-FOR-HISTORY' }] } }, now).action, 'worker_version');

const base = `/accounts/${target.account}/workers/scripts/${target.worker}`;
const audit = { id, action: { time: '2026-10-12T20:02:00Z', type: 'update', result: 'success', description: 'private@example.test' }, actor: { email: 'operator@example.test', context: 'dash', ip_address: '192.0.2.1', token_name: 'PRIVATE' }, raw: { method: 'PATCH', uri: `${base}/settings?secret=private` }, resource: { request: { secret: 'PRIVATE', customer: 'PRIVATE' }, response: { message: 'PRIVATE' } } };
const entry = auditEvent(audit, now);
assert.equal(entry.actor_type, 'provider');
assert.doesNotMatch(JSON.stringify(entry), /PRIVATE|192\.0\.2|private@|secret=/);
assert.equal(auditEvent({ ...audit, raw: { ...audit.raw, uri: base + '-other/settings' } }, now), null);
assert.equal(auditEvent({ ...audit, raw: { ...audit.raw, method: 'GET' } }, now), null);
assert.equal(auditEvent({ ...audit, raw: { ...audit.raw, uri: '/unrelated' }, zone: { name: 'biomodpro.com' } }, now), null);
assert.equal(auditEvent({ ...audit, raw: { ...audit.raw, uri: '/zone-resource' }, zone: { name: 'trybiomod.com' } }, now).entity_id, 'trybiomod.com');

const check = { id: 123, app: { slug: 'cloudflare-workers-and-pages' }, name: `Workers Builds: ${target.worker}`, completed_at: '2026-10-12T20:05:00Z', conclusion: 'success', details_url: 'https://example.test/?secret=NO', output: { text: 'customer detail' } };
const built = checkEvent(check, hash, now);
assert.match(built.evidence_url, /^https:\/\/github\.com\//);
assert.equal(built.actor, 'cloudflare-workers-and-pages');
assert.doesNotMatch(JSON.stringify(built), /secret=NO|customer detail/);
assert.equal(checkEvent({ ...check, name: 'Workers Builds: other-worker' }, hash, now), null);

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE change_events (id TEXT PRIMARY KEY, occurred_at INTEGER, recorded_at INTEGER, source TEXT, actor TEXT, actor_type TEXT, action TEXT, entity_type TEXT, entity_id TEXT, summary TEXT, status TEXT, changes TEXT, evidence_url TEXT, evidence_ref TEXT)');
for (const part of readFileSync(new URL('../drizzle/0020_change_history.sql', import.meta.url), 'utf8').split('--> statement-breakpoint')) if (/CREATE TRIGGER IF NOT EXISTS change_events_no_(update|delete|replace)/.test(part)) db.exec(part);
const escaped = { ...source, actor: "D'Angelo", summary: "quote ' does not execute SQL" };
const statement = insertStatement(escaped);
assert.equal(db.prepare(statement.sql).run(...statement.params).changes, 1);
assert.equal(db.prepare(statement.sql).run(...statement.params).changes, 0);
assert.equal(db.prepare('SELECT actor FROM change_events').get().actor, "D'Angelo");
const later = insertStatement({ ...escaped, actor: 'Different metadata', recorded_at: now + 10000, changes: [ { field: 'Newly available source path', before: null, after: 'lib/catalog.ts' } ] });
assert.equal(db.prepare(later.sql).run(...later.params).changes, 0, 'Later evidence for an existing ID preserves the first record without hitting the immutable collision guard');
assert.equal(db.prepare('SELECT actor FROM change_events').get().actor, "D'Angelo");
assert.throws(() => db.prepare("UPDATE change_events SET actor='changed'").run(), /append-only/);
assert.throws(() => db.prepare("DELETE FROM change_events").run(), /append-only/);
assert.throws(() => db.prepare("INSERT OR REPLACE INTO change_events SELECT id,occurred_at,recorded_at,source,'changed',actor_type,action,entity_type,entity_id,summary,status,changes,evidence_url,evidence_ref FROM change_events").run(), /append-only/);

let pages = 0;
const report = await collectHistory({ now, filePaths: () => ['lib/catalog.ts'], gh: path => path.includes('check-runs') ? { check_runs: [check] } : [commit], cf: async path => {
  if (path.includes('/logs/audit')) throw new Error('403 must become unavailable, not zero');
  if (path.includes('/deployments')) { pages++; return { result: { deployments: [{ id, created_on: '2026-10-12T20:01:00Z', source: 'wrangler' }] }, result_info: { total_count: 1 } }; }
  return { result: { items: [] }, result_info: { total_count: 0 } };
} });
assert.equal(pages, 1);
assert.equal(report.events.length, 3);
assert.equal(report.sync.find(s => s.source === 'cloudflare_audit').state, 'unavailable');
assert.equal(report.sync.find(s => s.source === 'github').state, 'active');
assert.equal(report.sync.find(s => s.source === 'vercel').state, 'unavailable');
assert.match(report.sync.find(s => s.source === 'github').description, /self-reported/);
assert.ok(report.sync.every(s => s.synced_at === now));
console.log('change-history-import-v1: idempotent imports, attribution, resource boundaries, privacy allowlist, evidence URLs, and coverage gaps passed.');
