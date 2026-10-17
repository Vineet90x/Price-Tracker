import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { Observable, concatWith, filter, map, retry, share, throwError, timer } from 'rxjs';
import { WebSocketSubject, webSocket } from 'rxjs/webSocket';
import { FeedEvent, FeedStatus, PriceFeed, PriceSnapshot, PriceTick } from './price-feed';

type ServerMessage = ({ type: 'tick' } & PriceTick) | ({ type: 'snapshot' } & PriceSnapshot);
type ClientMessage = { type: 'subscribe' | 'unsubscribe'; symbols: string[] };

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
        },
      },
      closeObserver: { next: () => this._status.set('reconnecting') },
    });

    this.events$ = this.socket.pipe(
      // A clean close (e.g. backend shutting down) COMPLETES the stream instead of erroring.
      // Turning completion into an error lets one retry() handle both cases.
      concatWith(throwError(() => new Error('socket closed'))),
      retry({ delay: (_error, attempt) => timer(backoffMs(attempt)), resetOnSuccess: true }),
      filter((msg): msg is ServerMessage => msg.type === 'tick' || msg.type === 'snapshot'),
      map(toFeedEvent),
      share(),
    );
  }

  subscribe(symbols: readonly string[]): void {
    const fresh = symbols.filter((s) => !this.wanted.has(s));
    fresh.forEach((s) => this.wanted.add(s));
    // While disconnected we only remember them; openObserver sends the full set on reconnect.
    if (this._status() === 'live') this.send('subscribe', fresh);
  }

  private send(type: ClientMessage['type'], symbols: string[]): void {
    if (symbols.length > 0) this.socket.next({ type, symbols });
  }
}

function toFeedEvent(msg: ServerMessage): FeedEvent {
  const tick: PriceTick = { symbol: msg.symbol, price: msg.price, open: msg.open, ts: msg.ts };
  return msg.type === 'snapshot'
    ? { type: 'snapshot', snapshot: { ...tick, history: msg.history } }
    : { type: 'tick', tick };
}
