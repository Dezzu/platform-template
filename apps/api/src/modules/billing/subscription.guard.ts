import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@app/contracts';
import { AppException } from '../../common';
import { ORG_CONTEXT_KEY, type OrgContext } from '../../auth/org-context';
import { REQUIRES_SUBSCRIPTION } from './require-subscription.decorator';
import { SubscriptionService } from './subscription.service';

/**
 * Enforces @RequireSubscription().
 *
 * Runs after PermissionsGuard, so the tenant is already resolved: a paywall that had
 * to work out which organization it was talking about would be a second place to get
 * tenancy wrong.
 *
 * Answers 402 Payment Required rather than 403: the caller is allowed to do this, they
 * simply have not paid — and a client that cannot tell the two apart will show the
 * wrong message.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRES_SUBSCRIPTION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const org = request[ORG_CONTEXT_KEY] as OrgContext | undefined;

    if (!org) {
      throw new AppException(
        ERROR_CODES.ORGANIZATION_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'No active organization, so no subscription can be resolved',
      );
    }

    const reference = this.subscriptions.referenceFor(org.organizationId, org.userId);
    if (!reference || !(await this.subscriptions.findEntitling(reference))) {
      throw new AppException(
        ERROR_CODES.SUBSCRIPTION_REQUIRED,
        HttpStatus.PAYMENT_REQUIRED,
        'This feature requires an active subscription',
      );
    }

    return true;
  }
}
