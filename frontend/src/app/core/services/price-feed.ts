import { Signal, signal } from '@angular/core';
import { NEVER, Observable } from 'rxjs';

/** One price update. ts = epoch milliseconds. open = session open (Binance 24 h open, or base price). */
export interface PriceTick {
  symbol: string;
  price: number;
  open: number;
  ts: number;
}

/** Sent once per symbol on subscribe: the latest tick plus recent history for the chart. */
export interface PriceSnapshot extends PriceTick {
  history: [ts: number, price: number][];
}

export type FeedEvent =
  | { type: 'tick'; tick: PriceTick }
  | { type: 'snapshot'; snapshot: PriceSnapshot };

export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'simulated';

/**
 * Where prices come from. PriceService depends on this abstraction only, so switching
 * from the fake random walk (Phase 1) to the real WebSocket (Phase 2) changes no component.
 * An abstract class (not an interface) because it doubles as the DI token.
 */
export abstract class PriceFeed {
  abstract readonly events$: Observable<FeedEvent>;
  abstract readonly status: Signal<FeedStatus>;
  /** Start receiving these symbols. Idempotent: already-subscribed symbols are ignored. */
  abstract subscribe(symbols: readonly string[]): void;
}

/** Used while prerendering on the server: no sockets, no timers. */
export class NoopPriceFeed extends PriceFeed {
  readonly events$ = NEVER;
  readonly status = signal<FeedStatus>('connecting').asReadonly();
  subscribe(): void {}
}
