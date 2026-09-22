import { Global, Module } from '@nestjs/common';
import { registerNotifier } from './notifications.bridge';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/**
 * Global for the same reason AuditModule is: raising a notification is something any
 * feature does as a side effect of its own work, and threading an import through every
 * module that might one day tell somebody about something is churn without a benefit.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository],
  exports: [NotificationsService],
})
export class NotificationsModule {
  constructor(notifications: NotificationsService) {
    // Hands the Stripe webhook, which lives outside DI, a way to raise one. See
    // notifications.bridge.ts.
    registerNotifier(notifications);
  }
}
