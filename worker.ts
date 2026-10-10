import storefront from 'vinext/server/fetch-handler';
import { cleanupTraffic } from './lib/traffic-metrics-server';

type TrafficWorkerEnvironment = { DB: D1Database };

// Keep the framework's HTTP handler unchanged. Retention also runs without visits.
export default {
  ...storefront,
  async scheduled(_controller: ScheduledController, env: TrafficWorkerEnvironment) {
    // Await the sweep so failure reaches the platform's scheduled-event status.
    // The helper records nonidentifying cleanup health without logging request data.
    await cleanupTraffic(env.DB, Date.now());
  },
};
