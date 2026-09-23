import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home.page').then((m) => m.HomePage),
  },
  {
    /**
     * `privacy-policy`, not `privacy`: the dashboard's `/privacy` is the screen where
     * you exercise the rights this document describes, and two different things under
     * one path is how a link in an email ends up on the wrong one.
     */
    path: 'privacy-policy',
    data: { doc: 'privacy' },
    loadComponent: () => import('./pages/legal/legal.page').then((m) => m.LegalPage),
  },
  {
    path: 'terms',
    data: { doc: 'terms' },
    loadComponent: () => import('./pages/legal/legal.page').then((m) => m.LegalPage),
  },
  { path: '**', redirectTo: '' },
];
