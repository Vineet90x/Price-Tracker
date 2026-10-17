import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Logged in → allow. Otherwise → /login?returnUrl=… so we can come back after login.
 * No waiting needed: provideAppInitializer already ran restoreSession() before the first navigation.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthService).isLoggedIn()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Keeps a logged-in user away from the login page. */
export const guestGuard: CanActivateFn = () => {
  if (!inject(AuthService).isLoggedIn()) return true;
  return inject(Router).createUrlTree(['/watchlist']);
};
