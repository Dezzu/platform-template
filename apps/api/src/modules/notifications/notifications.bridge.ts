import type { NotificationsService } from './notifications.service';

/**
 * A module-scope handle on NotificationsService, for `stripe-plugin.ts` alone.
 *
 * Same seam as `mail.bridge.ts`, and for the same reason: the Stripe plugin is built
 * as a module singleton because `auth.config.ts` imports it directly and the Better
 * Auth CLI has no DI container. Its webhook handler nonetheless has to be able to tell
 * somebody that a renewal failed.
 *
 * Returns null rather than throwing, unlike the mail bridge: a webhook that fails
 * makes Stripe retry for three days, and losing one notification is a smaller problem
 * than an event that never gets acknowledged. The caller logs and carries on.
 */
let notifier: NotificationsService | null = null;

export function registerNotifier(service: NotificationsService): void {
  notifier = service;
}

export function webhookNotifier(): NotificationsService | null {
  return notifier;
}

/** Test seam. */
export function resetNotifier(): void {
  notifier = null;
}
