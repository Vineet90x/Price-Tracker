import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, interval, merge, mergeMap, share } from 'rxjs';
import { ASSETS, AssetInfo } from '../data/asset-universe';
import { ClockSync, FeedEvent, FeedStatus, PriceFeed, PriceSnapshot } from './price-feed';

/** Keep 2 decimals for normal prices but 4 below 1, so DOGE (0.08) still moves (Backlog #1). */
function roundPrice(price: number): number {
  const factor = price >= 1 ? 100 : 10_000;
  return Math.round(price * factor) / factor;
}

/**
 * The Phase 1 random walk, now behind the PriceFeed interface.
 * Still useful: offline development (?feed=sim) and the Step 7 scale test (?scale=200).
 */
@Injectable()
export class SimulatedPriceFeed extends PriceFeed {
  readonly status = signal<FeedStatus>('simulated').asReadonly();
  readonly clockSync = signal<ClockSync | null>(null).asReadonly(); // no server to sync with

  private readonly assets = new Map(inject(ASSETS).map((a) => [a.symbol, a] as const));
  private readonly current = new Map<string, number>();
  private readonly snapshots = new Subject<FeedEvent>();

  readonly events$: Observable<FeedEvent> = merge(
    this.snapshots,
    interval(1500).pipe(mergeMap(() => this.nextTicks())),
  ).pipe(share());

  subscribe(symbols: readonly string[]): void {
    const now = Date.now();
    for (const symbol of symbols) {
      const asset = this.assets.get(symbol);
      if (!asset || this.current.has(symbol)) continue;
      this.snapshots.next({ type: 'snapshot', snapshot: this.seed(asset, now) });
    }
  }

  /** The simulator has no server, so no server-side alerts either. */
  setAuthToken(): void {}

  /** 25 fake history points, 2 s apart, ending at the base price, so the chart isn't empty. */
  private seed(asset: AssetInfo, now: number): PriceSnapshot {
    const history: [number, number][] = [];
    let price = asset.basePrice * 0.98;
    for (let i = 25; i >= 1; i--) {
      price = this.step(price, asset.basePrice);
      history.push([now - i * 2000, price]);
    }
    history.push([now, asset.basePrice]);
    this.current.set(asset.symbol, asset.basePrice);
    return { symbol: asset.symbol, price: asset.basePrice, open: asset.basePrice, ts: now, history };
  }

  private nextTicks(): FeedEvent[] {
    const ts = Date.now();
    return [...this.current].map(([symbol, price]) => {
      const base = this.assets.get(symbol)!.basePrice;
      const next = this.step(price, base);
      this.current.set(symbol, next);
      return { type: 'tick', tick: { symbol, price: next, open: base, ts } };
    });
  }

  /** Symmetric ±0.4 % step: equally likely up or down, so no long-run drift (Backlog #2). */
  private step(price: number, base: number): number {
    const next = price * (1 + (Math.random() - 0.5) * 0.008);
    return roundPrice(Math.max(next, base * 0.01));
  }
}
