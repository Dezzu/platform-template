import { DatePipe } from '@angular/common';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import type { Notification } from '@app/contracts';
import { NotificationCenterService, NotificationsApi, ToastService } from '@app/core';

/**
 * What happened while you were elsewhere.
 *
 * A page rather than a dropdown: the list is paginated, every entry can lead
 * somewhere, and "mark everything read" is a decision, not a hover. The bell in the
 * header carries the count and opens this.
 *
 * Nothing here is a stored sentence — each row renders `titleKey`/`bodyKey` through
 * i18n with the parameters the event carried, so switching language re-reads the
 * whole history in the new one.
 */
@Component({
  selector: 'app-notifications-page',
  imports: [TranslocoPipe, DatePipe, NgIcon, HlmButtonImports],
  providers: [provideIcons({ lucideCheck })],
  templateUrl: './notifications.page.html',
})
export class NotificationsPage {
  private readonly api = inject(NotificationsApi);
  private readonly centre = inject(NotificationCenterService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  protected readonly onlyUnread = signal(false);
  protected readonly busy = signal(false);

  private readonly page = resource({
    params: () => ({ unread: this.onlyUnread() }),
    loader: ({ params }) =>
      firstValueFrom(this.api.list({ size: 30, ...(params.unread ? { unread: true } : {}) })),
  });

  /** `hasValue()` rather than `value() ?? …`: a failed resource THROWS from `value()`. */
  protected readonly rows = computed<Notification[]>(() =>
    this.page.hasValue() ? this.page.value().items : [],
  );
  protected readonly loading = computed(() => this.page.isLoading() && !this.page.hasValue());
  protected readonly failed = computed(() => this.page.error() !== undefined);
  protected readonly empty = computed(() => !this.loading() && this.rows().length === 0);

  /** Transloco takes a flat object of placeholders; the payload is already that. */
  protected paramsOf(row: Notification): Record<string, unknown> {
    return row.params ?? {};
  }

  protected toggleUnreadOnly(): void {
    this.onlyUnread.update((value) => !value);
  }

  /**
   * Opening one marks it read and then goes where it points.
   *
   * Marked first and awaited: navigating away from a request in flight is how a
   * notification stays bold after you have read it.
   */
  protected async open(row: Notification): Promise<void> {
    await this.markRead(row);
    if (row.actionUrl) await this.router.navigateByUrl(row.actionUrl);
  }

  /**
   * Clears one without going anywhere.
   *
   * Plenty of notifications are worth knowing and not worth visiting; without this the
   * only way to mark one read was to open it, which took you off the page.
   */
  protected async markRead(row: Notification): Promise<void> {
    if (row.readAt) return;

    try {
      await firstValueFrom(this.api.markRead(row.id));
      this.centre.decrement();
      this.page.reload();
    } catch (error: unknown) {
      this.toasts.error(error);
    }
  }

  protected async markAllRead(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);

    try {
      const { unread } = await firstValueFrom(this.api.markAllRead());
      this.centre.set(unread);
      this.page.reload();
    } catch (error: unknown) {
      this.toasts.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}
