import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@app/contracts';
import { AppException } from '../../common';
import { ORG_CONTEXT_KEY, type OrgContext } from '../../auth/org-context';
import { FEATURE_FLAG_METADATA } from './feature.decorator';
import { FlagsService } from './flags.service';

interface RequestWithSession extends Record<string, unknown> {
  session?: { user?: { id: string } };
}

/**
 * Enforces @RequireFeature(). Inert on every route that declares none, which is almost
 * all of them — the reflector lookup is the whole cost there.
 *
 * Runs after PermissionsGuard so the tenant, when the route has one, is already
 * resolved: an organization override is the level most rollouts actually use, and
 * resolving the tenant a second time here would be a second place to get it wrong.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(FEATURE_FLAG_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) return true;

    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const org = request[ORG_CONTEXT_KEY] as OrgContext | undefined;

    const enabled = await this.flags.isEnabled(key, {
      userId: request.session?.user?.id ?? null,
      organizationId: org?.organizationId ?? null,
    });

    if (!enabled) {
      throw new AppException(
        ERROR_CODES.FEATURE_DISABLED,
        HttpStatus.FORBIDDEN,
        `Feature "${key}" is not enabled for this caller`,
        { flag: key },
      );
    }

    return true;
  }
}
