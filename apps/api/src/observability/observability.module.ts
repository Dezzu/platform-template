import { Inject, Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { count, inArray } from 'drizzle-orm';
import { subscription, type Database } from '@app/db';
import { DRIZZLE } from '../database/database.module';
import { ENTITLING_STATUSES } from '../modules/billing/subscription.service';
import { observeGauge } from './metrics';

/**
 * The metrics that are a **state** rather than an event.
 *
 * Everything else in `metrics.ts` is counted where it happens, through the global
 * meter, because the places worth counting are not all inside the DI container. This
 * one is different: it is a question for the database, so it needs a connection, so it
 * needs a provider.
 *
 * A gauge rather than a counter kept in step by hand. "How many subscriptions are
 * active" moves on webhooks, on cancellations, on trials expiring silently at Stripe —
 * incrementing and decrementing along each of those paths would drift the first time
 * one of them was missed, and a drifting gauge is worse than none because it is
 * believed.
 */
@Injectable()
export class SubscriptionGauge implements OnApplicationBootstrap {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  onApplicationBootstrap(): void {
    observeGauge(
      'subscriptions_active',
      'Subscriptions currently entitling somebody to the paid product',
      async () => {
        const [row] = await this.db
          .select({ value: count() })
          .from(subscription)
          // The same statuses the paywall uses, imported rather than repeated: a
          // dashboard that counted `past_due` as active would disagree with the
          // product about who is a customer.
          .where(inArray(subscription.status, [...ENTITLING_STATUSES]));

        return row?.value ?? 0;
      },
    );
  }
}

@Module({ providers: [SubscriptionGauge] })
export class ObservabilityModule {}
