import { Injectable, Signal, signal, computed, inject } from '@angular/core';
import { PriceService } from './price.service';
import { PriceAlert, AlertToast } from '../models/alert.model';

@Injectable({
  providedIn: 'root',
})
export class AlertService {
  private readonly priceService = inject(PriceService);

  // ─── Internal State (writable signals, private) ───────────────────────────

  /** All active + fired alerts. Private — mutated only by this service. */
  private readonly _alerts = signal<PriceAlert[]>([]);

  /**
   * Toast queue. Each entry is auto-removed after AUTO_DISMISS_MS.
   * Kept as an array so multiple alerts can fire in the same tick.
   */
  private readonly _toasts = signal<AlertToast[]>([]);

  /** How long (ms) a toast stays visible before auto-dismissing */
  private readonly AUTO_DISMISS_MS = 5000;

  // ─── Public Read-Only API (signals consumed by components) ───────────────

  /** Active alerts only — used by card bell icon to show badge count */
  readonly activeAlerts: Signal<PriceAlert[]> = computed(() =>
    this._alerts().filter((a) => a.isActive)
  );

  /** All current toast notifications — rendered by AppComponent */
  readonly toasts: Signal<AlertToast[]> = computed(() => this._toasts());

  /** Returns active alert count for a given symbol (used for bell badge) */
  alertCountForSymbol(symbol: string): number {
    return this.activeAlerts().filter((a) => a.symbol === symbol).length;
  }

  /** Returns all active alerts for a given symbol (used in card form display) */
  alertsForSymbol(symbol: string): PriceAlert[] {
    return this.activeAlerts().filter((a) => a.symbol === symbol);
  }

  constructor() {
    // Subscribe to the shared price stream and check every tick.
    // AlertService is a root singleton so this subscription lives for the app lifetime.
    this.priceService.prices$.subscribe((prices) => {
      this.checkAlerts(prices);
    });
  }

  // ─── Public Actions ───────────────────────────────────────────────────────

  /**
   * Adds a new price alert.
   * Called by the watchlist card form on submit.
   *
   * @param symbol   Ticker symbol (e.g. 'BTC')
   * @param targetPrice  Target price that should trigger the alert
   * @param direction  'above' | 'below'
   */
  addAlert(
    symbol: string,
    targetPrice: number,
    direction: 'above' | 'below'
  ): void {
    const newAlert: PriceAlert = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      targetPrice,
      direction,
      isActive: true,
      createdAt: new Date(),
    };

    // Signal mutation: always produce a new array (immutable update pattern)
    this._alerts.update((current) => [...current, newAlert]);
  }

  /**
   * Manually removes an alert (e.g. user clicks ✕ on a pending alert).
   * Deactivates by ID rather than splicing, keeping the array stable.
   */
  removeAlert(alertId: string): void {
    this._alerts.update((current) =>
      current.filter((a) => a.id !== alertId)
    );
  }

  /** Dismisses a toast by ID (called by the ✕ button on each toast) */
  dismissToast(toastId: string): void {
    this._toasts.update((current) => current.filter((t) => t.id !== toastId));
  }

  // ─── Price Checking Logic ─────────────────────────────────────────────────

  /**
   * Runs on every price tick (~1.5s).
   * For each active alert, checks whether the latest price has crossed the target.
   *
   * WHY this lives in AlertService (not PriceService):
   * - Single Responsibility: PriceService generates prices; AlertService reacts to them.
   * - AlertService can be removed/replaced without touching PriceService at all.
   * - This mirrors the real production pattern: price feed is infrastructure,
   *   alert logic is business logic — they live in different layers.
   */
  private checkAlerts(prices: { symbol: string; price: number }[]): void {
    const priceMap = new Map(prices.map((p) => [p.symbol, p.price]));

    let anyFired = false;
    const firedToasts: AlertToast[] = [];

    const updatedAlerts = this._alerts().map((alert) => {
      if (!alert.isActive) return alert; // already fired, skip

      const currentPrice = priceMap.get(alert.symbol);
      if (currentPrice === undefined) return alert; // symbol not tracked yet

      const triggered =
        alert.direction === 'above'
          ? currentPrice >= alert.targetPrice
          : currentPrice <= alert.targetPrice;

      if (triggered) {
        anyFired = true;

        // Build the toast notification for this fired alert
        firedToasts.push({
          id: `toast-${alert.id}`,
          symbol: alert.symbol,
          targetPrice: alert.targetPrice,
          direction: alert.direction,
          triggeredAt: new Date(),
          triggeredAtPrice: currentPrice,
        });

        // Deactivate the alert (fire once — never again)
        return { ...alert, isActive: false };
      }

      return alert;
    });

    // Only update signals if something actually fired (avoid noise renders)
    if (anyFired) {
      this._alerts.set(updatedAlerts);
      this._toasts.update((current) => [...current, ...firedToasts]);

      // Auto-dismiss each new toast after AUTO_DISMISS_MS
      firedToasts.forEach((toast) => {
        setTimeout(() => this.dismissToast(toast.id), this.AUTO_DISMISS_MS);
      });
    }
  }
}
