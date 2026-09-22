import { Component, computed, inject, resource, signal } from '@angular/core';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { provideIcons } from '@ng-icons/core';
import { lucidePencil, lucideToggleLeft, lucideTrash2 } from '@ng-icons/lucide';
import type { FeatureFlag } from '@app/contracts';
import { TableComponent } from '@app/ui/table';
import { TemplateDirective } from '@app/ui/mix';
import type { DuiTablelazyLoadEvent, TableAction, TableColumn } from '@app/ui/mix';
import { ToastService } from '@app/core';
import { AdminApi } from './admin.api';
import { AdminNavComponent } from './admin-nav.component';

/** What the table last asked the server for. */
interface Query {
  page: number;
  size: number;
  q: string;
  sort: string | undefined;
  dir: 'asc' | 'desc';
}

/**
 * The flag definitions, as configured — not as resolved.
 *
 * Worth saying out loud because the two differ for almost everybody: this screen shows
 * the global switch, the rollout and how many exceptions exist, while what any given
 * user actually experiences is the result of resolving all three. The "state" column
 * is written to make that visible rather than to imply that `enabled` is the answer.
 */
@Component({
  selector: 'app-admin-flags-page',
  imports: [TranslocoPipe, TableComponent, TemplateDirective, AdminNavComponent],
  providers: [provideIcons({ lucidePencil, lucideToggleLeft, lucideTrash2 })],
  templateUrl: './admin-flags.page.html',
})
export class AdminFlagsPage {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);

  /** See admin-users.page.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  protected readonly query = signal<Query>(
    { page: 0, size: 10, q: '', sort: undefined, dir: 'asc' },
    {
      equal: (a, b) =>
        a.page === b.page &&
        a.size === b.size &&
        a.q === b.q &&
        a.sort === b.sort &&
        a.dir === b.dir,
    },
  );

  private readonly page = resource({
    params: () => this.query(),
    loader: ({ params }) =>
      firstValueFrom(
        this.api.listFlags({
          page: params.page,
          size: params.size,
          dir: params.dir,
          ...(params.q ? { q: params.q } : {}),
          ...(params.sort ? { sort: params.sort } : {}),
        }),
      ),
  });

  /** `hasValue()` rather than `value() ?? …`: a failed resource THROWS from `value()`. */
  protected readonly rows = computed(() => (this.page.hasValue() ? this.page.value().items : []));
  protected readonly total = computed(() =>
    this.page.hasValue() ? this.page.value().meta.total : 0,
  );
  protected readonly loading = computed(() => this.page.isLoading() && !this.page.hasValue());
  protected readonly failed = computed(() => this.page.error() !== undefined);

  protected readonly columns = computed<TableColumn[]>(() => {
    this.translations();
    const t = (key: string) => this.transloco.translate(`flags.columns.${key}`);
    return [
      { field: 'key', header: t('key'), sortable: true },
      { field: 'description', header: t('description'), sortable: false },
      { field: 'state', header: t('state'), sortable: false },
      {
        field: 'updatedAt',
        header: t('updatedAt'),
        sortable: false,
        pipe: 'date',
        pipeArgs: ['short'],
        removable: true,
      },
    ];
  });

  protected readonly actions = computed<TableAction<FeatureFlag>[]>(() => {
    this.translations();
    return [
      {
        icon: 'lucideToggleLeft',
        label: this.transloco.translate('flags.toggle'),
        command: (row) => this.toggle(row),
      },
      {
        icon: 'lucidePencil',
        label: this.transloco.translate('common.edit'),
        command: (row) => void this.router.navigate(['/admin/flags', row.key]),
      },
      {
        icon: 'lucideTrash2',
        severity: 'destructive',
        label: this.transloco.translate('common.delete'),
        command: (row) => this.remove(row),
      },
    ];
  });

  protected asFlag(value: unknown): FeatureFlag {
    return value as FeatureFlag;
  }

  protected openNew(): void {
    void this.router.navigate(['/admin/flags', 'new']);
  }

  protected onLazyLoad(event: DuiTablelazyLoadEvent): void {
    // An explicit reload asks for the same parameters again, and the equality above is
    // built to ignore exactly that — so it is handled before the comparison.
    if (event.reload) {
      this.page.reload();
      return;
    }

    const request = event.pageRequest;
    const sort = typeof request.sortField === 'string' ? request.sortField : undefined;
    const search = typeof request.query === 'string' ? request.query : '';

    this.query.set({
      page: request.page,
      size: request.size,
      q: search,
      sort,
      dir: request.sortOrder === -1 ? 'desc' : 'asc',
    });
  }

  /**
   * Flips the global switch from the list, because that is the thing an administrator
   * comes here to do at two in the morning. Everything else — the rollout, the
   * exceptions — is a decision, and decisions get a form.
   */
  private toggle(flag: FeatureFlag): void {
    void (async () => {
      try {
        await firstValueFrom(this.api.updateFlag(flag.key, { enabled: !flag.enabled }));
        this.page.reload();
        this.toasts.success(flag.enabled ? 'flags.disabled' : 'flags.enabled', { key: flag.key });
      } catch (error: unknown) {
        this.toasts.error(error);
      }
    })();
  }

  private remove(flag: FeatureFlag): void {
    void (async () => {
      try {
        await firstValueFrom(this.api.deleteFlag(flag.key));
        this.page.reload();
        this.toasts.success('flags.deleted', { key: flag.key });
      } catch (error: unknown) {
        this.toasts.error(error);
      }
    })();
  }
}
