import { Body, Controller, Get, Patch } from '@nestjs/common';
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
import { CurrentOrgOptional, type OrgContext } from '../../auth/org-context';
import { OrgOptional } from '../../auth/permissions.decorator';
import { MeService } from './me.service';
import { SubscriptionService } from '../billing/subscription.service';

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
      billingScope: (process.env['BILLING_SCOPE'] ?? 'organization') as 'organization' | 'user',
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
