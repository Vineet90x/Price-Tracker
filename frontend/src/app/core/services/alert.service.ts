import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  Signal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, filter, map, tap } from 'rxjs';
import { AlertToast, PriceAlert } from '../models/alert.model';
import { AuthService } from '../auth/auth.service';
import { FiredAlert, PriceFeed } from './price-feed';

/** The alert as the backend sends it (snake_case, dates as text) */
interface AlertDto {
  id: number;
  symbol: string;
  direction: 'above' | 'below';
  target_price: number;
  status: 'active' | 'triggered';
  created_at: string;
  triggered_at: string | null;
  triggered_price: number | null;
}

/** The backend sends UTC times without a "Z"; add it so the browser doesn't read them as local time. */
function parseUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z');
}

function fromDto(dto: AlertDto): PriceAlert {
  return {
    id: dto.id,
    symbol: dto.symbol,
    direction: dto.direction,
    targetPrice: dto.target_price,
    status: dto.status,
    createdAt: parseUtc(dto.created_at),
    triggeredAt: dto.triggered_at ? parseUtc(dto.triggered_at) : null,
    triggeredPrice: dto.triggered_price,
  };
}

export type NotificationState = NotificationPermission | 'unsupported';

/**
 * Price alerts. The SERVER stores and checks them (they fire even with every tab closed);
 * this service only lists, creates and cancels them, and reacts when the server says one fired.
 */
@Injectable({
  providedIn: 'root',
})
export class AlertService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly feed = inject(PriceFeed);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // ─── Internal State (writable signals, private) ───────────────────────────

  /** Your alerts as last loaded from / changed on the server */
  private readonly _alerts = signal<PriceAlert[]>([]);

  /** Toast queue. Each entry is auto-removed after AUTO_DISMISS_MS. */
  private readonly _toasts = signal<AlertToast[]>([]);

  /** Whether the browser may show desktop notifications */
  private readonly _notifications = signal<NotificationState>(
    this.isBrowser && 'Notification' in window ? Notification.permission : 'unsupported',
  );

  /** How long (ms) a toast stays visible before auto-dismissing */
  private readonly AUTO_DISMISS_MS = 5000;

  // ─── Public Read-Only API ─────────────────────────────────────────────────

  readonly activeAlerts: Signal<PriceAlert[]> = computed(() =>
    this._alerts().filter((a) => a.status === 'active'),
  );

  /** Fired alerts, newest first: also the ones that fired while you were away */
  readonly triggeredAlerts: Signal<PriceAlert[]> = computed(() =>
    this._alerts()
      .filter((a) => a.status === 'triggered')
      .sort((a, b) => (b.triggeredAt?.getTime() ?? 0) - (a.triggeredAt?.getTime() ?? 0)),
  );

  readonly toasts = this._toasts.asReadonly();
  readonly notificationState = this._notifications.asReadonly();

  /**
   * Active alert count per symbol (watchlist row badge).
   * Rebuilt only when alerts change, not on every price tick (Backlog #9).
   */
  readonly alertCountBySymbol: Signal<ReadonlyMap<string, number>> = computed(() => {
    const counts = new Map<string, number>();
    for (const alert of this.activeAlerts()) {
      counts.set(alert.symbol, (counts.get(alert.symbol) ?? 0) + 1);
    }
    return counts;
  });

  constructor() {
    // Give the live connection our access token (or null on logout), so the server knows
    // which socket is ours and can deliver our fired alerts to it.
    effect(() => {
      const token = this.auth.accessToken();
      untracked(() => this.feed.setAuthToken(token));
    });

    // Logged in → load alerts from the server. Logged out → forget them.
    // isLoggedIn is a computed, so a token refresh (same user) doesn't reload.
    effect(() => {
      const loggedIn = this.auth.isLoggedIn();
      untracked(() => (loggedIn ? this.load() : this._alerts.set([])));
    });

    this.feed.events$
      .pipe(
        filter((e) => e.type === 'alert'),
        map((e) => e.alert),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((fired) => this.onFired(fired));
  }

  // ─── Public Actions ───────────────────────────────────────────────────────

  /** Creates an alert on the server. Errors (e.g. 422 would_trigger_immediately) go to the caller. */
  addAlert(symbol: string, targetPrice: number, direction: 'above' | 'below'): Observable<PriceAlert> {
    return this.http
      .post<AlertDto>('/api/alerts', { symbol, direction, target_price: targetPrice })
      .pipe(
        map(fromDto),
        // The server may already have fired it (and told us over the socket) before this reply arrived.
        tap((alert) =>
          this._alerts.update((list) => (list.some((a) => a.id === alert.id) ? list : [alert, ...list])),
        ),
      );
  }

  /** Cancels an alert. Removed from the list right away; reloaded if the server says no. */
  removeAlert(alertId: number): void {
    this._alerts.update((list) => list.filter((a) => a.id !== alertId));
    this.http.delete(`/api/alerts/${alertId}`).subscribe({ error: () => this.load() });
  }

  /** Dismisses a toast by ID (called by the ✕ button on each toast) */
  dismissToast(toastId: string): void {
    this._toasts.update((current) => current.filter((t) => t.id !== toastId));
  }

  /** Asks the browser for permission to show desktop notifications (must follow a click). */
  async enableDesktopNotifications(): Promise<void> {
    if (this._notifications() === 'unsupported') return;
    this._notifications.set(await Notification.requestPermission());
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private load(): void {
    this.http.get<AlertDto[]>('/api/alerts').subscribe({
      next: (dtos) => this._alerts.set(dtos.map(fromDto)),
      error: () => undefined, // not logged in / server down: keep what we have
    });
  }

  /** The server says one of our alerts fired. */
  private onFired(fired: FiredAlert): void {
    const triggered: PriceAlert = {
      id: fired.id,
      symbol: fired.symbol,
      direction: fired.direction,
      targetPrice: fired.targetPrice,
      status: 'triggered',
      createdAt: fired.triggeredAt,
      triggeredAt: fired.triggeredAt,
      triggeredPrice: fired.triggeredPrice,
    };
    this._alerts.update((list) => [triggered, ...list.filter((a) => a.id !== fired.id)]);

    const toast: AlertToast = {
      id: `toast-${fired.id}`,
      symbol: fired.symbol,
      targetPrice: fired.targetPrice,
      direction: fired.direction,
      triggeredAt: fired.triggeredAt,
      triggeredAtPrice: fired.triggeredPrice,
    };
    this._toasts.update((current) => [...current, toast]);
    setTimeout(() => this.dismissToast(toast.id), this.AUTO_DISMISS_MS);

    // Tab in the background (another tab or app in front)? Also show an OS-level notification.
    if (this.isBrowser && document.hidden && this._notifications() === 'granted') {
      new Notification(`${fired.symbol} ${fired.direction} ${fired.targetPrice}`, {
        body: `Price hit ${fired.triggeredPrice}`,
        tag: toast.id, // the same alert never shows twice, even with several tabs open
      });
    }
  }
}
