import { SetMetadata } from '@nestjs/common';
import type { Permission, PlatformPermission } from '@app/contracts';

export const PERMISSIONS_METADATA = Symbol('app:permissions');
export const PLATFORM_PERMISSIONS_METADATA = Symbol('app:platform-permissions');
export const ORG_OPTIONAL_METADATA = Symbol('app:org-optional');

export interface PermissionRequirement {
  permissions: readonly Permission[];
  mode: 'any' | 'all';
}

/**
 * Requires organization-scoped permissions, and by doing so also declares that the
 * route is tenant-scoped: the guard resolves the active organization and makes it
 * available through @CurrentOrg().
 *
 *   @RequirePermissions('members.read', 'members.manage')          // ANY (default)
 *   @RequirePermissions({ all: ['billing.read', 'billing.manage'] }) // ALL
 */
export function RequirePermissions(
  ...permissions:
    [...Permission[]] | [{ all: readonly Permission[] }] | [{ any: readonly Permission[] }]
): MethodDecorator & ClassDecorator {
  const first = permissions[0];

  if (typeof first === 'object' && first !== null) {
    if ('all' in first) {
      return SetMetadata(PERMISSIONS_METADATA, { permissions: first.all, mode: 'all' });
    }
    return SetMetadata(PERMISSIONS_METADATA, { permissions: first.any, mode: 'any' });
  }

  return SetMetadata(PERMISSIONS_METADATA, {
    permissions: permissions as readonly Permission[],
    mode: 'any',
  });
}

/**
 * Requires a platform-level permission. These come from `user.role`, cross tenant
 * boundaries, and are intentionally a separate decorator so that "admin of an
 * organization" can never be confused with "administrator of the platform".
 */
export function RequirePlatformPermission(
  ...permissions: readonly PlatformPermission[]
): MethodDecorator & ClassDecorator {
  return SetMetadata(PLATFORM_PERMISSIONS_METADATA, permissions);
}

/**
 * Marks a tenant-scoped route as usable without an active organization — for the
 * handful of endpoints a user hits before choosing one (listing their organizations,
 * creating the first).
 */
export const OrgOptional = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ORG_OPTIONAL_METADATA, true);
