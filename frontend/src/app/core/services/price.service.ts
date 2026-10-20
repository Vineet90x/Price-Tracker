import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, auditTime, map, shareReplay, tap } from 'rxjs';
import { StockPrice } from '../models/stock.model';
import { RUNTIME_OPTIONS } from '../config/runtime-options';
import { ASSETS, AssetInfo, INITIAL_SYMBOLS } from '../data/asset-universe';
import { FeedEvent, PriceFeed, PriceTick } from './price-feed';

export type { AssetInfo } from '../data/asset-universe';

export interface PricePoint {
  time: number; // Unix timestamp in seconds (UTCTimestamp for lightweight-charts)
  value: number;
}

/** Points kept per symbol for the chart (≈5 min of 1 s Binance ticks; matches the backend) */
const HISTORY_LIMIT = 300;
const NO_HISTORY: readonly PricePoint[] = Object.freeze([]);

/**
 * App-wide price state. Turns raw feed events (ticks arriving at any rate, from any PriceFeed)
 * into a watchlist snapshot that components render.
 * Its public API is the same as in Phase 1: only where the prices come from changed.
 */
@Injectable({
  providedIn: 'root',
})
export class PriceService {
  private readonly feed = inject(PriceFeed);
  private readonly symbolUniverse = inject(ASSETS);
  /** O(1) lookups instead of Array.find over the universe (Backlog #9) */
  private readonly assetsBySymbol = new Map(this.symbolUniverse.map((a) => [a.symbol, a] as const));

  /** Watchlist symbols in display order. A signal, so isTracked() is reactive (Backlog #10). */
  private readonly trackedSymbols = signal<readonly string[]>(this.initialSymbols());

  /** Latest price per symbol. Plain Map: written per tick, read once per snapshot. */
  private readonly latest = new Map<string, StockPrice>();

  /** Chart history per symbol. Mutated in place on every tick; a new array only on a snapshot. */
  private readonly history = new Map<string, PricePoint[]>();

  /** Connection state of the underlying feed, for the header indicator */
  readonly feedStatus = this.feed.status;

  /** Watchlist snapshots, at most 4 per second however fast ticks arrive */
  readonly prices$: Observable<StockPrice[]>;

  /** Signal representation of the live price stream */
  readonly pricesSignal: Signal<StockPrice[]>;

  /** Derived signal: Number of assets up on the session (change > 0) */
  readonly gainersCount: Signal<number>;

  /** Derived signal: Number of assets down on the session (change < 0) */
  readonly losersCount: Signal<number>;

  /** Derived signal: Total number of assets with a price */
  readonly totalTracked: Signal<number>;

