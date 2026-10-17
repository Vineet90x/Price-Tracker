import { PLATFORM_ID, Provider, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RUNTIME_OPTIONS } from '../config/runtime-options';
import { NoopPriceFeed, PriceFeed } from './price-feed';
import { SimulatedPriceFeed } from './simulated-price-feed';
import { WebSocketPriceFeed } from './websocket-price-feed';

/**
 * Picks the price source once, at startup:
 * server prerender → no-op; ?feed=sim or ?scale=N → in-browser random walk; otherwise → backend WebSocket.
 */
export function providePriceFeed(): Provider {
  return {
    provide: PriceFeed,
    useFactory: (): PriceFeed => {
      if (!isPlatformBrowser(inject(PLATFORM_ID))) return new NoopPriceFeed();
      // `new` inside a factory still runs in an injection context, so the classes' inject() calls work.
      return inject(RUNTIME_OPTIONS).feed === 'sim' ? new SimulatedPriceFeed() : new WebSocketPriceFeed();
    },
  };
}
