import { Injectable, Signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, interval } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { StockPrice } from '../models/stock.model';

interface InitialAsset {
  symbol: string;
  name: string;
  basePrice: number;
}

@Injectable({
  providedIn: 'root',
})
export class PriceService {
  /** Initial hardcoded assets list */
  private readonly initialAssets: InitialAsset[] = [
    { symbol: 'BTC', name: 'Bitcoin', basePrice: 68400.0 },
    { symbol: 'ETH', name: 'Ethereum', basePrice: 3520.0 },
    { symbol: 'RELIANCE', name: 'Reliance Industries', basePrice: 2950.0 },
    { symbol: 'TCS', name: 'Tata Consultancy Services', basePrice: 4150.0 },
    { symbol: 'INFY', name: 'Infosys Limited', basePrice: 1880.0 },
  ];

  /** In-memory state tracking current asset prices across ticks */
  private currentPricesMap: Map<string, StockPrice> = new Map();

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
    // 1. Initialize baseline stock price state
    this.initialAssets.forEach((asset) => {
      this.currentPricesMap.set(asset.symbol, {
        symbol: asset.symbol,
        name: asset.name,
        price: asset.basePrice,
        previousPrice: asset.basePrice,
        change: 0,
        changePercent: 0,
        updatedAt: new Date(),
      });
    });

    // 2. Build the continuous RxJS random-walk stream
    this.prices$ = interval(1500).pipe(
      map(() => this.calculateNextPrices()),
      shareReplay(1) // Multicast to all components sharing the latest emitted price array
    );

    // 3. Convert RxJS stream to Signal & derive summary counts
    this.pricesSignal = toSignal(this.prices$, { initialValue: [] });

    this.gainersCount = computed(
      () => this.pricesSignal().filter((stock) => stock.change > 0).length
    );

    this.losersCount = computed(
      () => this.pricesSignal().filter((stock) => stock.change < 0).length
    );

    this.totalTracked = computed(() => this.pricesSignal().length);
  }

  /**
   * Random walk generator algorithm.
   * Adjusts each price up or down by a small random percentage (-0.4% to +0.5%).
   */
  private calculateNextPrices(): StockPrice[] {
    const updatedList: StockPrice[] = [];

    this.initialAssets.forEach((asset) => {
      const current = this.currentPricesMap.get(asset.symbol)!;

      // Random walk delta: range between -0.004 (-0.4%) and +0.005 (+0.5%)
      const deltaPercent = (Math.random() - 0.44) * 0.01;
      const rawNewPrice = current.price * (1 + deltaPercent);
      const newPrice = Math.max(0.01, Number(rawNewPrice.toFixed(2)));

      // Calculate net difference relative to starting base price
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

      // Store updated object back into state map
      this.currentPricesMap.set(asset.symbol, updatedStock);
      updatedList.push(updatedStock);
    });

    return updatedList;
  }
}
