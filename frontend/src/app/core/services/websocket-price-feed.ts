import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { Observable, concatWith, filter, map, retry, share, tap, throwError, timer } from 'rxjs';
import { WebSocketSubject, webSocket } from 'rxjs/webSocket';
import { ClockSync, FeedEvent, FeedStatus, PriceFeed, PriceSnapshot, PriceTick } from './price-feed';

interface AlertMessage {
  type: 'alert';
  id: number;
  symbol: string;
  direction: 'above' | 'below';
  target_price: number;
  triggered_price: number;
  triggered_at: string;
}
type ServerMessage =
  | ({ type: 'tick'; rx?: number; tx?: number } & PriceTick)
  | { type: 'pong'; t0: number; server: number }
  | ({ type: 'snapshot' } & PriceSnapshot)
  | AlertMessage
  | { type: 'auth_result'; ok: boolean };
type ClientMessage =
  | { type: 'subscribe' | 'unsubscribe'; symbols: string[] }
  | { type: 'auth'; token: string | null }
  | { type: 'ping'; t0: number };
type DataMessage = Exclude<ServerMessage, { type: 'auth_result' } | { type: 'pong' }>;

/** How often to re-measure the clock difference, and how many measurements to keep */
const CLOCK_SYNC_EVERY_MS = 10_000;
const CLOCK_SAMPLES = 5;

/** Reconnect delay: 1 s, 2 s, 4 s, 8 s … capped at 30 s, plus up to 20 % random jitter so that
 *  thousands of clients dropped by the same server restart don't all reconnect at the same instant. */
export function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 30_000);
  return base + Math.random() * base * 0.2;
}

/** Live prices from our FastAPI backend (/api/ws/prices), with automatic reconnect. */
@Injectable()
export class WebSocketPriceFeed extends PriceFeed {
  private readonly _status = signal<FeedStatus>('connecting');
  readonly status = this._status.asReadonly();

  /** Everything the app wants. Re-sent on every (re)connect: a new socket starts with no subscriptions. */
  private readonly wanted = new Set<string>();
  /** Current access token (null = logged out). Also re-sent on every reconnect. */
  private token: string | null = null;

  private readonly _clockSync = signal<ClockSync | null>(null);
  readonly clockSync = this._clockSync.asReadonly();
  private clockSamples: ClockSync[] = [];
  private pingTimer?: ReturnType<typeof setInterval>;

  private readonly socket: WebSocketSubject<ServerMessage | ClientMessage>;
  readonly events$: Observable<FeedEvent>;

  constructor() {
    super();
    const { protocol, host } = inject(DOCUMENT).location;
    this.socket = webSocket<ServerMessage | ClientMessage>({
      // Same origin as the page: the dev proxy / nginx forwards /api to the backend.
      url: `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/ws/prices`,
      openObserver: {
        next: () => {
          this._status.set('live');
          this.send('subscribe', [...this.wanted]);
          if (this.token) this.socket.next({ type: 'auth', token: this.token });
          this.ping();
          this.pingTimer = setInterval(() => this.ping(), CLOCK_SYNC_EVERY_MS);
        },
      },
      closeObserver: {
        next: () => {
          this._status.set('reconnecting');
          clearInterval(this.pingTimer);
        },
      },
    });

    this.events$ = this.socket.pipe(
      // A clean close (e.g. backend shutting down) COMPLETES the stream instead of erroring.
      // Turning completion into an error lets one retry() handle both cases.
      concatWith(throwError(() => new Error('socket closed'))),
      retry({ delay: (_error, attempt) => timer(backoffMs(attempt)), resetOnSuccess: true }),
      tap((msg) => {
        if (msg.type === 'pong') this.onPong(msg.t0, msg.server);
      }),
      filter(
        (msg): msg is DataMessage =>
          msg.type === 'tick' || msg.type === 'snapshot' || msg.type === 'alert',
      ),
      map((msg) => toFeedEvent(msg, Date.now())), // stamp arrival time as early as possible
      share(),
    );
  }

  subscribe(symbols: readonly string[]): void {
    const fresh = symbols.filter((s) => !this.wanted.has(s));
    fresh.forEach((s) => this.wanted.add(s));
    // While disconnected we only remember them; openObserver sends the full set on reconnect.
    if (this._status() === 'live') this.send('subscribe', fresh);
  }

  setAuthToken(token: string | null): void {
    if (token === this.token) return;
    this.token = token;
    // Not connected right now? openObserver sends it on (re)connect.
    if (this._status() === 'live') this.socket.next({ type: 'auth', token });
  }

  /**
   * Cristian's algorithm: send our time t0; the server answers with its time; we receive it at t1.
   * The server read its clock roughly halfway through the round trip, so
   *   offset = server − (t0 + t1) / 2      (accurate to about ± (t1 − t0) / 2).
   * Keep the sample with the smallest round trip: least network noise.
   */
  private onPong(t0: number, server: number): void {
    const t1 = Date.now();
    const sample = { offset: server - (t0 + t1) / 2, rtt: t1 - t0 };
    this.clockSamples = [...this.clockSamples, sample].slice(-CLOCK_SAMPLES);
    this._clockSync.set(this.clockSamples.reduce((best, s) => (s.rtt < best.rtt ? s : best)));
  }

  private ping(): void {
    this.socket.next({ type: 'ping', t0: Date.now() });
  }

  private send(type: 'subscribe' | 'unsubscribe', symbols: string[]): void {
    if (symbols.length > 0) this.socket.next({ type, symbols });
  }
}

function toFeedEvent(msg: DataMessage, received: number): FeedEvent {
  if (msg.type === 'alert') {
    return {
      type: 'alert',
      alert: {
        id: msg.id,
        symbol: msg.symbol,
        direction: msg.direction,
        targetPrice: msg.target_price,
        triggeredPrice: msg.triggered_price,
        triggeredAt: new Date(msg.triggered_at),
      },
    };
  }
  const tick: PriceTick = { symbol: msg.symbol, price: msg.price, open: msg.open, ts: msg.ts };
  if (msg.type === 'snapshot') return { type: 'snapshot', snapshot: { ...tick, history: msg.history } };
  const timing =
    msg.rx !== undefined && msg.tx !== undefined
      ? { exchange: msg.ts, serverIn: msg.rx, serverOut: msg.tx, received }
      : undefined;
  return { type: 'tick', tick, timing };
}
