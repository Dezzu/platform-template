import { inject } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import type { Permission, PlatformPermission } from '@app/contracts';
import { CORE_CONFIG } from '../config/core.config';
import { AuthService } from '../auth/auth.service';
import { findNavItem } from '../navigation/nav.manifest';
import { PermissionsService } from './permissions.service';

/** Sends an unauthenticated visitor to the login page. */
export const authGuard: CanMatchFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const config = inject(CORE_CONFIG);

  return auth.authenticated() ? true : router.createUrlTree([config.loginRoute]);
};

/** Keeps a signed-in user out of the login and sign-up pages. */
export const guestGuard: CanMatchFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const config = inject(CORE_CONFIG);

  return auth.authenticated() ? router.createUrlTree([config.homeRoute]) : true;
};

export function requireAnyPermission(...permissions: readonly Permission[]): CanMatchFn {
  return () => inject(PermissionsService).anyOf(...permissions);
}

export function requireAllPermissions(...permissions: readonly Permission[]): CanMatchFn {
  return () => inject(PermissionsService).allOf(...permissions);
}

/**
 * Guards a route with a PLATFORM permission, which comes from `user.role` rather than
 * from membership. For the administration area, where there is no tenant at all.
 */
export function requireAnyPlatformPermission(
  ...permissions: readonly PlatformPermission[]
): CanMatchFn {
  return () => inject(PermissionsService).anyOfPlatform(...permissions);
}

/**
 * Guards a route with the permissions its menu entry declares.
 *
 * Prefer this over spelling the permissions out again in the route: `navGuard('projects')`
 * and the sidebar then read the same array, so the two cannot drift apart. Spelling them
 * twice is how a menu ends up offering a link that leads to a blank page.
 *
 * An unknown id is a programming error and fails loudly rather than quietly allowing
 * everyone through.
 */
export function navGuard(id: string): CanMatchFn {
  return () => {
    const item = findNavItem(id);
    if (!item) {
      throw new Error(`navGuard('${id}'): no entry with that id in NAV_MANIFEST.`);
    }

    const service = inject(PermissionsService);

    // A screen that does not belong to this kind of product is not merely hidden: the
    // route refuses it too, or a bookmark would still reach it.
    const modes = item.modes;
    if (modes && !modes.includes(service.mode())) return false;

    const platform = item.platformPermissions ?? [];
    if (platform.length > 0 && !service.anyOfPlatform(...platform)) return false;

    const permissions = item.permissions ?? [];
    if (permissions.length === 0) return true;

    return item.mode === 'all' ? service.allOf(...permissions) : service.anyOf(...permissions);
  };
}
