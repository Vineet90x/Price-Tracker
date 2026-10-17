import { TestBed } from '@angular/core/testing';
import { FeedEvent } from './price-feed';
import { WebSocketPriceFeed, backoffMs } from './websocket-price-feed';

/** Stands in for the browser WebSocket so the test controls open / message / close. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  sent: unknown[] = [];
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  // ── test helpers ──
  serverOpens(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  serverSends(msg: object): void {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }
  serverCloses(): void {
    this.readyState = 3;
    this.onclose?.({ wasClean: true, code: 1012, reason: 'restart' } as CloseEvent);
  }
}

describe('WebSocketPriceFeed', () => {
  const realWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeSocket.instances = [];
    (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
  });
  afterEach(() => {
    globalThis.WebSocket = realWebSocket;
  });

  it('backoff doubles from 1 s and caps at 30 s (+ ≤20 % jitter)', () => {
    expect(backoffMs(1)).toBeGreaterThanOrEqual(1000);
    expect(backoffMs(1)).toBeLessThanOrEqual(1200);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(4000);
    expect(backoffMs(20)).toBeLessThanOrEqual(36_000);
  });

  it('subscribes on open, reconnects after a server restart, and re-subscribes everything', async () => {
    const feed = TestBed.runInInjectionContext(() => new WebSocketPriceFeed());
    const events: FeedEvent[] = [];
    feed.subscribe(['BTC']);
    const sub = feed.events$.subscribe((e) => events.push(e));

    // 1. First connection
    const first = FakeSocket.instances[0];
    expect(first.url).toMatch(/\/api\/ws\/prices$/);
    expect(feed.status()).toBe('connecting');
    first.serverOpens();
    expect(feed.status()).toBe('live');
    expect(first.sent).toEqual([{ type: 'subscribe', symbols: ['BTC'] }]);

    first.serverSends({ type: 'tick', symbol: 'BTC', price: 1, open: 1, ts: 1 });
    expect(events).toEqual([{ type: 'tick', tick: { symbol: 'BTC', price: 1, open: 1, ts: 1 } }]);

    // 2. Server restarts (clean close): status flips, a symbol added meanwhile is only remembered
    first.serverCloses();
    expect(feed.status()).toBe('reconnecting');
    feed.subscribe(['ETH']);
    expect(first.sent).toHaveLength(1);

    // 3. After the backoff (~1 s) a new socket is opened and gets the FULL subscription list
    await new Promise((resolve) => setTimeout(resolve, 1400));
    const second = FakeSocket.instances[1];
    expect(second).toBeDefined();
    second.serverOpens();
    expect(feed.status()).toBe('live');
    expect(second.sent).toEqual([{ type: 'subscribe', symbols: ['BTC', 'ETH'] }]);

    sub.unsubscribe();
  });
});
