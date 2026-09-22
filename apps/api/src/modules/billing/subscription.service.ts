import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { billsThePerson } from '@app/contracts';
import { subscription, type Database } from '@app/db';
import { appMode } from '../../config/app-mode';
import { DRIZZLE } from '../../database/database.module';

/** The states in which a subscription actually entitles someone to the paid product. */
export const ENTITLING_STATUSES = ['active', 'trialing'] as const;

export interface ActiveSubscription {
  plan: string;
  status: string;
  periodEnd: Date | null;
  /**
   * When the subscription stops renewing, if it has been cancelled.
   *
   * Recent Stripe API versions express "cancel at period end" by setting `cancel_at`
   * and leaving `cancel_at_period_end` false — so reading only the boolean means never
   * noticing a cancellation. Both are carried, and `willNotRenew` is what callers
   * should ask.
   */
  cancelAt: Date | null;
  cancelAtPeriodEnd: boolean;
  /** True when the subscription is set to end rather than renew. */
  willNotRenew: boolean;
}

@Injectable()
export class SubscriptionService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * The reference a subscription hangs off, per APP_MODE: the person who pays in
   * `b2c`, the tenant that pays in `b2b`.
   */
  referenceFor(organizationId: string | null, userId: string): string | null {
    return billsThePerson(appMode()) ? userId : organizationId;
  }

  /**
   * Returns the subscription that entitles the reference to paid features, or null.
   *
   * `past_due` deliberately does not count: the card has failed and the grace period
   * is Stripe's business, not a reason to keep serving. `canceled` at period end still
   * reads as 'active' until the period actually ends, which is correct — they paid for
   * that time.
   */
  async findEntitling(reference: string): Promise<ActiveSubscription | null> {
    const [row] = await this.db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, reference),
          inArray(subscription.status, [...ENTITLING_STATUSES]),
        ),
      )
      .limit(1);

    if (!row) return null;

    return {
      plan: row.plan,
      status: row.status,
      periodEnd: row.periodEnd ?? null,
      cancelAt: row.cancelAt ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
      willNotRenew: row.cancelAt !== null || (row.cancelAtPeriodEnd ?? false),
    };
  }
}
