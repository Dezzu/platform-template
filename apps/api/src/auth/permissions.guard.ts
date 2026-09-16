import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ERROR_CODES,
  permissionsForRole,
  platformPermissionsForRole,
  type OrgRole,
  type Permission,
  type PlatformPermission,
} from '@app/contracts';
import { type Database, member } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common';
import { DRIZZLE } from '../database/database.module';
import { ORG_CONTEXT_KEY, type OrgContext } from './org-context';
import {
  ORG_OPTIONAL_METADATA,
  PERMISSIONS_METADATA,
  PLATFORM_PERMISSIONS_METADATA,
  type PermissionRequirement,
} from './permissions.decorator';

interface RequestWithSession extends Record<string, unknown> {
  headers: Record<string, string | string[] | undefined>;
  session?: {
    user?: { id: string; role?: string | null };
    session?: { activeOrganizationId?: string | null; impersonatedBy?: string | null };
  };
}

/**
 * Resolves the tenant context and enforces the permission catalogue.
 *
 * Runs after the Better Auth AuthGuard, so a session is guaranteed on any route that
 * reaches a permission check.
 *
 * Organization resolution order:
 *   1. the `X-Organization-Id` header — an explicit per-request choice wins, otherwise
 *      the header would be dead for any user who has an active organization, which is
 *      almost all of them. Safe because membership is verified either way.
 *   2. `session.activeOrganizationId` — set when the user switches organization
 *   3. the user's only membership, when they belong to exactly one
 *
 * A requested organization the user is not a member of resolves to 404, never 403:
 * answering "forbidden" confirms that the id exists, which is itself a leak.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlers = [context.getHandler(), context.getClass()];

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      PERMISSIONS_METADATA,
      handlers,
    );
    const platformRequired = this.reflector.getAllAndOverride<
      readonly PlatformPermission[] | undefined
    >(PLATFORM_PERMISSIONS_METADATA, handlers);
    const orgOptional = this.reflector.getAllAndOverride<boolean | undefined>(
      ORG_OPTIONAL_METADATA,
      handlers,
    );

    // Nothing declared: the route is not permission-guarded. Authentication has
    // already been decided by the Better Auth guard.
    if (!requirement && !platformRequired && !orgOptional) return true;

    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const session = request.session;
    const userId = session?.user?.id;

    if (!userId) {
      throw new AppException(
        ERROR_CODES.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }

    const platformPermissions = new Set(platformPermissionsForRole(session?.user?.role));

    if (platformRequired && platformRequired.length > 0) {
      const missing = platformRequired.filter((p) => !platformPermissions.has(p));
      if (missing.length > 0) throw AppException.missingPermission(missing);
    }

    // Platform-only routes do not need a tenant.
    if (!requirement && !orgOptional) return true;

    const organizationId = await this.resolveOrganizationId(request, userId);

    if (!organizationId) {
      if (orgOptional) return true;
      throw new AppException(
        ERROR_CODES.ORGANIZATION_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'No active organization. Select one, or pass the X-Organization-Id header.',
      );
    }

    const membership = await this.loadMembership(organizationId, userId);
    if (!membership) {
      // 404, not 403 — see the class comment.
      throw AppException.notFound('Organization', ERROR_CODES.ORGANIZATION_NOT_FOUND);
    }

    const role = membership.role as OrgRole;
    const permissions = new Set<Permission>(permissionsForRole(role));

    const orgContext: OrgContext = {
      organizationId,
      userId,
      role,
      permissions,
      platformPermissions,
      impersonatorUserId: session?.session?.impersonatedBy ?? null,
    };
    request[ORG_CONTEXT_KEY] = orgContext;

    if (!requirement) return true;

    const { permissions: required, mode } = requirement;
    const missing = required.filter((p) => !permissions.has(p));
    const satisfied = mode === 'all' ? missing.length === 0 : missing.length < required.length;

    if (!satisfied) {
      this.logger.debug(
        `user ${userId} lacks ${mode === 'all' ? 'all of' : 'any of'} [${required.join(', ')}] in org ${organizationId} (role ${role})`,
      );
      throw AppException.missingPermission(mode === 'all' ? missing : required);
    }

    return true;
  }

  private async resolveOrganizationId(
    request: RequestWithSession,
    userId: string,
  ): Promise<string | null> {
    const header = request.headers['x-organization-id'];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    if (fromHeader) return fromHeader;

    const active = request.session?.session?.activeOrganizationId;
    if (active) return active;

    // Exactly one membership: no ambiguity, so do not force the client to choose.
    const memberships = await this.db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .limit(2);

    return memberships.length === 1 ? (memberships[0]?.organizationId ?? null) : null;
  }

  private async loadMembership(
    organizationId: string,
    userId: string,
  ): Promise<{ role: string } | undefined> {
    const [row] = await this.db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1);
    return row;
  }
}
