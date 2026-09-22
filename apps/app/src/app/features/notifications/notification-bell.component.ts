import { Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBell, lucideCheck } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import type { Notification } from '@app/contracts';
import { NotificationCenterService, NotificationsApi, ToastService } from '@app/core';

/** How many fit in a panel before it stops being a glance and becomes a list. */
const PREVIEW_SIZE = 5;

/**
 * The bell in the header: a count, and the few most recent behind it.
 *
 * The panel is a glance, not the archive — the five still waiting, then a way through
 * to the full page. Everything that needs paging, filtering or history lives there;
 * what lives here is "is there anything, and is it urgent enough to stop what I am
 * doing".
 *
 * Unread only, and that is the correction to how this shipped: a panel that also
 * listed what you had already read looked, on every reload, exactly like a panel that
 * had forgotten you read it. Clearing one is also its own action now — before, the
 * only way to mark something read was to open it, which navigated away, so a
 * notification you merely wanted to dismiss had nowhere to go.
 *
 * Nothing is fetched until it is opened. Most sessions never press this, and a list
 * loaded on every page load would be a request per navigation for a panel nobody
 * looked at.
 */
@Component({
  selector: 'app-notification-bell',
  imports: [NgIcon, RouterLink, DatePipe, TranslocoPipe, HlmButtonImports, HlmDropdownMenuImports],
  providers: [provideIcons({ lucideBell, lucideCheck })],
  templateUrl: './notification-bell.component.html',
})
export class NotificationBellComponent {
  private readonly api = inject(NotificationsApi);
  private readonly centre = inject(NotificationCenterService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  protected readonly unread = this.centre.unread;

  /**
   * Bumped on every open, which is what re-runs the loader.
   *
   * A boolean would load once and then show a stale panel for the rest of the session;
   * a counter makes each open a fresh read without polling in between.
   */
  private readonly openedAt = signal(0);

  private readonly latest = resource({
    params: () => this.openedAt(),
    loader: ({ params }) =>
      params === 0
        ? Promise.resolve(null)
        : firstValueFrom(this.api.list({ size: PREVIEW_SIZE, unread: true })),
  });

  protected readonly rows = computed<Notification[]>(() =>
    this.latest.hasValue() ? (this.latest.value()?.items ?? []) : [],
  );
  protected readonly loading = computed(() => this.latest.isLoading());
  protected readonly failed = computed(() => this.latest.error() !== undefined);
  protected readonly empty = computed(
    () => !this.loading() && !this.failed() && this.rows().length === 0,
  );

  protected open(): void {
    this.openedAt.update((value) => value + 1);
  }

  protected paramsOf(row: Notification): Record<string, unknown> {
    return row.params ?? {};
  }

  /** Marks it read, then goes where it points — in that order, and awaited. */
  protected async openOne(row: Notification): Promise<void> {
    await this.dismiss(row);
    await this.router.navigateByUrl(row.actionUrl ?? '/notifications');
  }

  /**
   * Clears one without going anywhere.
   *
   * The whole reason it exists: plenty of notifications are worth knowing and not
   * worth visiting, and before this the only way to mark one read was to open it.
   */
  protected async markRead(row: Notification): Promise<void> {
    await this.dismiss(row);
    this.latest.reload();
  }

  private async dismiss(row: Notification): Promise<void> {
    if (row.readAt) return;

    try {
      await firstValueFrom(this.api.markRead(row.id));
      this.centre.decrement();
    } catch (error: unknown) {
      this.toasts.error(error);
    }
  }

  protected async markAllRead(): Promise<void> {
    try {
      const { unread } = await firstValueFrom(this.api.markAllRead());
      this.centre.set(unread);
      this.latest.reload();
    } catch (error: unknown) {
      this.toasts.error(error);
    }
  }
}
