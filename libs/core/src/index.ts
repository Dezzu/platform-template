/**
 * The shared core: transport, session, permissions, navigation.
 *
 * Depends on packages/contracts and on nothing else of ours — no UI, and never
 * `environment.*`. Configuration arrives through provideCore().
 */
export * from './config/core.config';

export * from './auth/auth.client';
export * from './auth/auth.service';

export * from './http/app-error';
export * from './http/api.interceptor';

export * from './api/me.api';
export * from './api/session.api';
export * from './api/notifications.api';
export * from './api/plans.api';
export * from './billing/billing.service';

export * from './permissions/permissions.service';
export * from './permissions/permission.guards';
export * from './permissions/can.directive';
export * from './permissions/can-platform.directive';
export * from './features/feature-flags.service';
export * from './features/if-flag.directive';
export * from './notifications/toast.service';
export * from './notifications/notification-center.service';

export * from './navigation/nav.model';
export * from './navigation/return-url';
export * from './navigation/nav.manifest';
