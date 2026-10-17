import { InjectionToken, inject } from '@angular/core';
import { RUNTIME_OPTIONS } from '../config/runtime-options';

/** Represents a single asset in the full searchable universe */
export interface AssetInfo {
  symbol: string;
  name: string;
  basePrice: number;
  isCrypto: boolean;
}

/**
 * The 25 searchable assets. Must match backend/app/symbols.py.
 * basePrice is only used by the in-browser simulated feed (?feed=sim).
 */
export const BASE_ASSETS: readonly AssetInfo[] = [
  // ── Crypto (live from Binance in Phase 2) ───────────────────────────────
  { symbol: 'BTC',   name: 'Bitcoin',      basePrice: 81500.0, isCrypto: true },
  { symbol: 'ETH',   name: 'Ethereum',     basePrice: 2420.0,  isCrypto: true },
  { symbol: 'SOL',   name: 'Solana',       basePrice: 104.0,   isCrypto: true },
  { symbol: 'BNB',   name: 'Binance Coin', basePrice: 716.0,   isCrypto: true },
  { symbol: 'ADA',   name: 'Cardano',      basePrice: 0.222,   isCrypto: true },
  { symbol: 'DOT',   name: 'Polkadot',     basePrice: 1.12,    isCrypto: true },
  { symbol: 'AVAX',  name: 'Avalanche',    basePrice: 9.88,    isCrypto: true },
  { symbol: 'DOGE',  name: 'Dogecoin',     basePrice: 0.0799,  isCrypto: true },
  { symbol: 'LINK',  name: 'Chainlink',    basePrice: 12.04,   isCrypto: true },
  { symbol: 'UNI',   name: 'Uniswap',      basePrice: 7.15,    isCrypto: true },
  { symbol: 'MATIC', name: 'Polygon (POL)', basePrice: 0.0929, isCrypto: true },
  // ── Indian Stocks (simulated server-side in Phase 2) ────────────────────
  { symbol: 'RELIANCE',   name: 'Reliance Industries',       basePrice: 2950.0,  isCrypto: false },
  { symbol: 'TCS',        name: 'Tata Consultancy Services', basePrice: 4150.0,  isCrypto: false },
  { symbol: 'INFY',       name: 'Infosys Limited',           basePrice: 1880.0,  isCrypto: false },
  { symbol: 'HDFCBANK',   name: 'HDFC Bank',                 basePrice: 1680.0,  isCrypto: false },
  { symbol: 'ICICIBANK',  name: 'ICICI Bank',                basePrice: 1120.0,  isCrypto: false },
  { symbol: 'WIPRO',      name: 'Wipro Limited',             basePrice: 560.0,   isCrypto: false },
  { symbol: 'ADANIPORTS', name: 'Adani Ports',               basePrice: 1350.0,  isCrypto: false },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance',             basePrice: 7200.0,  isCrypto: false },
  { symbol: 'MARUTI',     name: 'Maruti Suzuki',             basePrice: 12400.0, isCrypto: false },
  { symbol: 'TITAN',      name: 'Titan Company',             basePrice: 3600.0,  isCrypto: false },
  { symbol: 'SUNPHARMA',  name: 'Sun Pharmaceutical',        basePrice: 1750.0,  isCrypto: false },
  { symbol: 'ONGC',       name: 'Oil & Natural Gas Corp',    basePrice: 275.0,   isCrypto: false },
  { symbol: 'POWERGRID',  name: 'Power Grid Corp',           basePrice: 330.0,   isCrypto: false },
  { symbol: 'LTIM',       name: 'LTIMindtree',               basePrice: 5800.0,  isCrypto: false },
];

/** Symbols on the watchlist at startup */
export const INITIAL_SYMBOLS: readonly string[] = ['BTC', 'ETH', 'RELIANCE', 'TCS', 'INFY'];

/** Step 7 scale test: deterministic fake symbols TST001…TSTnnn (same prices every reload). */
export function generateScaleTestAssets(count: number): AssetInfo[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      symbol: `TST${String(n).padStart(3, '0')}`,
      name: `Scale Test Asset ${n}`,
      basePrice: 10 + ((n * 7919) % 5000),
      isCrypto: false,
    };
  });
}

/** The universe this app run uses: the 25 real assets, plus scale-test assets when ?scale=N. */
export const ASSETS = new InjectionToken<readonly AssetInfo[]>('ASSETS', {
  providedIn: 'root',
  factory: () => {
    const count = inject(RUNTIME_OPTIONS).scaleTest;
    return count > 0 ? [...BASE_ASSETS, ...generateScaleTestAssets(count)] : BASE_ASSETS;
  },
});
