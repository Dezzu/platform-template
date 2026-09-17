import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { subscription, type Database } from '@app/db';
import { DRIZZLE } from '../../database/database.module';

/** The states in which a subscription actually entitles someone to the paid product. */
export const ENTITLING_STATUSES = ['active', 'trialing'] as const;

export interface ActiveSubscription {
  plan: string;
  status: string;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

@Injectable()
export class SubscriptionService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * The reference a subscription hangs off, per BILLING_SCOPE: the organization that
   * pays, or the person who pays.
   */
  referenceFor(organizationId: string | null, userId: string): string | null {
    return (process.env['BILLING_SCOPE'] ?? 'organization') === 'user' ? userId : organizationId;
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
      cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
    };
  }
}
