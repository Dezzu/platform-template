import { Component, computed, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { AuditEntry } from '@app/contracts';
import { TableComponent } from '@app/ui/table';
import { TemplateDirective } from '@app/ui/mix';
import type { DuiTablelazyLoadEvent, TableColumn } from '@app/ui/mix';
import { AuditApi } from './audit.api';

/** What the table last asked the server for, plus the filters this screen adds. */
interface Query {
  page: number;
  size: number;
  sort: string | undefined;
  dir: 'asc' | 'desc';
  action: string;
}

/**
 * The activity of this organization.
 *
 * No actions column, and that is the point: entries are written inside the transaction
 * that made the change and nothing in the application can amend or remove one. A trail
 * with an edit button is not a trail.
 *
 * The change itself lives behind the expand chevron rather than in a column. A diff is
 * long, most rows are never opened, and a table that shows one per row is a table
 * nobody can scan.
 */
@Component({
  selector: 'app-audit-page',
  imports: [TranslocoPipe, TableComponent, TemplateDirective],
  templateUrl: './audit.page.html',
})
export class AuditPage {
  private readonly api = inject(AuditApi);
  private readonly transloco = inject(TranslocoService);

  /** See admin-users.page.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  protected readonly query = signal<Query>(
    // Exactly what `onLazyLoad` produces on init, so the table's opening announcement
    // is recognised as "no change" instead of triggering a second identical fetch.
    { page: 0, size: 10, sort: undefined, dir: 'asc', action: '' },
    {
      equal: (a, b) =>
        a.page === b.page &&
        a.size === b.size &&
        a.sort === b.sort &&
        a.dir === b.dir &&
        a.action === b.action,
    },
  );

  private readonly page = resource({
    params: () => this.query(),
    loader: ({ params }) =>
      firstValueFrom(
        this.api.list({
          page: params.page,
          size: params.size,
          ...(params.action ? { action: params.action } : {}),
        }),
      ),
  });

  private readonly facets = resource({
    loader: () => firstValueFrom(this.api.facets()),
  });

  protected readonly rows = computed(() => (this.page.hasValue() ? this.page.value().items : []));
  protected readonly total = computed(() =>
    this.page.hasValue() ? this.page.value().meta.total : 0,
  );
  /** Skeletons only when there is nothing yet — a reload keeps the rows on screen. */
  protected readonly loading = computed(() => this.page.isLoading() && !this.page.hasValue());
  protected readonly failed = computed(() => this.page.error() !== undefined);

  /** Only the actions this trail actually contains. */
  protected readonly actions = computed(() =>
    this.facets.hasValue() ? (this.facets.value()?.actions ?? []) : [],
  );

  protected readonly columns = computed<TableColumn[]>(() => {
    this.translations();
    const t = (key: string) => this.transloco.translate(`audit.columns.${key}`);
    return [
      {
        field: 'createdAt',
        header: t('when'),
        sortable: false,
        pipe: 'date',
        pipeArgs: ['dd/MM/yyyy HH:mm'],
      },
      { field: 'action', header: t('action'), sortable: false },
      { field: 'actorEmail', header: t('actor'), sortable: false },
      { field: 'resourceType', header: t('resource'), sortable: false, removable: true },
    ];
  });

  protected asEntry(value: unknown): AuditEntry {
    return value as AuditEntry;
  }

  /**
   * An action's label, falling back to the action itself.
   *
   * The vocabulary is open — every feature adds to it — so a missing translation must
   * degrade to `project.created`, which a reader can still act on, rather than to
   * `audit.actions.project.created`, which nobody can.
   */
  protected actionLabel(action: string): string {
    this.translations();
    const key = `audit.actions.${action}`;
    const translated = this.transloco.translate(key);
    return translated === key ? action : translated;
  }

  /** Pretty-printed, because a diff on one line is a diff nobody reads. */
  protected asJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  protected onFilter(event: Event): void {
    const action = (event.target as HTMLSelectElement).value;
    this.query.update((current) => ({ ...current, action, page: 0 }));
  }

  protected onLazyLoad(event: DuiTablelazyLoadEvent): void {
    if (event.reload) {
      this.page.reload();
      return;
    }

    const request = event.pageRequest;
    this.query.update((current) => ({
      ...current,
      page: request.page,
      size: request.size,
      sort: typeof request.sortField === 'string' ? request.sortField : undefined,
      dir: request.sortOrder === -1 ? 'desc' : 'asc',
    }));
  }
}
