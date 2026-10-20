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
  /** Everything sent except clock-sync pings (sent automatically on open) */
  nonPing(): unknown[] {
    return this.sent.filter((m) => (m as { type: string }).type !== 'ping');
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
    expect(first.nonPing()).toEqual([{ type: 'subscribe', symbols: ['BTC'] }]);

    first.serverSends({ type: 'tick', symbol: 'BTC', price: 1, open: 1, ts: 1 });
    expect(events).toEqual([{ type: 'tick', tick: { symbol: 'BTC', price: 1, open: 1, ts: 1 } }]);

    // 2. Server restarts (clean close): status flips, a symbol added meanwhile is only remembered
    first.serverCloses();
    expect(feed.status()).toBe('reconnecting');
    feed.subscribe(['ETH']);
    expect(first.nonPing()).toHaveLength(1);

    // 3. After the backoff (~1 s) a new socket is opened and gets the FULL subscription list
    await new Promise((resolve) => setTimeout(resolve, 1400));
    const second = FakeSocket.instances[1];
    expect(second).toBeDefined();
    second.serverOpens();
    expect(feed.status()).toBe('live');
    expect(second.nonPing()).toEqual([{ type: 'subscribe', symbols: ['BTC', 'ETH'] }]);

    sub.unsubscribe();
  });

  it('latency tracing: ticks carry timing, and ping/pong measures the clock difference', () => {
    const feed = TestBed.runInInjectionContext(() => new WebSocketPriceFeed());
    const events: FeedEvent[] = [];
    const sub = feed.events$.subscribe((e) => events.push(e));
    const socket = FakeSocket.instances[0];
    socket.serverOpens();

    // On open the feed pings right away with its current time
    const ping = socket.sent.find((m) => (m as { type: string }).type === 'ping') as { t0: number };
    expect(ping).toBeDefined();

    // Server clock is 5000 ms ahead of ours; answer at once (round trip ≈ 0)
    socket.serverSends({ type: 'pong', t0: ping.t0, server: ping.t0 + 5000 });
    const clock = feed.clockSync()!;
    expect(Math.abs(clock.offset - 5000)).toBeLessThan(50);
    expect(clock.rtt).toBeLessThan(50);

    socket.serverSends({ type: 'tick', symbol: 'BTC', price: 1, open: 1, ts: 100, rx: 150, tx: 160 });
    const tick = events.find((e) => e.type === 'tick');
    expect(tick?.type === 'tick' && tick.timing).toMatchObject({ exchange: 100, serverIn: 150, serverOut: 160 });
    sub.unsubscribe();
  });
});
