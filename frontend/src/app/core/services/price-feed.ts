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

/** Latency tracing: when a live tick passed each point (epoch ms). */
export interface TickTiming {
  /** When the exchange says the price happened (exchange clock) */
  exchange: number;
  /** When our backend received it (server clock) */
  serverIn: number;
  /** When our backend sent it to browsers (server clock) */
  serverOut: number;
  /** When this browser received it (browser clock) */
  received: number;
}

/** Browser clock vs server clock, measured with ping/pong (Cristian's algorithm). */
export interface ClockSync {
  /** Add this to a browser time to get server time (ms) */
  offset: number;
  /** Round trip of the ping used; the offset is accurate to about ± rtt / 2 */
  rtt: number;
}

/** Sent privately to a logged-in user when one of their server-side alerts fires. */
export interface FiredAlert {
  id: number;
  symbol: string;
  direction: 'above' | 'below';
  targetPrice: number;
  triggeredPrice: number;
  triggeredAt: Date;
}

export type FeedEvent =
  | { type: 'tick'; tick: PriceTick; timing?: TickTiming }
  | { type: 'snapshot'; snapshot: PriceSnapshot }
  | { type: 'alert'; alert: FiredAlert };

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
  /** Log the live connection in (token) or out (null), so it can deliver your private alerts. */
  abstract setAuthToken(token: string | null): void;
  /** Browser-vs-server clock difference (null until measured, or when there is no server). */
  abstract readonly clockSync: Signal<ClockSync | null>;
}

/** Used while prerendering on the server: no sockets, no timers. */
export class NoopPriceFeed extends PriceFeed {
  readonly events$ = NEVER;
  readonly status = signal<FeedStatus>('connecting').asReadonly();
  readonly clockSync = signal<ClockSync | null>(null).asReadonly();
  subscribe(): void {}
  setAuthToken(): void {}
}
