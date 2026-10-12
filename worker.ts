import { runCheckoutRecovery } from './lib/checkout-recovery';
import storefront from 'vinext/server/fetch-handler';
import { cleanupTraffic } from './lib/traffic-metrics-server';
import { type CoaEnvironment } from './lib/coa-outbox';
import { runScheduledCoaOutbox } from './lib/coa-scheduler';

type TrafficWorkerEnvironment = CoaEnvironment;

// Keep the framework's HTTP handler unchanged. Retention also runs without visits.
export default {
  ...storefront,
  async scheduled(controller: ScheduledController, env: TrafficWorkerEnvironment) {
    // Await the sweep so failure reaches the platform's scheduled-event status.
    // The helper records nonidentifying cleanup health without logging request data.
    if (controller.cron === '0 9 * * *') await cleanupTraffic(env.DB, Date.now());
    if (controller.cron === '*/5 * * * *') {
      const results=await Promise.allSettled([runScheduledCoaOutbox(env, controller.scheduledTime),runCheckoutRecovery(env)]);
      if(results.some(result=>result.status==='rejected'))throw new Error('One or more scheduled correspondence tasks failed.');
    }
  },
};
