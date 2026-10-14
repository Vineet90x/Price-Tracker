import { Injectable, Signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, interval } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { StockPrice } from '../models/stock.model';

export interface PricePoint {
  time: number; // Unix timestamp in seconds (UTCTimestamp for lightweight-charts)
  value: number;
}

/** Represents a single asset in the full searchable universe */
export interface AssetInfo {
  symbol: string;
  name: string;
  basePrice: number;
  isCrypto: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PriceService {
  /**
   * Full universe of 25 searchable assets (Step 5).
   * Not all are tracked by default — only INITIAL_SYMBOLS tick on startup.
   * The user can add any from this list via the watchlist search bar.
   */
  private readonly symbolUniverse: AssetInfo[] = [
    // ── Crypto ──────────────────────────────────────────────────────────────
    { symbol: 'BTC',   name: 'Bitcoin',                    basePrice: 68400.00, isCrypto: true  },
    { symbol: 'ETH',   name: 'Ethereum',                   basePrice: 3520.00,  isCrypto: true  },
    { symbol: 'SOL',   name: 'Solana',                     basePrice: 185.00,   isCrypto: true  },
    { symbol: 'BNB',   name: 'Binance Coin',               basePrice: 580.00,   isCrypto: true  },
    { symbol: 'ADA',   name: 'Cardano',                    basePrice: 0.62,     isCrypto: true  },
    { symbol: 'DOT',   name: 'Polkadot',                   basePrice: 8.40,     isCrypto: true  },
    { symbol: 'AVAX',  name: 'Avalanche',                  basePrice: 36.50,    isCrypto: true  },
    { symbol: 'DOGE',  name: 'Dogecoin',                   basePrice: 0.175,    isCrypto: true  },
    { symbol: 'LINK',  name: 'Chainlink',                  basePrice: 14.50,    isCrypto: true  },
    { symbol: 'UNI',   name: 'Uniswap',                    basePrice: 9.20,     isCrypto: true  },
    { symbol: 'MATIC', name: 'Polygon',                    basePrice: 0.78,     isCrypto: true  },
    // ── Indian Stocks ────────────────────────────────────────────────────────
    { symbol: 'RELIANCE',   name: 'Reliance Industries',        basePrice: 2950.00,  isCrypto: false },
    { symbol: 'TCS',        name: 'Tata Consultancy Services',  basePrice: 4150.00,  isCrypto: false },
    { symbol: 'INFY',       name: 'Infosys Limited',            basePrice: 1880.00,  isCrypto: false },
    { symbol: 'HDFCBANK',   name: 'HDFC Bank',                  basePrice: 1680.00,  isCrypto: false },
    { symbol: 'ICICIBANK',  name: 'ICICI Bank',                 basePrice: 1120.00,  isCrypto: false },
    { symbol: 'WIPRO',      name: 'Wipro Limited',              basePrice: 560.00,   isCrypto: false },
    { symbol: 'ADANIPORTS', name: 'Adani Ports',                basePrice: 1350.00,  isCrypto: false },
    { symbol: 'BAJFINANCE', name: 'Bajaj Finance',              basePrice: 7200.00,  isCrypto: false },
    { symbol: 'MARUTI',     name: 'Maruti Suzuki',              basePrice: 12400.00, isCrypto: false },
    { symbol: 'TITAN',      name: 'Titan Company',              basePrice: 3600.00,  isCrypto: false },
    { symbol: 'SUNPHARMA',  name: 'Sun Pharmaceutical',         basePrice: 1750.00,  isCrypto: false },
    { symbol: 'ONGC',       name: 'Oil & Natural Gas Corp',     basePrice: 275.00,   isCrypto: false },
    { symbol: 'POWERGRID',  name: 'Power Grid Corp',            basePrice: 330.00,   isCrypto: false },
    { symbol: 'LTIM',       name: 'LTIMindtree',                basePrice: 5800.00,  isCrypto: false },
  ];

  /** Symbols that tick on startup (subset of universe) */
  private readonly INITIAL_SYMBOLS = ['BTC', 'ETH', 'RELIANCE', 'TCS', 'INFY'];

  /**
   * Mutable list of assets currently being price-calculated every tick.
   * Starts at 5 symbols; grows when user calls addSymbol().
   */
  private trackedAssets: AssetInfo[];

  /** In-memory state tracking current asset prices across ticks */
  private currentPricesMap: Map<string, StockPrice> = new Map();

  /** Running history of up to 50 price points per asset for charts */
  private priceHistoryMap: Map<string, PricePoint[]> = new Map();

  /** Public Observable stream emitting live updated price arrays every 1.5s */
  readonly prices$: Observable<StockPrice[]>;

  /** Signal representation of the live price stream */
  readonly pricesSignal: Signal<StockPrice[]>;

  /** Derived signal: Number of stocks currently in profit (change > 0) */
  readonly gainersCount: Signal<number>;

  /** Derived signal: Number of stocks currently in loss (change < 0) */
  readonly losersCount: Signal<number>;

  /** Derived signal: Total number of assets tracked */
  readonly totalTracked: Signal<number>;

  constructor() {
    const now = Math.floor(Date.now() / 1000);

    // 1. Resolve initial tracked assets from universe
    this.trackedAssets = this.symbolUniverse.filter((a) =>
      this.INITIAL_SYMBOLS.includes(a.symbol)
    );

    // 2. Seed state + price history for the initial tracked assets
    this.seedAssets(this.trackedAssets, now);

    // 3. Build the continuous RxJS random-walk stream
    this.prices$ = interval(1500).pipe(
      map(() => this.calculateNextPrices()),
      shareReplay(1) // Multicast: all components share the same latest emission
    );

    // 4. Convert RxJS stream to Signal & derive summary counts
    this.pricesSignal = toSignal(this.prices$, { initialValue: [] });

    this.gainersCount = computed(
      () => this.pricesSignal().filter((stock) => stock.change > 0).length
    );
    this.losersCount = computed(
      () => this.pricesSignal().filter((stock) => stock.change < 0).length
    );
    this.totalTracked = computed(() => this.pricesSignal().length);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Returns the current running history data points for a given symbol (for charts) */
  getPriceHistory(symbol: string): PricePoint[] {
    return this.priceHistoryMap.get(symbol) || [];
  }

  /**
   * Searches the full 25-asset universe by ticker symbol OR full name.
   * Case-insensitive. Returns [] for blank/empty queries.
   *
   * WHY this lives in the service (not the component):
   * In Phase 2 this becomes an HTTP call to the backend. The component calls
   * searchSymbols() the same way — only this method's internals change.
   */
  searchSymbols(term: string): AssetInfo[] {
    const lower = term.toLowerCase().trim();
    if (!lower) return [];
    return this.symbolUniverse.filter(
      (asset) =>
        asset.symbol.toLowerCase().includes(lower) ||
        asset.name.toLowerCase().includes(lower)
    );
  }

  /** Returns true if the symbol is currently live-ticking (has been added to watchlist) */
  isTracked(symbol: string): boolean {
    return this.currentPricesMap.has(symbol);
  }

  /**
   * Dynamically adds a new symbol from the universe to the live-ticking watchlist.
   * - Seeds its initial state + price history immediately.
   * - Pushes it into trackedAssets so the next calculateNextPrices() tick includes it.
   * - The new card appears in the watchlist UI on the very next interval tick (~1.5s).
   * - No-op if already tracked or not in universe.
   */
  addSymbol(symbol: string): void {
    if (this.isTracked(symbol)) return;
    const asset = this.symbolUniverse.find((a) => a.symbol === symbol);
    if (!asset) return;

    const now = Math.floor(Date.now() / 1000);
    this.seedAssets([asset], now);
    this.trackedAssets.push(asset);
  }

  /**
   * Returns true if the symbol is a cryptocurrency → price shown in USD ($).
   * False = Indian stock → price shown in INR (₹).
   * Moved from Watchlist component to service so chart + portfolio can reuse it.
   */
  isCrypto(symbol: string): boolean {
    return this.symbolUniverse.find((a) => a.symbol === symbol)?.isCrypto ?? false;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Seeds currentPricesMap + priceHistoryMap for a batch of assets.
   * Extracted so both the constructor init and addSymbol() share the same logic
   * (DRY principle — one place to change if history size or seeding strategy changes).
   */
  private seedAssets(assets: AssetInfo[], now: number): void {
    assets.forEach((asset) => {
      // Baseline price state
      this.currentPricesMap.set(asset.symbol, {
        symbol: asset.symbol,
        name: asset.name,
        price: asset.basePrice,
        previousPrice: asset.basePrice,
        change: 0,
        changePercent: 0,
        updatedAt: new Date(),
      });

      // Pre-seed 25 historical points so the chart renders with an initial wave
      const initialPoints: PricePoint[] = [];
      let tempPrice = asset.basePrice * 0.98;
      for (let i = 25; i >= 1; i--) {
        const timePoint = now - i * 2;
        const drift = (Math.random() - 0.48) * (asset.basePrice * 0.005);
        tempPrice = Math.max(0.01, Number((tempPrice + drift).toFixed(2)));
        initialPoints.push({ time: timePoint, value: tempPrice });
      }
      initialPoints.push({ time: now, value: asset.basePrice });
      this.priceHistoryMap.set(asset.symbol, initialPoints);
    });
  }

  /**
   * Random walk generator algorithm.
   * Now iterates over trackedAssets (not a fixed array) — grows as user adds symbols.
   * Adjusts each price up or down by a small random percentage (-0.4% to +0.5%).
   */
  private calculateNextPrices(): StockPrice[] {
    const updatedList: StockPrice[] = [];
    const nowSeconds = Math.floor(Date.now() / 1000);

    this.trackedAssets.forEach((asset) => {
      const current = this.currentPricesMap.get(asset.symbol)!;

      // Random walk delta: range between -0.004 (-0.4%) and +0.005 (+0.5%)
      const deltaPercent = (Math.random() - 0.44) * 0.01;
      const rawNewPrice = current.price * (1 + deltaPercent);
      const newPrice = Math.max(0.01, Number(rawNewPrice.toFixed(2)));

      // Net change relative to the original base price (not just the previous tick)
      const netChange = Number((newPrice - asset.basePrice).toFixed(2));
      const percentChange = Number(
        ((netChange / asset.basePrice) * 100).toFixed(2)
      );

      const updatedStock: StockPrice = {
        ...current,
        previousPrice: current.price,
        price: newPrice,
        change: netChange,
        changePercent: percentChange,
        updatedAt: new Date(),
      };

      this.currentPricesMap.set(asset.symbol, updatedStock);
      updatedList.push(updatedStock);

      // Append point to history (keep max 50 points)
      const history = this.priceHistoryMap.get(asset.symbol) || [];
      // Ensure strictly increasing timestamps for lightweight-charts
      const lastPoint = history[history.length - 1];
      const validTime =
        lastPoint && nowSeconds <= lastPoint.time
          ? lastPoint.time + 1
          : nowSeconds;
      history.push({ time: validTime, value: newPrice });
      if (history.length > 50) {
        history.shift();
      }
      this.priceHistoryMap.set(asset.symbol, history);
    });

    return updatedList;
  }
}
