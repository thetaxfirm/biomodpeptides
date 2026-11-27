import { recordChange } from './change-history';
import { recentSourceRevisions, sourceFailureDescription } from './change-history-source';

const repository = 'thetaxfirm/biomodpeptides';
const HOUR = 3600000;
type Environment = { DB: D1Database; CF_VERSION_METADATA?: { id: string; timestamp?: string; tag?: string } };
const sync = (db: D1Database, source: string, now: number, state: string, description: string) => db.prepare(
  'INSERT INTO change_history_sync(source,synced_at,state,description) VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET synced_at=excluded.synced_at,state=excluded.state,description=excluded.description',
).bind(source, now, state, description).run();

/** Public source metadata and the executing Worker identity require no account-wide credentials.
 * Full deployment, build-check and account-audit history remain separately identified sources.
 */
export async function syncRuntimeHistory(env: Environment, now = Date.now(), request: typeof fetch = fetch) {
  const version = env.CF_VERSION_METADATA;
  if (version && /^[a-f0-9-]{32,36}$/i.test(version.id)) {
    await recordChange(env.DB, {
      id: 'cloudflare:runtime:' + version.id, occurredAt: now, source: 'cloudflare',
      actor: 'Running Worker', actorType: 'system', action: 'runtime_observed', entityType: 'runtime', entityId: version.id,
      summary: 'This Worker version executed the scheduled health check.', status: 'observed',
      changes: [{ field: 'Evidence limit', before: null, after: 'Confirms execution of this version; does not identify the deployer or establish traffic allocation.' }], evidenceRef: version.id,
    });
    await sync(env.DB, 'runtime', now, 'active', 'The running Worker reports its version automatically every five minutes. Full deployment and account histories are separate feeds.');
  }
  // Atomic lease prevents overlapping scheduled invocations and keeps the public GitHub request
  // comfortably below its unauthenticated rate limit. A failed read retries after fifteen minutes.
  const lease = await env.DB.prepare(`INSERT INTO change_history_sync(source,synced_at,state,description)
    VALUES('source_poll',?,'active','Scheduled source polling lease.')
    ON CONFLICT(source) DO UPDATE SET synced_at=excluded.synced_at
    WHERE change_history_sync.synced_at<=?`).bind(now, now - HOUR).run();
  if (!lease.meta.changes) return;
  let stage: 'read' | 'save' = 'read';
  try {
    const { revisions, detail } = await recentSourceRevisions(request);
    stage = 'save';
    // These are bounded observations, distinct from the richer importer events. Reusing the
    // importer's immutable ID would prevent it later recording author, changed paths and signatures.
    for (const { sha, timestamp } of revisions) {
      // Avoid copying commit messages, emails or raw provider payloads into operational history.
      await recordChange(env.DB, { id: 'github:observed-source:' + sha, occurredAt: timestamp, source: 'github', actor: 'GitHub main',
        actorType: 'provider', action: 'source_observed', entityType: 'source', entityId: sha,
        summary: 'Source revision recorded on main.', status: 'observed',
        changes: [{ field: 'Attribution limit', before: null, after: 'See the source record for author metadata; a source revision does not prove deployment.' }],
        evidenceUrl: `https://github.com/${repository}/commit/${sha}`, evidenceRef: sha,
      });
    }
    await sync(env.DB, 'github_recent', now, 'active', `${detail}: newest ${revisions.length} main revisions checked. Earlier imported history remains available; this feed does not refresh build checks or claim complete historical coverage.`);
  } catch (error) {
    const reason = stage === 'read' ? sourceFailureDescription(error) : 'Source history persistence failed';
    await sync(env.DB, 'github_recent', now, 'unavailable', `${reason}. Previously recorded revisions remain intact; retry is scheduled.`);
    await env.DB.prepare("UPDATE change_history_sync SET synced_at=? WHERE source='source_poll'").bind(now - 45 * 60000).run();
  }
}
