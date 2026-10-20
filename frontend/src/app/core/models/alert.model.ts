/** A price alert, stored on the server (so it fires even when no tab is open) */
export interface PriceAlert {
  /** Database id */
  id: number;
  /** Ticker symbol this alert is watching */
  symbol: string;
  /** Price level that triggers the alert */
  targetPrice: number;
  /** Fire when price crosses ABOVE or BELOW the target */
  direction: 'above' | 'below';
  /** active = still watching · triggered = fired (once, never again) */
  status: 'active' | 'triggered';
  /** When the alert was created */
  createdAt: Date;
  /** When it fired, and at which price (only for triggered alerts) */
  triggeredAt: Date | null;
  triggeredPrice: number | null;
}

/** A toast notification shown when an alert fires */
export interface AlertToast {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: 'above' | 'below';
  triggeredAt: Date;
  /** Actual price at the moment the alert fired */
  triggeredAtPrice: number;
}