  constructor() {
    this.prices$ = this.feed.events$.pipe(
      tap((event) => this.apply(event)),
      // Batching: with 25 symbols × 1 tick/s, re-rendering per tick would mean 25 renders/s.
      // auditTime emits once per 250 ms window, with the state as of the window's end.
      auditTime(250),
      map(() => this.snapshot()),
      shareReplay({ bufferSize: 1, refCount: false }), // all consumers share one pipeline
    );

    this.pricesSignal = toSignal(this.prices$, { initialValue: [] });
    this.gainersCount = computed(() => this.pricesSignal().filter((s) => s.change > 0).length);
    this.losersCount = computed(() => this.pricesSignal().filter((s) => s.change < 0).length);
    this.totalTracked = computed(() => this.pricesSignal().length);

    // After toSignal() has subscribed, so synchronous snapshots (simulated feed) aren't missed.
    this.feed.subscribe(this.trackedSymbols());
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Chart history for a symbol. Same array instance until a new snapshot replaces it. */
  getPriceHistory(symbol: string): readonly PricePoint[] {
    return this.history.get(symbol) ?? NO_HISTORY;
  }

  /**
   * Searches the asset universe by ticker symbol OR full name. Case-insensitive. Returns [] for blank queries.
   * Kept local: 25 assets don't justify a backend search endpoint yet.
   */
  searchSymbols(term: string): AssetInfo[] {
    const lower = term.toLowerCase().trim();
    if (!lower) return [];
    return this.symbolUniverse.filter(
      (asset) =>
        asset.symbol.toLowerCase().includes(lower) || asset.name.toLowerCase().includes(lower),
    );
  }

  /** True if the symbol is on the watchlist. Reads a signal → templates update immediately. */
  isTracked(symbol: string): boolean {
    return this.trackedSymbols().includes(symbol);
  }

  /** Adds a symbol to the watchlist and asks the feed for it. No-op if unknown or already tracked. */
  addSymbol(symbol: string): void {
    if (this.isTracked(symbol) || !this.assetsBySymbol.has(symbol)) return;
    this.trackedSymbols.update((list) => [...list, symbol]);
    this.feed.subscribe([symbol]);
  }

  /** True = crypto → price shown in USD ($). False = Indian stock → INR (₹). */
  isCrypto(symbol: string): boolean {
    return this.assetsBySymbol.get(symbol)?.isCrypto ?? false;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private initialSymbols(): string[] {
    const scaleTest = inject(RUNTIME_OPTIONS).scaleTest;
    const scaleSymbols = scaleTest > 0 ? this.symbolUniverse.slice(-scaleTest).map((a) => a.symbol) : [];
    return [...INITIAL_SYMBOLS, ...scaleSymbols];
  }

  private apply(event: FeedEvent): void {
    if (event.type === 'alert') return; // private alert messages are AlertService's business
    if (event.type === 'snapshot') {
      const { snapshot } = event;
      this.history.set(snapshot.symbol, toPoints(snapshot.history));
      this.upsert(snapshot);
    } else if (this.upsert(event.tick)) {
      this.appendPoint(event.tick);
    }
  }

  /** Stores the tick as the symbol's latest price. Returns false for unknown or out-of-order ticks. */
  private upsert(tick: PriceTick): boolean {
    const asset = this.assetsBySymbol.get(tick.symbol);
    if (!asset) return false;
    const previous = this.latest.get(tick.symbol);
    if (previous && tick.ts < previous.updatedAt.getTime()) return false;

    const change = tick.price - tick.open;
    this.latest.set(tick.symbol, {
      symbol: tick.symbol,
      name: asset.name,
      price: tick.price,
      previousPrice: previous?.price ?? tick.price,
      change,
      changePercent: tick.open ? (change / tick.open) * 100 : 0,
      updatedAt: new Date(tick.ts),
    });
    return true;
  }

  /**
   * Single source of truth for chart time (fixes Backlog #3): the chart draws these points
   * and never invents its own timestamps. Two ticks in the same second → the later one wins.
   */
  private appendPoint(tick: PriceTick): void {
    let points = this.history.get(tick.symbol);
    if (!points) {
      points = [];
      this.history.set(tick.symbol, points);
    }
    const time = Math.floor(tick.ts / 1000);
    const last = points.at(-1);
    if (last && time < last.time) return;
    if (last && time === last.time) {
      points[points.length - 1] = { time, value: tick.price };
    } else {
      points.push({ time, value: tick.price });
      if (points.length > HISTORY_LIMIT) points.shift();
    }
  }

  private snapshot(): StockPrice[] {
    const rows: StockPrice[] = [];
    for (const symbol of this.trackedSymbols()) {
      const price = this.latest.get(symbol);
      if (price) rows.push(price);
    }
    return rows;
  }
}

/** [ts ms, price] pairs → one point per second (last one wins), oldest first. */
function toPoints(raw: [number, number][]): PricePoint[] {
  const points: PricePoint[] = [];
  for (const [ts, value] of raw) {
    const time = Math.floor(ts / 1000);
    const last = points.at(-1);
    if (last && time < last.time) continue;
    if (last && time === last.time) points[points.length - 1] = { time, value };
    else points.push({ time, value });
  }
  return points.slice(-HISTORY_LIMIT);
}
