import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: 'system'
        },
      },
      license: 'eyJpZCI6IjMwYzFmNjgzLTM2MmYtNGUwZC04NWE5LWJhMWIyOTA0MTM1ZSIsInByb2R1Y3QiOiJwcmltZXVpIiwidGllciI6ImNvbW11bml0eSIsInR5cGUiOiJkZXYiLCJpYXQiOjE3OTIyMzQwMzgsImV4cCI6MTgyMzc3MDAzOH0.mqNESDL1xTsFFEawVISU4qOm1kFoSjH_ktXY6Yl3Z91lLNOAukWTQOllZXCUS0KfuPK3LXHX3HoVMS2_GpuTCg',
    }),
  ],
};
