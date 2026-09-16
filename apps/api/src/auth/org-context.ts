import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { OrgRole, Permission, PlatformPermission } from '@app/contracts';

/**
 * The resolved tenant context for the current request. Attached by PermissionsGuard.
 *
 * `organizationId` here is the ONLY organization this request is allowed to touch.
 * Nothing downstream should ever take an organization id from the request body or a
 * path parameter — that is how cross-tenant reads happen.
 */
export interface OrgContext {
  organizationId: string;
  userId: string;
  role: OrgRole;
  permissions: ReadonlySet<Permission>;
  platformPermissions: ReadonlySet<PlatformPermission>;
  /** Set when a platform admin is impersonating; every mutation records it. */
  impersonatorUserId: string | null;
}

export const ORG_CONTEXT_KEY = 'orgContext';

/** Injects the resolved OrgContext into a handler parameter. */
/**
 * Like @CurrentOrg() but yields null instead of throwing when the user has no active
 * organization. For the handful of endpoints that must answer before one is chosen.
 */
export const CurrentOrgOptional = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgContext | null => {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    return (request[ORG_CONTEXT_KEY] as OrgContext | undefined) ?? null;
  },
);

export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgContext => {
    const request = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    const context = request[ORG_CONTEXT_KEY] as OrgContext | undefined;
    if (!context) {
      // A programming error, not a user error: the handler asked for tenant context on
      // a route that never resolved one (missing @RequirePermissions, or @AllowAnonymous).
      throw new Error(
        'OrgContext is not available on this request. Routes using @CurrentOrg() must ' +
          'be authenticated and carry @RequirePermissions().',
      );
    }
    return context;
  },
);
