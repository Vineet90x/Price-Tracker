/** A single price alert set by the user */
export interface PriceAlert {
  /** Unique ID — used for targeting dismissal */
  id: string;
  /** Ticker symbol this alert is watching */
  symbol: string;
  /** Price level that triggers the alert */
  targetPrice: number;
  /** Fire when price crosses ABOVE or BELOW the target */
  direction: 'above' | 'below';
  /** True = still watching. False = fired or manually removed. */
  isActive: boolean;
  /** Timestamp when alert was created */
  createdAt: Date;
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
