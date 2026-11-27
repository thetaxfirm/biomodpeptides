import { auditRun, withAuditDb, type AuditActor } from './change-history';

export class SettingsConflict extends Error {
    readonly status = 409;
    constructor() { super('These settings changed since you loaded them. Refresh administration and review the current values before saving.'); }
}
async function version(value: string | null) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value === null ? 'missing' : 'value:' + value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function settingsSnapshot(db: D1Database, key: string, expectedVersion?: unknown) {
    const row = await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{ value: string }>();
    const value = row?.value ?? null;
    const revision = await version(value);
    if (expectedVersion !== undefined && expectedVersion !== revision) throw new SettingsConflict();
    return { key, value, version: revision };
}
export async function saveSettingsSnapshot(db: D1Database, before: Awaited<ReturnType<typeof settingsSnapshot>>, next: unknown, actor: AuditActor) {
    const value = JSON.stringify(next);
    const result = before.value === null
        ? await auditRun(db, actor, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING', before.key, value)
        : await auditRun(db, actor, 'UPDATE settings SET value=? WHERE key=? AND value=?', value, before.key, before.value);
    if (!result.meta.changes) throw new SettingsConflict();
    return version(value);
}

/** All comparisons and writes share one transaction, including credentials that occupy separate rows. */
export async function saveRawSettingsSnapshots(db: D1Database, changes: { before: Awaited<ReturnType<typeof settingsSnapshot>>; value: string }[], actor: AuditActor) {
    const audited = withAuditDb(db, actor);
    const guards = changes.map(() => crypto.randomUUID());
    try {
        await audited.batch([
            ...changes.map(({ before }, i) => audited.prepare('INSERT INTO transaction_guards(id,valid) VALUES(?,CASE WHEN (SELECT value FROM settings WHERE key=?) IS ? THEN 1 ELSE 0 END)').bind(guards[i], before.key, before.value)),
            ...changes.map(({ before, value }) => audited.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(before.key, value)),
            ...guards.map(id => audited.prepare('DELETE FROM transaction_guards WHERE id=?').bind(id)),
        ]);
    } catch (error) {
        if (/valid_transaction|CHECK constraint|transaction_guards/i.test(String(error))) throw new SettingsConflict();
        throw error;
    }
    return Promise.all(changes.map(({ value }) => version(value)));
}
