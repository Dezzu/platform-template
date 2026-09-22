import { computed, inject, Service, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NotificationsApi } from '../api/notifications.api';

/**
 * How many notifications are waiting — the number on the bell.
 *
 * Named for the centre rather than "notifications" because this library already has a
 * `ToastService`, and the two are different things: a toast is the outcome of what you
 * just did and disappears, a notification is something that happened while you were
 * elsewhere and waits.
 *
 * **Deliberately not polled.** It refreshes when the shell loads and after anything
 * that changes it. A timer would mean a request per user per interval forever, for a
 * number that is usually zero; when this product grows a reason for the badge to move
 * on its own, the honest answer is server-sent events, not a poll.
 */
@Service()
export class NotificationCenterService {
  private readonly api = inject(NotificationsApi);

  private readonly state = signal(0);

  readonly unread = computed(() => this.state());
  readonly hasUnread = computed(() => this.state() > 0);

  async refresh(): Promise<void> {
    try {
      const { unread } = await firstValueFrom(this.api.unreadCount());
      this.state.set(unread);
    } catch {
      // A failed count is not worth a message: the bell simply shows nothing, and the
      // notifications page reports its own failure when opened.
      this.state.set(0);
    }
  }

  /** Applied locally after marking things read, so the badge does not lag a request. */
  set(unread: number): void {
    this.state.set(Math.max(0, unread));
  }

  decrement(): void {
    this.state.update((current) => Math.max(0, current - 1));
  }

  clear(): void {
    this.state.set(0);
  }
}
