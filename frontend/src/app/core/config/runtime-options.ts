import { InjectionToken, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Switches read once from the URL at startup, e.g.
 *   /watchlist?feed=sim            → in-browser random walk, no backend needed
 *   /watchlist?scale=200           → 200 extra fake symbols (Phase 1 Step 7), implies feed=sim
 *   /watchlist?scale=200&virtual=0 → same, but render every row (to compare with virtual scroll)
 */
export interface RuntimeOptions {
  feed: 'live' | 'sim';
  scaleTest: number;
  virtualScroll: boolean;
}

const DEFAULTS: RuntimeOptions = { feed: 'live', scaleTest: 0, virtualScroll: true };

export const RUNTIME_OPTIONS = new InjectionToken<RuntimeOptions>('RUNTIME_OPTIONS', {
  providedIn: 'root',
  factory: () => {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return DEFAULTS; // prerender has no real URL
    const params = new URLSearchParams(window.location.search);
    const scaleTest = Math.min(Math.max(Math.trunc(Number(params.get('scale')) || 0), 0), 1000);
    return {
      feed: params.get('feed') === 'sim' || scaleTest > 0 ? 'sim' : 'live',
      scaleTest,
      virtualScroll: params.get('virtual') !== '0',
    };
  },
});
