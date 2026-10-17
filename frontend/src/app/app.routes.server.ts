import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Depend on who is logged in, which the build machine can't know: render in the browser only.
  { path: 'portfolio', renderMode: RenderMode.Client },
  { path: 'login', renderMode: RenderMode.Client },
  {
    path: '**',
    renderMode: RenderMode.Prerender
  }
];
