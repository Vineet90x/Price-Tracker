import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { signal } from '@angular/core';
import { FeedEvent, FeedStatus, PriceFeed } from './price-feed';
import { PriceService } from './price.service';

/** A PriceFeed the test drives by hand. */
class FakeFeed extends PriceFeed {
  readonly events = new Subject<FeedEvent>();
  readonly events$ = this.events.asObservable();
  readonly status = signal<FeedStatus>('live').asReadonly();
  readonly clockSync = signal(null).asReadonly();
  readonly subscribed: string[] = [];
  subscribe(symbols: readonly string[]): void {
    this.subscribed.push(...symbols);
  }
  setAuthToken(): void {}
}

const tick = (symbol: string, price: number, ts: number): FeedEvent => ({
  type: 'tick',
  tick: { symbol, price, open: 100, ts },
});

describe('PriceService', () => {
  let feed: FakeFeed;
  let service: PriceService;

  beforeEach(() => {
    feed = new FakeFeed();
    TestBed.configureTestingModule({ providers: [{ provide: PriceFeed, useValue: feed }] });
    service = TestBed.inject(PriceService);
  });

  it('subscribes the initial watchlist on startup', () => {
    expect(feed.subscribed).toEqual(['BTC', 'ETH', 'RELIANCE', 'TCS', 'INFY']);
  });

  it('a snapshot replaces history with one point per second (last value wins)', () => {
    feed.events.next({
      type: 'snapshot',
      snapshot: { symbol: 'BTC', price: 103, open: 100, ts: 3_000, history: [[1_000, 101], [1_500, 102], [3_000, 103]] },
    });
    expect(service.getPriceHistory('BTC')).toEqual([
      { time: 1, value: 102 },
      { time: 3, value: 103 },
    ]);
  });

  it('ticks append; same second replaces the last point; older ticks are ignored', () => {
    feed.events.next(tick('BTC', 100, 1_000));
    feed.events.next(tick('BTC', 101, 2_000));
    feed.events.next(tick('BTC', 102, 2_400)); // same second as the previous one
    feed.events.next(tick('BTC', 999, 1_500)); // out of order → dropped
    expect(service.getPriceHistory('BTC')).toEqual([
      { time: 1, value: 100 },
      { time: 2, value: 102 },
    ]);
  });

  it('emits batched snapshots with change vs. the session open', async () => {
    feed.events.next(tick('BTC', 110, 1_000));
    feed.events.next(tick('ETH', 90, 1_000));
    await new Promise((resolve) => setTimeout(resolve, 300)); // auditTime(250)

    const rows = service.pricesSignal();
    expect(rows.map((r) => r.symbol)).toEqual(['BTC', 'ETH']); // watchlist order
    expect(rows[0].change).toBe(10);
    expect(rows[0].changePercent).toBe(10);
    expect(service.gainersCount()).toBe(1);
    expect(service.losersCount()).toBe(1);
  });

  it('addSymbol tracks it and asks the feed for it once', () => {
    expect(service.isTracked('SOL')).toBe(false);
    service.addSymbol('SOL');
    service.addSymbol('SOL');
    service.addSymbol('NOT-A-SYMBOL');
    expect(service.isTracked('SOL')).toBe(true);
    expect(feed.subscribed.filter((s) => s === 'SOL')).toEqual(['SOL']);
    expect(feed.subscribed).not.toContain('NOT-A-SYMBOL');
  });
});
