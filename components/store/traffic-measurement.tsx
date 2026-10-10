'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { TRAFFIC_ORIGIN } from '@/lib/traffic-metrics';
import { consumeTrafficNavigation, newTrafficNavigation, observeTrafficNavigation, trafficPageGroup, trafficPrivacyExcluded, type TrafficNavigation } from '@/lib/traffic-navigation';
import { useStore } from './provider';

// One document, not one component instance: remounts and StrictMode do not create events.
// No cookies, storage, identifiers, per-person history or network retry queue.
const documents = new WeakMap<Document, TrafficNavigation>();
export function TrafficMeasurement({ enabled, reviewedProductSlugs }: { enabled: boolean; reviewedProductSlugs: string[] }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { store, ready, loadError } = useStore();
  useEffect(() => {
    if (!pathname) return;
    let state = documents.get(document);
    if (!state) { state = newTrafficNavigation(); documents.set(document, state); }
    observeTrafficNavigation(state, pathname, search);
    if (!enabled || window.location.origin !== TRAFFIC_ORIGIN || !ready || loadError || store.admin || state.optedOut
      || trafficPrivacyExcluded(navigator as Navigator & { globalPrivacyControl?: boolean }, (window as Window & { doNotTrack?: string }).doNotTrack)) return;
    const pageGroup = trafficPageGroup(pathname, reviewedProductSlugs);
    if (!pageGroup || state.attempted) return;
    let frame = 0;
    let observer: MutationObserver | undefined;
    let active = true;
    const dispatch = () => {
      frame = 0;
      if (!active || document.visibilityState !== 'visible' || window.location.pathname !== pathname
        || document.querySelector('main[data-traffic-path]')?.getAttribute('data-traffic-path') !== pathname) return;
      // A query-only opt-out can arrive before the routing hook commits.
      observeTrafficNavigation(state!, pathname, window.location.search);
      if (trafficPrivacyExcluded(navigator as Navigator & { globalPrivacyControl?: boolean }, (window as Window & { doNotTrack?: string }).doNotTrack)) return;
      const payload = consumeTrafficNavigation(state!, pageGroup, document.referrer, TRAFFIC_ORIGIN);
      if (!payload) return;
      observer?.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      // Errors are deliberately silent so measurement can never interrupt shopping.
      void fetch('/api/metrics', {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }).catch(() => {});
    };
    const schedule = () => { if (active && !frame && document.visibilityState === 'visible') frame = window.requestAnimationFrame(dispatch); };
    // Wait for the successful route's marker, not a stale page or loading/error shell.
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-traffic-path'] });
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => { active = false; if (frame) window.cancelAnimationFrame(frame); observer?.disconnect(); document.removeEventListener('visibilitychange', schedule); };
  }, [enabled, pathname, search, reviewedProductSlugs, ready, loadError, store.admin]);
  return null;
}
