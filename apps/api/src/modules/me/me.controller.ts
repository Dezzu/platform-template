import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import {
  UpdateProfileSchema,
  UserProfileSchema,
  MeSchema,
  type Me,
  type UpdateProfile,
  type UserProfile,
} from '@app/contracts';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { MeService } from './me.service';

/**
 * Deliberately carries no @AllowAnonymous(): it demonstrates the default. The global
 * AuthGuard registered by AuthModule protects every route unless it explicitly opts
 * out, so forgetting a decorator yields a 401 rather than an open endpoint.
 */
@ApiTags('me')
@ApiStandardErrors()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOperation({ summary: 'Current session user and active organization' })
  @ApiEnvelope(MeSchema)
  get(@Session() session: UserSession): Me {
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
      // Populated once the user selects an organization; the org-scoping layer
      // resolves it for every request.
      activeOrganizationId:
        (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
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
