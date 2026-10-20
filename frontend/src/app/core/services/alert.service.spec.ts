import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { AlertService } from './alert.service';
import { AuthService } from '../auth/auth.service';
import { FeedEvent, FeedStatus, PriceFeed } from './price-feed';

/** A PriceFeed the test drives by hand; remembers the last auth token it was given. */
class FakeFeed extends PriceFeed {
  readonly events = new Subject<FeedEvent>();
  readonly events$ = this.events.asObservable();
  readonly status = signal<FeedStatus>('live').asReadonly();
  readonly clockSync = signal(null).asReadonly();
  token: string | null = null;
  subscribe(): void {}
  setAuthToken(token: string | null): void {
    this.token = token;
  }
}

const dto = (id: number, status: 'active' | 'triggered' = 'active') => ({
  id,
  symbol: 'BTC',
  direction: 'above',
  target_price: 90000,
  status,
  created_at: '2026-10-20T10:00:00',
  triggered_at: status === 'triggered' ? '2026-10-20T11:00:00' : null,
  triggered_price: status === 'triggered' ? 90010 : null,
});

describe('AlertService (server-side alerts)', () => {
  let feed: FakeFeed;
  let backend: HttpTestingController;
  let alerts: AlertService;
  let auth: AuthService;

  beforeEach(() => {
    feed = new FakeFeed();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PriceFeed, useValue: feed },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    alerts = TestBed.inject(AlertService);
    TestBed.tick(); // run the constructor effects
  });

  afterEach(() => backend.verify());

  function logIn(): void {
    auth.login('a@b.co', 'password1').subscribe();
    backend.expectOne('/api/auth/login').flush({
      access_token: 'tok-1',
      token_type: 'bearer',
      expires_in: 900,
      user: { id: 1, email: 'a@b.co' },
    });
    TestBed.tick();
  }

  it('logged out: loads nothing and gives the socket no token', () => {
    backend.expectNone('/api/alerts');
    expect(feed.token).toBeNull();
    expect(alerts.activeAlerts()).toEqual([]);
  });

  it('logging in loads alerts from the server and passes the token to the socket', () => {
    logIn();
    expect(feed.token).toBe('tok-1');
    backend.expectOne('/api/alerts').flush([dto(1), dto(2, 'triggered')]);
    expect(alerts.activeAlerts().map((a) => a.id)).toEqual([1]);
    expect(alerts.triggeredAlerts()[0].triggeredAt?.toISOString()).toBe('2026-10-20T11:00:00.000Z'); // read as UTC
    expect(alerts.alertCountBySymbol().get('BTC')).toBe(1);
  });

  it('a fired alert from the server marks it triggered and shows one toast', () => {
    logIn();
    backend.expectOne('/api/alerts').flush([dto(1)]);
    feed.events.next({
      type: 'alert',
      alert: {
        id: 1,
        symbol: 'BTC',
        direction: 'above',
        targetPrice: 90000,
        triggeredPrice: 90012,
        triggeredAt: new Date(),
      },
    });
    expect(alerts.activeAlerts()).toEqual([]);
    expect(alerts.triggeredAlerts()[0].triggeredPrice).toBe(90012);
    expect(alerts.toasts().length).toBe(1);
  });

  it('addAlert: no duplicate if the server already reported it fired before the POST reply', () => {
    logIn();
    backend.expectOne('/api/alerts').flush([]);
    alerts.addAlert('BTC', 90000, 'above').subscribe();
    feed.events.next({
      type: 'alert',
      alert: { id: 7, symbol: 'BTC', direction: 'above', targetPrice: 90000, triggeredPrice: 90001, triggeredAt: new Date() },
    });
    backend.expectOne((r) => r.method === 'POST' && r.url === '/api/alerts').flush(dto(7));
    const all = [...alerts.activeAlerts(), ...alerts.triggeredAlerts()];
    expect(all.filter((a) => a.id === 7).length).toBe(1);
    expect(alerts.triggeredAlerts()[0].id).toBe(7);
  });

  it('removeAlert removes at once and reloads if the server refuses', () => {
    logIn();
    backend.expectOne('/api/alerts').flush([dto(1)]);
    alerts.removeAlert(1);
    expect(alerts.activeAlerts()).toEqual([]);
    backend.expectOne('/api/alerts/1').flush(null, { status: 500, statusText: 'Server Error' });
    backend.expectOne('/api/alerts').flush([dto(1)]); // reloaded: the alert is back
    expect(alerts.activeAlerts().length).toBe(1);
  });
});
