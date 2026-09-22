import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@app/contracts';
import { AppException } from '../../common';
import { ALLOW_DURING_MAINTENANCE_METADATA } from './maintenance.decorator';
import { MaintenanceModeService } from './maintenance-mode.service';

interface RequestWithSession {
  url?: string;
  originalUrl?: string;
  session?: { user?: { role?: string | null } };
}

/**
 * Better Auth's own routes, which stay open while the lights are out.
 *
 * Turning maintenance on must not lock out the person who has to turn it off: they
 * have to be able to sign in first, and the sign-in endpoint belongs to a handler
 * mounted as middleware, so there is nothing to decorate. Hence a path check.
 *
 * It is not a hole: signing in during maintenance yields a session and nothing else —
 * every actual endpoint still answers 503 unless the role is on the allow list.
 */
const AUTH_PREFIX = '/api/auth/';

/**
 * Answers 503 for everybody except the roles on the allow list.
 *
 * Third in the chain, after authentication: the decision depends on `user.role`, and a
 * guard that ran before AuthGuard would have to either let everyone in or lock
 * everyone out — including whoever needs to sign in and switch it back off.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly maintenance: MaintenanceModeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const exempt = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_DURING_MAINTENANCE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (exempt) return true;

    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const path = request.originalUrl ?? request.url ?? '';
    if (path.startsWith(AUTH_PREFIX)) return true;

    const mode = await this.maintenance.get();
    if (this.maintenance.allows(mode, request.session?.user?.role)) return true;

    /**
     * The notice travels in `details` rather than in the message: the client renders
     * `errors.MAINTENANCE_MODE` from its own catalogue, and `messageKey` is a key it
     * translates too. Neither side ever ships a sentence.
     */
    throw new AppException(
      ERROR_CODES.MAINTENANCE_MODE,
      HttpStatus.SERVICE_UNAVAILABLE,
      'The service is temporarily unavailable for maintenance',
      { messageKey: mode.messageKey, until: mode.until },
    );
  }
}
