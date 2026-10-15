import { withAuditDb } from './lib/change-history';
import { runCheckoutRecovery } from './lib/checkout-recovery';
import storefront from 'vinext/server/fetch-handler';
import { cleanupTraffic } from './lib/traffic-metrics-server';
import { type CoaEnvironment } from './lib/coa-outbox';
import { runScheduledCoaOutbox } from './lib/coa-scheduler';
import { runOverdueDigest } from './lib/reply-overdue';
import { runTrackingSweep } from './lib/tracking-sweep';
import { runAutoLabels } from './lib/auto-label';

type TrafficWorkerEnvironment = CoaEnvironment;

// Keep the framework's HTTP handler unchanged. Retention also runs without visits.
export default {
  ...storefront,
  async scheduled(controller: ScheduledController, env: TrafficWorkerEnvironment) {
    // Await the sweep so failure reaches the platform's scheduled-event status.
    // The helper records nonidentifying cleanup health without logging request data.
    if (controller.cron === '0 9 * * *') await cleanupTraffic(withAuditDb(env.DB, { source: 'system', actor: 'Traffic retention scheduler', actorType: 'system' }), Date.now());
    if (controller.cron === '*/5 * * * *') {
      // Each operation gets its own transactional attribution; never replace env.DB globally.
      const coaEnv = { ...env, DB: withAuditDb(env.DB, { source: 'system', actor: 'COA email scheduler', actorType: 'system' }) } as TrafficWorkerEnvironment;
      const digestEnv = { ...env, DB: withAuditDb(env.DB, { source: 'system', actor: 'Reply overdue digest', actorType: 'system' }) } as TrafficWorkerEnvironment;
      const recoveryEnv = { ...env, DB: withAuditDb(env.DB, { source: 'system', actor: 'Unpaid checkout recovery scheduler', actorType: 'system' }) } as TrafficWorkerEnvironment;
      // Carrier tracking fail-safe: the webhook is the fast path, this catches whatever it missed.
      const trackingEnv = { ...env, DB: withAuditDb(env.DB, { source: 'system', actor: 'Carrier tracking sweep', actorType: 'system' }) } as TrafficWorkerEnvironment;
      // Buys postage for paid orders after the grace period, and recovers purchases whose outcome was lost.
      const labelEnv = { ...env, DB: withAuditDb(env.DB, { source: 'system', actor: 'Automatic label purchase', actorType: 'system' }) } as TrafficWorkerEnvironment;
      const results=await Promise.allSettled([runScheduledCoaOutbox(coaEnv, controller.scheduledTime),runCheckoutRecovery(recoveryEnv),runOverdueDigest(digestEnv),runTrackingSweep(trackingEnv as never),runAutoLabels(labelEnv as never)]);
      if(results.some(result=>result.status==='rejected'))throw new Error('One or more scheduled correspondence tasks failed.');
    }
  },
};
