/**
 * Represents the structured price data for a single tracked asset/stock/crypto symbol.
 */
export interface StockPrice {
  symbol: string;         // Unique symbol ticker (e.g. 'BTC', 'RELIANCE')
  name: string;           // Display name (e.g. 'Bitcoin', 'Reliance Industries')
  price: number;          // Current price
  previousPrice: number;  // Price prior to the latest tick (used for flash animations)
  change: number;         // Absolute price difference from initial base price
  changePercent: number;  // Percentage change from initial base price
  updatedAt: Date;        // Timestamp of the latest tick update
}

/**
 * A key-value lookup map for quick symbol-based asset retrieval.
 */
export type StockMap = Record<string, StockPrice>;
