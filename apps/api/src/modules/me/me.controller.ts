import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import {
  platformPermissionsForRole,
  UpdateProfileSchema,
  UserProfileSchema,
  MeSchema,
  type Me,
  type UpdateProfile,
  type UserProfile,
} from '@app/contracts';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { appConfig } from '../../config/namespaces';
import { CurrentOrgOptional, type OrgContext } from '../../auth/org-context';
import { OrgOptional } from '../../auth/permissions.decorator';
import { MeService } from './me.service';
import { SubscriptionService } from '../billing/subscription.service';
import { FlagsService } from '../flags/flags.service';
import { MaintenanceModeService } from '../maintenance/maintenance-mode.service';

/**
 * Whether this session belongs to somebody being impersonated.
 *
 * Read through a narrow cast: `impersonatedBy` is added by the Better Auth admin
 * plugin and does not appear on the inferred session type here, the same reason
 * PermissionsGuard declares its own shape for it.
 */
function isImpersonating(session: unknown): boolean {
  const impersonatedBy = (session as { impersonatedBy?: string | null } | null)?.impersonatedBy;
  return typeof impersonatedBy === 'string' && impersonatedBy.length > 0;
}

/**
 * Deliberately carries no @AllowAnonymous(): it demonstrates the default. The global
 * AuthGuard registered by AuthModule protects every route unless it explicitly opts
 * out, so forgetting a decorator yields a 401 rather than an open endpoint.
 */
@ApiTags('me')
@ApiStandardErrors()
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly subscriptions: SubscriptionService,
    private readonly flags: FlagsService,
    private readonly maintenance: MaintenanceModeService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  /**
   * Everything the shell needs in one call: who you are, which organization is active,
   * and the effective permission set.
   *
   * @OrgOptional() makes the guard resolve the tenant when there is one without
   * refusing the request when there is not — a user who has just signed up and has no
   * organization yet still has to be able to load the application.
   */
  @Get()
  @OrgOptional()
  @ApiOperation({ summary: 'Current session user, active organization and permissions' })
  @ApiEnvelope(MeSchema)
  async get(
    @Session() session: UserSession,
    @CurrentOrgOptional() org: OrgContext | null,
  ): Promise<Me> {
    const reference = org ? this.subscriptions.referenceFor(org.organizationId, org.userId) : null;
    const entitling = reference ? await this.subscriptions.findEntitling(reference) : null;

    const flags = await this.flags.resolve();

    /**
     * Only ever non-null for somebody the guard let through — everybody else was
     * answered 503 before reaching this handler. So it means "you are inside a shop
     * whose door says closed", and the shell says so permanently.
     */
    const maintenance = await this.maintenance.get();

    const organizationName = org ? await this.me.organizationName(org.organizationId) : null;

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image ?? null,
        emailVerified: session.user.emailVerified,
        twoFactorEnabled:
          (session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled ?? false,
      },
      activeOrganizationId: org?.organizationId ?? null,
      organizationName,
      role: org?.role ?? null,
      // Resolved server-side: the role-to-permission mapping has one owner. The client
      // uses this to decide what to show, never to decide what is allowed.
      permissions: org ? [...org.permissions] : [],
      // Derived from the session role, not from the organization context: platform
      // rights cross tenant boundaries, so a superadmin who has not picked an
      // organization must not silently lose them.
      platformPermissions: [
        ...platformPermissionsForRole((session.user as { role?: string | null }).role),
      ],
      mode: this.app.mode,
      impersonating: isImpersonating(session.session),
      flags,
      maintenance: maintenance.enabled ? maintenance : null,
      subscription: entitling
        ? {
            plan: entitling.plan,
            status: entitling.status,
            periodEnd: entitling.periodEnd?.toISOString() ?? null,
            cancelAt: entitling.cancelAt?.toISOString() ?? null,
            willNotRenew: entitling.willNotRenew,
          }
        : null,
    };
  }

  /**
   * `@Body({ schema })` is NestJS 12 validating a Standard Schema natively. A body
   * that fails the schema never reaches this method — the exception filter turns it
   * into a 422 carrying messageCode VALIDATION_FAILED and the offending field paths.
   */
  @Patch()
  @ApiOperation({ summary: 'Update the current user profile' })
  @ApiEnvelope(UserProfileSchema)
  update(
    @Session() session: UserSession,
    @Body({ schema: UpdateProfileSchema }) body: UpdateProfile,
  ): Promise<UserProfile> {
    return this.me.updateProfile(session.user.id, body);
  }
}
