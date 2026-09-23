import { Component, computed, inject, resource, signal } from '@angular/core';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, merge } from 'rxjs';
import { DatePipe } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { provideIcons } from '@ng-icons/core';
import { lucideArrowRight, lucideCheck } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { NOTIFICATION_TYPES, type Notification, type NotificationType } from '@app/contracts';
import { NotificationCenterService, NotificationsApi, ToastService } from '@app/core';
import { TableComponent } from '@app/ui/table';
import { TemplateDirective } from '@app/ui/mix';
import type { DuiTablelazyLoadEvent, TableAction, TableColumn } from '@app/ui/mix';

/** What the table last asked the server for. */
interface Query {
  page: number;
  size: number;
  unread: boolean;
  type: NotificationType | null;
}

/** How many fit on a page. Twenty: a screenful without a scroll marathon. */
const PAGE_SIZE = 20;

/**
 * The archive of what happened while you were elsewhere.
 *
 * A `dui-table` driven lazily, like every other list here: the table announces the
 * page, the server answers. It used to fetch thirty rows and render them as a hand-made
 * list, which meant "filter" could only ever mean "filter the thirty you already have"
 * — the exact thing CLAUDE.md warns about, and the reason lists are tables in this
 * template.
 *
 * Sorting is deliberately off: the server orders newest first and offers nothing else,
 * and a sortable header that the API ignores is a control that lies. Search is off for
 * the same reason — there is no text to search, only keys.
 *
 * Nothing here is a stored sentence. Each row renders `titleKey`/`bodyKey` through i18n
 * with the parameters the event carried, so switching language re-reads the whole
 * history in the new one.
 */
@Component({
  selector: 'app-notifications-page',
  imports: [DatePipe, TranslocoPipe, TableComponent, TemplateDirective, HlmButtonImports],
  providers: [provideIcons({ lucideCheck, lucideArrowRight })],
  templateUrl: './notifications.page.html',
})
export class NotificationsPage {
  private readonly api = inject(NotificationsApi);
  private readonly centre = inject(NotificationCenterService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly types = NOTIFICATION_TYPES;

  /** See projects.page.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  protected readonly query = signal<Query>(
    // Exactly what `onLazyLoad` produces on init, so the table's opening announcement
    // is recognised as "no change" instead of triggering a second identical fetch.
    { page: 0, size: PAGE_SIZE, unread: false, type: null },
    {
      equal: (a, b) =>
        a.page === b.page && a.size === b.size && a.unread === b.unread && a.type === b.type,
    },
  );

  private readonly page = resource({
    params: () => this.query(),
    loader: ({ params }) =>
      firstValueFrom(
        this.api.list({
          page: params.page,
          size: params.size,
          ...(params.unread ? { unread: true } : {}),
          ...(params.type ? { type: params.type } : {}),
        }),
      ),
  });

  /** `hasValue()` rather than `value() ?? …`: a resource in error THROWS from `value()`. */
  protected readonly rows = computed<Notification[]>(() =>
    this.page.hasValue() ? this.page.value().items : [],
  );
  protected readonly total = computed(() =>
    this.page.hasValue() ? this.page.value().meta.total : 0,
  );
  /** Skeletons only when there is nothing to show yet — a reload keeps the old rows. */
  protected readonly loading = computed(() => this.page.isLoading() && !this.page.hasValue());
  protected readonly failed = computed(() => this.page.error() !== undefined);

  protected readonly onlyUnread = computed(() => this.query().unread);
  protected readonly activeType = computed(() => this.query().type);
  protected readonly busy = signal(false);

  protected readonly columns = computed<TableColumn[]>(() => {
    this.translations();
    const t = (key: string) => this.transloco.translate(`notifications.columns.${key}`);
    return [
      // Not sortable, any of them: the server orders by date and understands no other
      // field, and a header that offers a sort the API drops is a control that lies.
      { field: 'title', header: t('title'), sortable: false },
      { field: 'type', header: t('type'), sortable: false, removable: true },
      { field: 'state', header: t('state'), sortable: false },
      { field: 'createdAt', header: t('createdAt'), sortable: false },
    ];
  });

  protected readonly actions = computed<TableAction<Notification>[]>(() => {
    this.translations();
    return [
      {
        icon: 'lucideArrowRight',
        label: this.transloco.translate('notifications.openIt'),
        // Plenty of notifications have nowhere to go; an entry that navigates to the
        // page you are already on is worse than no entry.
        visible: (row) => !!row.actionUrl,
        command: (row) => void this.open(row),
      },
      {
        icon: 'lucideCheck',
        label: this.transloco.translate('notifications.markRead'),
        visible: (row) => !row.readAt,
        command: (row) => void this.markRead(row),
      },
    ];
  });

  protected asNotification(row: unknown): Notification {
    return row as Notification;
  }

  /** Transloco takes a flat object of placeholders; the payload is already that. */
  protected paramsOf(row: Notification): Record<string, unknown> {
    return row.params ?? {};
  }

  protected onLazyLoad(event: DuiTablelazyLoadEvent): void {
    const request = event.pageRequest;
    this.query.update((current) => ({
      ...current,
      page: request?.page ?? 0,
      size: request?.size ?? PAGE_SIZE,
    }));
  }

  /** The reload button, and anything that changed a row underneath us. */
  protected reload(): void {
    this.page.reload();
  }

  protected setUnread(unread: boolean): void {
    // Back to the first page: page 3 of "everything" is rarely page 3 of a filter, and
    // landing on an empty page reads as "there is nothing" rather than "look earlier".
    this.query.update((current) => ({ ...current, unread, page: 0 }));
  }

  protected setType(type: NotificationType | null): void {
    this.query.update((current) => ({ ...current, type, page: 0 }));
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
