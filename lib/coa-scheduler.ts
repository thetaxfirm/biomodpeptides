import { processCoaOutbox, readCoaConfig, type CoaEnvironment } from './coa-outbox';
import { coaSender } from './coa-delivery';

export const COA_SCHEDULER_HEALTH_KEY = 'coa_scheduler_health_v1';
export type CoaSchedulerHealth = {
  version: 1;
  runId: string;
  scheduledAt: number | null;
  startedAt: number;
  completedAt: number | null;
  status: 'running' | 'completed' | 'failed';
  phase: 'starting' | 'readiness' | 'processing' | 'completion';
  enabled: boolean | null;
  mailConfigured: boolean | null;
  processed: number | null;
  accepted: number | null;
  review: number | null;
};
type Dependencies = { now?: () => number; uuid?: () => string };

/** One nonidentifying health record for the latest scheduled run. No original reports are read here. */
export async function runScheduledCoaOutbox(env: CoaEnvironment, scheduledAt: number, deps: Dependencies = {}) {
  const now = deps.now || Date.now;
  const health: CoaSchedulerHealth = {
    version: 1, runId: (deps.uuid || (() => crypto.randomUUID()))(),
    scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : null,
    startedAt: now(), completedAt: null, status: 'running', phase: 'starting',
    enabled: null, mailConfigured: null, processed: null, accepted: null, review: null,
  };
  const update = () => env.DB.prepare(
    "UPDATE settings SET value=? WHERE key=? AND json_valid(value) AND json_extract(value,'$.runId')=?",
  ).bind(JSON.stringify(health), COA_SCHEDULER_HEALTH_KEY, health.runId).run();
  try {
    // A delayed older start cannot replace a newer run; only the owning run may update it.
    await env.DB.prepare(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CASE WHEN json_valid(settings.value) THEN COALESCE(json_extract(settings.value,'$.startedAt'),0) ELSE 0 END<=?",
    ).bind(COA_SCHEDULER_HEALTH_KEY, JSON.stringify(health), health.startedAt).run();
    health.phase = 'readiness';
    const config = await readCoaConfig(env);
    health.enabled = config.enabled;
    health.mailConfigured = Boolean(env.RESEND_API_KEY?.trim() && coaSender(env.COA_EMAIL_FROM || env.ORDER_EMAIL_FROM || 'BIOMOD <no-reply@trybiomod.com>'));
    health.phase = 'processing';
    await update();
    const result = await processCoaOutbox(env, { limit: 5 });
    // Copy only bounded aggregate counters, never any job, recipient, provider or report fields.
    health.processed = result.processed;
    health.accepted = result.accepted;
    health.review = result.review;
    health.phase = 'completion';
    health.completedAt = now();
    health.status = 'completed';
    await update();
    return result;
  } catch {
    health.status = 'failed';
    health.completedAt = now();
    try { await update(); } catch { /* Database failure remains visible as a failed platform event. */ }
    // Do not put a raw database/provider exception or its cause into platform logs.
    throw new Error('COA scheduled processing failed.');
  }
}
