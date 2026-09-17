import { authGuard, guestGuard, navGuard } from '@app/core';
import type { Routes } from '@angular/router';

/**
 * Routes are guarded with `navGuard(id)`, which reads the permissions from the entry
 * of the same id in NAV_MANIFEST. Spelling the permissions out again here is how a
 * menu ends up offering a link that leads nowhere.
 */
export const routes: Routes = [
  {
    path: 'sign-in',
    canMatch: [guestGuard],
    loadComponent: () => import('./features/auth/sign-in.page').then((m) => m.SignInPage),
  },
  {
    path: 'forgot-password',
    canMatch: [guestGuard],
    loadComponent: () =>
      import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    // Where Better Auth redirects after validating the emailed token, with `?token=`.
    path: 'reset-password',
    canMatch: [guestGuard],
    loadComponent: () =>
      import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'sign-up',
    canMatch: [guestGuard],
    loadComponent: () => import('./features/auth/sign-up.page').then((m) => m.SignUpPage),
  },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: () => import('./layout/shell.page').then((m) => m.ShellPage),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'projects',
        canMatch: [navGuard('projects')],
        loadComponent: () =>
          import('./features/projects/projects.page').then((m) => m.ProjectsPage),
      },
      {
        path: 'members',
        canMatch: [navGuard('members')],
        loadComponent: () => import('./features/members/members.page').then((m) => m.MembersPage),
      },
      {
        // Reached from an invitation email, so it is deliberately absent from
        // NAV_MANIFEST — and guarded by authGuard alone, since the visitor is not a
        // member of anything yet.
        path: 'accept-invitation',
        loadComponent: () =>
          import('./features/members/accept-invitation.page').then((m) => m.AcceptInvitationPage),
      },
      {
        path: 'files',
        canMatch: [navGuard('files')],
        loadComponent: () => import('./features/files/files.page').then((m) => m.FilesPage),
      },
      {
        path: 'insights',
        canMatch: [navGuard('insights')],
        loadComponent: () =>
          import('./features/insights/insights.page').then((m) => m.InsightsPage),
      },
      {
        path: 'billing',
        canMatch: [navGuard('billing')],
        loadComponent: () => import('./features/billing/billing.page').then((m) => m.BillingPage),
      },
      {
        // Reached from the profile menu rather than the sidebar, so it is deliberately
        // absent from NAV_MANIFEST.
        path: 'profile',
        loadComponent: () => import('./features/profile/profile.page').then((m) => m.ProfilePage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: '' },
];
