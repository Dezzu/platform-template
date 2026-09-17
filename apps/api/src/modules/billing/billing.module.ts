import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

/** Global: the paywall guard and several feature modules resolve subscriptions. */
@Global()
@Module({ providers: [SubscriptionService], exports: [SubscriptionService] })
export class BillingModule {}
