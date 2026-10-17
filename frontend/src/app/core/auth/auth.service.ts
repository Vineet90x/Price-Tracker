import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  finalize,
  firstValueFrom,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { GoogleIdentityService } from './google-identity.service';

export interface AuthUser {
  id: number;
  email: string;
}

interface TokenResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: AuthUser;
}

/**
 * Owns the login state.
 * - Access token: in memory only (a private signal). Gone on reload, which is fine: restoreSession() gets a new one.
 * - Refresh token: an httpOnly cookie set by the backend. This code never sees it; the browser
 *   attaches it to /api/auth/* requests automatically.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly google = inject(GoogleIdentityService);

  private readonly _accessToken = signal<string | null>(null);
  private readonly _user = signal<AuthUser | null>(null);

  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);

  /** The refresh request currently in flight, shared by every caller (see refresh()). */
  private refreshInFlight: Observable<string> | null = null;

  accessToken(): string | null {
    return this._accessToken();
  }

  login(email: string, password: string): Observable<AuthUser> {
    return this.http
      .post<TokenResponse>('/api/auth/login', { email, password })
      .pipe(
        tap((res) => this.setSession(res)),
        map((res) => res.user),
      );
  }

  /** `credential` = the ID token from Google's button. The backend verifies it and starts a normal session. */
  loginWithGoogle(credential: string): Observable<AuthUser> {
    return this.http
      .post<TokenResponse>('/api/auth/google', { credential })
      .pipe(
        tap((res) => this.setSession(res)),
        map((res) => res.user),
      );
  }

  register(email: string, password: string): Observable<AuthUser> {
    return this.http
      .post<AuthUser>('/api/auth/register', { email, password })
      .pipe(switchMap(() => this.login(email, password)));
  }

  logout(): void {
    // Fire-and-forget: even if the server call fails, the user is logged out locally.
    this.http.post('/api/auth/logout', {}).subscribe({ error: () => undefined });
    this.google.disableAutoSelect();
    this.clear();
    this.router.navigateByUrl('/login');
  }

  /**
   * Trade the refresh cookie for a new access token.
   * If five requests hit 401 at the same moment, they must NOT start five refreshes:
   * the first call creates the request, shareReplay(1) lets the others join it.
   */
  refresh(): Observable<string> {
    this.refreshInFlight ??= this.http.post<TokenResponse>('/api/auth/refresh', {}).pipe(
      tap((res) => this.setSession(res)),
      map((res) => res.access_token),
      catchError((err: unknown) => {
        this.clear();
        return throwError(() => err);
      }),
      finalize(() => (this.refreshInFlight = null)),
      shareReplay(1),
    );
    return this.refreshInFlight;
  }

  /** Called once at app start (provideAppInitializer). Never rejects: "not logged in" is a valid outcome. */
  restoreSession(): Promise<void> {
    return firstValueFrom(
      this.refresh().pipe(
        map(() => undefined),
        catchError(() => of(undefined)),
      ),
    );
  }

  /** The interceptor calls this when even a refresh fails: the session is really over. */
  handleSessionExpired(): void {
    this.clear();
    this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }

  private setSession(res: TokenResponse): void {
    this._accessToken.set(res.access_token);
    this._user.set(res.user);
  }

  private clear(): void {
    this._accessToken.set(null);
    this._user.set(null);
  }
}
