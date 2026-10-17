import { withAuditDb } from './lib/change-history';
import { runCheckoutRecovery } from './lib/checkout-recovery';
import { runCheckoutExpiry } from './lib/checkout-expiry';
import storefront from 'vinext/server/fetch-handler';
import { cleanupTraffic } from './lib/traffic-metrics-server';
import { type CoaEnvironment } from './lib/coa-outbox';
import { runScheduledCoaOutbox } from './lib/coa-scheduler';
import { runOverdueDigest } from './lib/reply-overdue';
import { runTrackingSweep } from './lib/tracking-sweep';
import { runAutoLabels } from './lib/auto-label';
import { runParcelAlerts } from './lib/parcel-alerts';
import { keepRequestAlive } from './lib/request-lifetime';

type TrafficWorkerEnvironment = CoaEnvironment;

// The framework's HTTP handler, kept alive until each render settles (see lib/request-lifetime.ts).
// Retention also runs without visits.
export default {
  ...storefront,
  fetch: keepRequestAlive(storefront.fetch.bind(storefront)),
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
      // Releases checkouts that were never paid, so their stock goes back on sale and their owner
      // is not locked out of ordering. Only ever acts on a provider-verified absence of payment.
      const expiryEnv = { ...env, DB: withAuditDb(env.DB, { source: 'system', actor: 'Unpaid checkout release', actorType: 'system' }) } as TrafficWorkerEnvironment;
      // Once a day: one internal email naming parcels the carrier has not scanned, stuck ones and returns.
      const parcelEnv = { ...env, DB: withAuditDb(env.DB, { source: 'system', actor: 'Parcel alert digest', actorType: 'system' }) } as TrafficWorkerEnvironment;
      const results=await Promise.allSettled([runScheduledCoaOutbox(coaEnv, controller.scheduledTime),runCheckoutRecovery(recoveryEnv),runOverdueDigest(digestEnv),runTrackingSweep(trackingEnv as never),runAutoLabels(labelEnv as never),runCheckoutExpiry(expiryEnv as never),runParcelAlerts(parcelEnv as never)]);
      if(results.some(result=>result.status==='rejected'))throw new Error('One or more scheduled correspondence tasks failed.');
    }
  },
};
