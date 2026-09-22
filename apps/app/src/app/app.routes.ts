import {
  authGuard,
  guestGuard,
  navGuard,
  requireAnyPermission,
  requireAnyPlatformPermission,
} from '@app/core';
import { PERMISSIONS, PLATFORM_PERMISSIONS } from '@app/contracts/permissions';
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
    /**
     * Outside the shell, and behind no guard at all: this is where apiInterceptor
     * sends anybody the API answered 503 to, and every call the shell makes on boot
     * would answer 503 to them too.
     */
    path: 'maintenance',
    loadComponent: () =>
      import('./features/maintenance/maintenance.page').then((m) => m.MaintenancePage),
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
        /**
         * Before ':id', or 'new' would be read as an identifier. The router matches in
         * declaration order, so the literal has to come first.
         */
        path: 'projects/new',
        canMatch: [requireAnyPermission(PERMISSIONS.PROJECTS_MANAGE)],
        loadComponent: () =>
          import('./features/projects/project-form.page').then((m) => m.ProjectFormPage),
      },
      {
        path: 'projects/:id',
        canMatch: [requireAnyPermission(PERMISSIONS.PROJECTS_MANAGE)],
        loadComponent: () =>
          import('./features/projects/project-form.page').then((m) => m.ProjectFormPage),
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
        path: 'audit',
        canMatch: [navGuard('audit')],
        loadComponent: () => import('./features/audit/audit.page').then((m) => m.AuditPage),
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
        /**
         * Platform administration, which lives in `libs/admin` rather than in this
         * app's features: it is the platform's back office, not the tenant's product,
         * and eslint-plugin-boundaries now refuses any import in either direction.
         *
         * Loaded by subpath, never through a barrel — a barrel would put every
         * administration screen in whichever chunk asked for the first one.
         *
         * Guarded by a PLATFORM permission, which comes from `user.role`: an
         * organization owner has none of these however many tenants they own.
         */
        path: 'admin/users',
        canMatch: [navGuard('admin')],
        loadComponent: () => import('@app/admin/admin-users.page').then((m) => m.AdminUsersPage),
      },
      {
        path: 'admin/flags',
        canMatch: [navGuard('admin-flags')],
        loadComponent: () => import('@app/admin/admin-flags.page').then((m) => m.AdminFlagsPage),
      },
      {
        // Before ':key', or 'new' would be read as a flag key — the router matches in
        // declaration order.
        path: 'admin/flags/new',
        canMatch: [requireAnyPlatformPermission(PLATFORM_PERMISSIONS.FLAGS_MANAGE)],
        loadComponent: () =>
          import('@app/admin/admin-flag-form.page').then((m) => m.AdminFlagFormPage),
      },
      {
        path: 'admin/flags/:key',
        canMatch: [requireAnyPlatformPermission(PLATFORM_PERMISSIONS.FLAGS_MANAGE)],
        loadComponent: () =>
          import('@app/admin/admin-flag-form.page').then((m) => m.AdminFlagFormPage),
      },
      {
        path: 'admin/maintenance',
        canMatch: [navGuard('admin-maintenance')],
        loadComponent: () =>
          import('@app/admin/admin-maintenance.page').then((m) => m.AdminMaintenancePage),
      },
      {
        path: 'admin/organizations',
        canMatch: [requireAnyPlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_READ)],
        loadComponent: () =>
          import('@app/admin/admin-organizations.page').then((m) => m.AdminOrganizationsPage),
      },
      {
        /**
         * Opened from the bell in the header rather than from the sidebar, so it is
         * deliberately absent from NAV_MANIFEST — the count is the entry point, and a
         * menu item next to it would be a second door to the same room.
         */
        path: 'notifications',
        loadComponent: () =>
          import('./features/notifications/notifications.page').then((m) => m.NotificationsPage),
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
