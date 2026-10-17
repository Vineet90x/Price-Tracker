import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** These authenticate with the cookie or credentials, never with the access token. */
const AUTH_ENDPOINTS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/google',
  '/api/auth/config',
];

function withToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
}

/**
 * 1. Adds "Authorization: Bearer <access token>" to our API calls.
 * 2. On 401 (token expired / revoked): refreshes once, retries the original request once.
 * 3. If the refresh itself fails, the session is over → login page.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/') || AUTH_ENDPOINTS.includes(req.url)) {
    return next(req);
  }
  const auth = inject(AuthService);

  return next(withToken(req, auth.accessToken())).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      return auth.refresh().pipe(
        catchError((refreshError: unknown) => {
          auth.handleSessionExpired();
          return throwError(() => refreshError);
        }),
        // Exactly one retry: if this also fails, the error goes to the caller (no loop).
        switchMap((token) => next(withToken(req, token))),
      );
    }),
  );
};
