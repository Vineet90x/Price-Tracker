import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  { path: '', redirectTo: 'watchlist', pathMatch: 'full' },
  {
    path: 'watchlist',
    loadComponent: () =>
      import('./features/watchlist/watchlist').then((m) => m.Watchlist),
  },
  {
    path: 'portfolio',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/portfolio/portfolio').then((m) => m.Portfolio),
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.Login),
  },
  { path: '**', redirectTo: 'watchlist' },
];
