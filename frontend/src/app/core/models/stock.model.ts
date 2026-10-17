/**
 * Represents the structured price data for a single tracked asset/stock/crypto symbol.
 */
export interface StockPrice {
  symbol: string;         // Unique symbol ticker (e.g. 'BTC', 'RELIANCE')
  name: string;           // Display name (e.g. 'Bitcoin', 'Reliance Industries')
  price: number;          // Current price
  previousPrice: number;  // Price prior to the latest tick (used for flash animations)
  change: number;         // price - session open (Binance 24 h open, or base price when simulated)
  changePercent: number;  // change as a % of the session open
  updatedAt: Date;        // Time of the latest tick (from the feed, not the browser clock)
}

/**
 * A key-value lookup map for quick symbol-based asset retrieval.
 */
export type StockMap = Record<string, StockPrice>;
