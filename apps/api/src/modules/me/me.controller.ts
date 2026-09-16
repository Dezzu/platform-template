import { Controller, Get } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';

/**
 * Deliberately carries no @AllowAnonymous(): it demonstrates the default. The global
 * AuthGuard registered by AuthModule protects every route unless it explicitly opts
 * out, so forgetting a decorator yields a 401 rather than an open endpoint.
 */
@Controller('me')
export class MeController {
  @Get()
  get(@Session() session: UserSession): {
    user: UserSession['user'];
    activeOrganizationId: string | null;
  } {
    return {
      user: session.user,
      // Populated once the user selects an organization; the org-scoping layer in
      // Phase 5 resolves it for every request.
      activeOrganizationId:
        (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null,
    };
  }
}
