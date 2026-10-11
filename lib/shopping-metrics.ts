// Fixed aggregate stages only. No catalog, customer, storage or server imports.
import { trafficConfiguration, type TrafficConfiguration, type TrafficCleanupHealth } from './traffic-metrics';

export const SHOPPING_STAGES = [
  'cart_add_confirmed', 'cart_view', 'checkout_signin_view', 'checkout_form_view',
  'delivery_quote_confirmed', 'checkout_handoff_ready',
] as const;
export const SHOPPING_DAILY_CAP = 50000;
export const SHOPPING_RETENTION_DAYS = 90;
export type ShoppingStage = typeof SHOPPING_STAGES[number];
export type ShoppingEvent = { event: ShoppingStage };
export type ShoppingFlags = Record<string, unknown> & { SHOPPING_MEASUREMENT_ENABLED?: string; SHOPPING_MEASUREMENT_STARTED_AT?: string };
export type ShoppingStageCount = { stage: ShoppingStage; events: number };
export type ShoppingDay = { date: string; events: number; capReached: boolean; byStage: ShoppingStageCount[] };
export type ShoppingReport = {
  asOf: string; status: 'available' | 'unavailable'; configuration: TrafficConfiguration;
  window: { requestedDays: 7 | 30 | 90; timeZone: 'UTC'; start: string; endExclusive: string; retainedFrom: string };
  completedDays: ShoppingDay[]; activationDayPartial: ShoppingDay | null; partialToday: ShoppingDay | null;
  totals: { events: number | null; byStage: ShoppingStageCount[] };
  cap: { dailyLimit: number; daysReached: string[] }; cleanup: TrafficCleanupHealth; limitations: string[];
};
export function validShoppingEvent(value: unknown): value is ShoppingEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && Object.prototype.hasOwnProperty.call(record, 'event')
    && SHOPPING_STAGES.includes(record.event as ShoppingStage);
}
export function shoppingConfiguration(env: ShoppingFlags, now = Date.now()): TrafficConfiguration {
  // Use the same strict UTC validation, with an independent flag and activation time.
  return trafficConfiguration({ TRAFFIC_MEASUREMENT_ENABLED: env.SHOPPING_MEASUREMENT_ENABLED,
    TRAFFIC_MEASUREMENT_STARTED_AT: env.SHOPPING_MEASUREMENT_STARTED_AT }, now);
}
