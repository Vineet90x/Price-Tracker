import {
  ApplicationConfig,
  PLATFORM_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { providePriceFeed } from './core/services/price-feed.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    // withFetch: HttpClient uses fetch() (recommended with SSR). Interceptors run in array order.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    providePriceFeed(),
    // Before the first navigation: turn the refresh cookie (if any) into a logged-in state,
    // so guards see the right answer on page reload. Skipped when prerendering on the server.
    provideAppInitializer(() => {
      if (isPlatformBrowser(inject(PLATFORM_ID))) return inject(AuthService).restoreSession();
      return undefined;
    }),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          // The app is always dark: <html class="app-dark"> in index.html switches PrimeNG to its
          // dark tokens. 'system' followed the OS and set color-scheme: light on light-themed machines.
          darkModeSelector: '.app-dark',
        },
      },
      license: 'eyJpZCI6IjMwYzFmNjgzLTM2MmYtNGUwZC04NWE5LWJhMWIyOTA0MTM1ZSIsInByb2R1Y3QiOiJwcmltZXVpIiwidGllciI6ImNvbW11bml0eSIsInR5cGUiOiJkZXYiLCJpYXQiOjE3OTIyMzQwMzgsImV4cCI6MTgyMzc3MDAzOH0.mqNESDL1xTsFFEawVISU4qOm1kFoSjH_ktXY6Yl3Z91lLNOAukWTQOllZXCUS0KfuPK3LXHX3HoVMS2_GpuTCg',
    }),
  ],
};
