import type { Product } from './catalog';
import { eligibleDiscovery } from './product-discovery';
import { SHOPPING_STAGES, type ShoppingStage } from './shopping-metrics';
import { TRAFFIC_ORIGIN } from './traffic-metrics';
import { documentTrafficNavigation, trafficPrivacyExcluded } from './traffic-navigation';

type ShoppingLine = { id: number; quantity: number; presaleId?: string };
export type ShoppingMeasurementContext = {
  ready: boolean; loadError: string;
  store: { products: Product[]; cart: ShoppingLine[]; cartConflict: unknown; cartError: string;
    admin: boolean; customer: { id: string } | null; authReady: boolean; payment: { state: string; enabled: boolean } };
};
export type ShoppingMeasurementOptions = { cart?: ShoppingLine[]; oncePerNavigation?: boolean };
export type MeasureShopping = (stage: ShoppingStage, options?: ShoppingMeasurementOptions) => void;
const viewPaths: Partial<Record<ShoppingStage, string>> = {
  cart_view: '/cart', checkout_signin_view: '/checkout', checkout_form_view: '/checkout',
};
export function shoppingContextEligible(context: ShoppingMeasurementContext, cart = context.store.cart): boolean {
  const { store } = context;
  return context.ready && !context.loadError && !store.admin && !store.cartConflict && !store.cartError
    && store.payment.enabled && store.payment.state === 'live' && cart.length > 0
    && cart.every(line => Number.isSafeInteger(line.quantity) && line.quantity > 0 && !line.presaleId
      && store.products.some(product => product.id === line.id && eligibleDiscovery(product)));
}
export function measureShoppingStage(enabled: boolean, context: ShoppingMeasurementContext, stage: ShoppingStage, options: ShoppingMeasurementOptions = {}): void {
  // A collector must never throw into a cart or checkout operation.
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const navigation = documentTrafficNavigation(document, window.location.pathname, window.location.search);
    if (!enabled || !SHOPPING_STAGES.includes(stage) || navigation.optedOut
      || window.location.origin !== TRAFFIC_ORIGIN || document.visibilityState !== 'visible'
      || trafficPrivacyExcluded(navigator as Navigator & { globalPrivacyControl?: boolean }, (window as Window & { doNotTrack?: string }).doNotTrack)
      || !shoppingContextEligible(context, options.cart)) return;
    if (stage === 'checkout_signin_view' && (context.store.customer || !context.store.authReady)) return;
    if (['checkout_form_view', 'delivery_quote_confirmed', 'checkout_handoff_ready'].includes(stage) && !context.store.customer) return;
    const viewPath = viewPaths[stage] || (stage === 'delivery_quote_confirmed' || stage === 'checkout_handoff_ready' ? '/checkout' : undefined);
    if (viewPath && (window.location.pathname !== viewPath
      || document.querySelector('main[data-traffic-path]')?.getAttribute('data-traffic-path') !== viewPath)) return;
    if (options.oncePerNavigation) {
      if (navigation.shoppingAttempted.has(stage)) return;
      navigation.shoppingAttempted.add(stage); // No retries, including failed requests.
    }
    // Fixed stage only: no products, customers, orders, prices, codes, URLs or IDs.
    void fetch('/api/metrics', { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
      cache: 'no-store', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: stage }),
    }).catch(() => {});
  } catch { /* Measurement failure must not affect shopping. */ }
}
export function watchShoppingView(stage: ShoppingStage, measure: MeasureShopping): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !viewPaths[stage]) return () => {};
  let active = true, frame = 0;
  const dispatch = () => { frame = 0; if (active) measure(stage, { oncePerNavigation: true }); };
  const schedule = () => { if (active && !frame && document.visibilityState === 'visible') frame = window.requestAnimationFrame(dispatch); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-traffic-path'] });
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return () => { active = false; if (frame) window.cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', schedule); };
}
export function validShoppingQuote(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const quote = value as Record<string, unknown>;
  return typeof quote.quoteId === 'string' && quote.quoteId.length > 0 && quote.quoteId.length <= 200
    && ['total', 'shipping', 'tax'].every(key => Number.isSafeInteger(quote[key]) && Number(quote[key]) >= 0);
}
export function validShoppingHandoff(value: unknown): boolean {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 2048 || value.startsWith('//')) return false;
  try {
    if (!value.startsWith('/') && !/^https:\/\//i.test(value)) return false;
    const url = new URL(value, TRAFFIC_ORIGIN);
    // The successful checkout response is authoritative: Chase validates its
    // configured hosted origin server-side; Authorize.net uses our own pay route.
    // This event does not confirm that the hosted form rendered or payment occurred.
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port
      && (url.origin !== TRAFFIC_ORIGIN || url.pathname === '/api/store/pay');
  } catch { return false; }
}
